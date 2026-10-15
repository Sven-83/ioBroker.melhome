/*
 * REST client for the MELCloud Home mobile BFF (docs/api.md section 3).
 *
 * - bearer token from the TokenManager, 401 cascade: refresh -> full login -> error
 * - GET requests are retried once after a short delay on network errors and HTTP 5xx
 * - HTTP 429 is never retried here: RateLimitedError carries Retry-After to the connection manager
 * - control requests (PUT) are never retried here - the command queue decides
 * - responses often come as text/plain, so the body is always parsed manually
 */

import {
    DEFAULT_ENDPOINTS,
    PATH_ATA_CONTROL,
    PATH_CONTEXT,
    PATH_TELEMETRY_ACTUAL,
    PATH_TELEMETRY_ENERGY,
    PATH_TREND_SUMMARY,
    USER_AGENT,
    type Endpoints,
} from './constants';
import {
    AbortedError,
    ApiError,
    NetworkError,
    RateLimitedError,
    ServiceUnavailableError,
    TokenRejectedError,
} from './errors';
import { parseRetryAfter, type HttpTransport, type Logger } from './http';
import {
    buildAtaControlBody,
    parseHourlyEnergy,
    parseOutdoorTemperature,
    parseRssi,
    parseUserContext,
    type AtaControlRequest,
    type HourlyEnergy,
    type Reading,
    type UserContext,
} from './types';

/** What the client needs from the token manager */
export interface TokenProvider {
    /** Returns a valid access token, logging in if necessary */
    getAccessToken(): Promise<string>;
    /** Marks the access token as expired */
    invalidateAccessToken(): void;
    /** Drops all tokens so the next call logs in */
    forceLogin(): void;
}

/** Dependencies and settings of the REST client */
export interface ClientOptions {
    /** Shared transport */
    http: HttpTransport;
    /** Token source */
    tokens: TokenProvider;
    /** Adapter logger */
    log: Logger;
    /** Service URLs (tests) */
    endpoints?: Endpoints;
    /** Delay before the single retry of a failed GET (ms) */
    retryDelayMs?: number;
    /** Sleep function (tests) */
    sleep?: (ms: number) => Promise<void>;
    /** Clock (tests) */
    now?: () => number;
}

interface RequestOptions {
    method: 'GET' | 'PUT';
    body?: unknown;
    /** Allow one retry on network errors / 5xx */
    retry: boolean;
}

/** Bound for the "warn once" memory so varying garbage cannot grow it forever */
const MAX_REMEMBERED_WARNINGS = 200;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * "YYYY-MM-DD HH:mm" in UTC (telemetry endpoints).
 *
 * @param time - Epoch ms
 */
export function formatTelemetryTime(time: number): string {
    const d = new Date(time);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
        d.getUTCMinutes(),
    )}`;
}

/**
 * "YYYY-MM-DDTHH:mm:ss.0000000Z" in UTC (report endpoints - the Z is required).
 *
 * @param time - Epoch ms
 */
export function formatReportTime(time: number): string {
    const d = new Date(time);
    return `${formatTelemetryTime(time).replace(' ', 'T')}:${pad(d.getUTCSeconds())}.0000000Z`;
}

/**
 * Access to the MELCloud Home REST API.
 */
export class MelCloudHomeClient {
    private readonly http: HttpTransport;
    private readonly tokens: TokenProvider;
    private readonly log: Logger;
    private readonly endpoints: Endpoints;
    private readonly retryDelayMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;
    private readonly warned = new Set<string>();

    /** @param options - Dependencies and settings */
    public constructor(options: ClientOptions) {
        this.http = options.http;
        this.tokens = options.tokens;
        this.log = options.log;
        this.endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;
        this.retryDelayMs = options.retryDelayMs ?? 5000;
        this.sleep = options.sleep ?? (ms => this.http.abortableSleep(ms));
        this.now = options.now ?? Date.now;
    }

    /** All buildings and units with their current state */
    public async getContext(): Promise<UserContext> {
        const data = await this.request(PATH_CONTEXT, { method: 'GET', retry: true });
        const context = parseUserContext(data, (key, message) => this.warnOnce(key, message));
        if (!context) {
            throw new ApiError('Unexpected /context response');
        }
        return context;
    }

    /**
     * Sends one control request. HTTP 200 only means "accepted", not "applied".
     *
     * @param unitId - Unit UUID
     * @param request - Fields to change
     */
    public async controlAta(unitId: string, request: AtaControlRequest): Promise<void> {
        if (request.vaneHorizontalDirection !== undefined && request.vaneVerticalDirection !== undefined) {
            // the unit ignores both if sent together (docs/api.md section 3.3)
            throw new RangeError('Both vane axes must not be sent in one request');
        }
        if (request.power === true && request.operationMode === undefined) {
            // multi-split systems may report a mode conflict otherwise
            throw new RangeError('Power on must be sent together with the operation mode');
        }
        await this.request(`${PATH_ATA_CONTROL}${encodeURIComponent(unitId)}`, {
            method: 'PUT',
            body: buildAtaControlBody(request),
            retry: false,
        });
    }

    /**
     * Hourly energy consumption (Wh per hour) - only for units with hasEnergyConsumedMeter.
     *
     * @param unitId - Unit UUID
     * @param hours - Window size, default 23 h like the reference
     */
    public async getHourlyEnergy(unitId: string, hours = 23): Promise<HourlyEnergy> {
        const now = this.now();
        const hourMs = 3_600_000;
        // from must be a full hour, otherwise the first hour appears to shrink
        const from = Math.floor((now - hours * hourMs) / hourMs) * hourMs;
        const query = new URLSearchParams({
            from: formatTelemetryTime(from),
            to: formatTelemetryTime(now),
            interval: 'Hour',
            measure: 'cumulative_energy_consumed_since_last_upload',
        });
        const data = await this.request(`${PATH_TELEMETRY_ENERGY}${encodeURIComponent(unitId)}?${query.toString()}`, {
            method: 'GET',
            retry: true,
        });
        return parseHourlyEnergy(data);
    }

    /**
     * Newest Wi-Fi signal reading (dBm). The window must be exactly one hour.
     *
     * @param unitId - Unit UUID
     */
    public async getWifiSignal(unitId: string): Promise<Reading | null> {
        const now = this.now();
        const query = new URLSearchParams({
            from: formatTelemetryTime(now - 3_600_000),
            to: formatTelemetryTime(now),
            measure: 'rssi',
        });
        const data = await this.request(`${PATH_TELEMETRY_ACTUAL}${encodeURIComponent(unitId)}?${query.toString()}`, {
            method: 'GET',
            retry: true,
        });
        return parseRssi(data);
    }

    /**
     * Newest genuine outdoor temperature from the 48 h trend report.
     *
     * @param unitId - Unit UUID
     * @param timeZone - IANA zone of the unit (report timestamps are local)
     */
    public async getOutdoorTemperature(unitId: string, timeZone: string | null): Promise<Reading | null> {
        // "to" on second 0 so the server's echo of it is recognised as synthetic
        const to = Math.floor(this.now() / 60_000) * 60_000;
        const query = new URLSearchParams({
            unitId,
            period: 'Hourly',
            from: formatReportTime(to - 48 * 3_600_000),
            to: formatReportTime(to),
        });
        const data = await this.request(`${PATH_TREND_SUMMARY}?${query.toString()}`, { method: 'GET', retry: true });
        return parseOutdoorTemperature(data, timeZone);
    }

    /** Credential ("hash") for the WebSocket - never log it */
    public async getWebSocketHash(): Promise<string> {
        const data = await this.request(this.endpoints.wsHash, { method: 'GET', retry: true });
        const hash = data && typeof data === 'object' ? (data as Record<string, unknown>).hash : undefined;
        if (typeof hash !== 'string' || !hash) {
            throw new ApiError('WebSocket credential response contains no hash');
        }
        return hash;
    }

    /**
     * Authorised request with 401 cascade and optional single retry.
     *
     * @param pathOrUrl - Path below the API host or absolute URL
     * @param options - Request options
     * @returns Parsed JSON, or null for an empty body / HTTP 304
     */
    private async request(pathOrUrl: string, options: RequestOptions): Promise<unknown> {
        const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.endpoints.api}${pathOrUrl}`;
        const label = `${options.method} ${pathOrUrl.split('?')[0].replace(/^https?:\/\/[^/]+/, '<ws-credential>')}`;
        let unauthorized = 0;
        let retried = false;

        for (;;) {
            try {
                const token = await this.tokens.getAccessToken();
                const headers: Record<string, string> = {
                    'User-Agent': USER_AGENT,
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                };
                if (options.body !== undefined) {
                    headers['Content-Type'] = 'application/json; charset=utf-8';
                }
                const { response, body } = await this.http.request(url, {
                    method: options.method,
                    headers,
                    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                });
                this.log.debug(`${label} -> HTTP ${response.status}`);

                if (response.status === 401 || response.status === 403) {
                    unauthorized++;
                    if (unauthorized === 1) {
                        this.tokens.invalidateAccessToken();
                        continue;
                    }
                    if (unauthorized === 2) {
                        this.tokens.forceLogin();
                        continue;
                    }
                    throw new TokenRejectedError(`${label} still unauthorised after a new login`);
                }
                if (response.status === 304) {
                    return null;
                }
                if (response.status === 429) {
                    throw new RateLimitedError(parseRetryAfter(response.headers.get('retry-after'), this.now()));
                }
                if (response.status >= 500) {
                    throw new ServiceUnavailableError(response.status);
                }
                if (response.status >= 400) {
                    throw new ApiError(`${label} failed (HTTP ${response.status})`, response.status);
                }
                if (body.trim() === '') {
                    return null;
                }
                try {
                    return JSON.parse(body);
                } catch {
                    throw new ApiError(`${label} returned invalid JSON`, response.status);
                }
            } catch (error) {
                const transient = error instanceof NetworkError || error instanceof ServiceUnavailableError;
                if (!options.retry || retried || !transient || this.http.aborted) {
                    throw error;
                }
                retried = true;
                this.log.debug(`${label} failed (${error.message}) - retrying once`);
                await this.sleep(this.retryDelayMs);
                if (this.http.aborted) {
                    throw new AbortedError();
                }
            }
        }
    }

    private warnOnce(key: string, message: string): void {
        if (this.warned.has(key)) {
            return;
        }
        if (this.warned.size >= MAX_REMEMBERED_WARNINGS) {
            const oldest = this.warned.values().next().value;
            if (oldest !== undefined) {
                this.warned.delete(oldest);
            }
        }
        this.warned.add(key);
        this.log.warn(message);
    }
}
