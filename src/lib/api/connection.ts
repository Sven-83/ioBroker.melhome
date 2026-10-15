/*
 * Central connection manager (docs/api.md section 2.3).
 *
 * Drives the /context polling and decides how to retry after failures. It never gives up:
 * every failure leads to another attempt, only the delay depends on the kind of failure.
 * Login/refresh are triggered implicitly through the client's token handling, so there is
 * exactly one place that starts requests and never two logins at the same time.
 *
 * Log discipline: state changes as info/warn/error, repetitions on debug only.
 */

import {
    AbortedError,
    CredentialsRejectedError,
    LoginFlowError,
    NetworkError,
    ServiceUnavailableError,
    TokenRejectedError,
    describeError,
} from './errors';
import type { Logger, Scheduler } from './http';
import type { UserContext } from './types';

export type { Scheduler } from './http';

/** Something that delivers the user context */
export interface ContextSource {
    /** Fetches /context */
    getContext(): Promise<UserContext>;
}

export type FailureKind = 'network' | 'service' | 'login' | 'credentials' | 'api';

interface Backoff {
    initialMs: number;
    maxMs: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Retry delays per failure kind once the connection counts as lost */
export const BACKOFF: Readonly<Record<FailureKind, Backoff>> = Object.freeze({
    network: { initialMs: 30 * SECOND, maxMs: 5 * MINUTE },
    service: { initialMs: 120 * SECOND, maxMs: 15 * MINUTE },
    login: { initialMs: 60 * SECOND, maxMs: 15 * MINUTE },
    // slow on purpose: many failed logins could lock the account at Cognito
    credentials: { initialMs: 30 * MINUTE, maxMs: 30 * MINUTE },
    api: { initialMs: 120 * SECOND, maxMs: 15 * MINUTE },
});

/** Delay of a refresh requested after a command or a WebSocket event */
export const DEFAULT_REFRESH_DELAY_MS = 2000;

/** Dependencies and settings of the connection manager */
export interface ConnectionManagerOptions {
    /** Delivers /context */
    source: ContextSource;
    /** Timer functions of the adapter */
    scheduler: Scheduler;
    /** Adapter logger */
    log: Logger;
    /** Regular polling interval (ms) */
    pollIntervalMs: number;
    /** Called with every successfully fetched context */
    onContext: (context: UserContext) => void | Promise<void>;
    /** Called when the connection state changes */
    onConnectionChange: (connected: boolean) => void | Promise<void>;
    /** Failed polls tolerated before the connection counts as lost (default 2) */
    failureTolerance?: number;
}

/**
 * Classifies an error for the retry strategy.
 *
 * @param error - Error thrown by the API layer
 */
export function classifyFailure(error: unknown): FailureKind {
    if (error instanceof CredentialsRejectedError) {
        return 'credentials';
    }
    if (error instanceof LoginFlowError || error instanceof TokenRejectedError) {
        return 'login';
    }
    if (error instanceof NetworkError) {
        return 'network';
    }
    if (error instanceof ServiceUnavailableError) {
        return 'service';
    }
    return 'api';
}

/**
 * Human readable duration for log messages.
 *
 * @param ms - Duration in ms
 */
export function formatDuration(ms: number): string {
    return ms >= MINUTE && ms % MINUTE === 0 ? `${ms / MINUTE} min` : `${Math.round(ms / SECOND)} s`;
}

/**
 * Polls /context and keeps the connection alive in every situation.
 */
export class ConnectionManager {
    private readonly options: ConnectionManagerOptions;
    private readonly tolerance: number;
    private connected: boolean | undefined;
    private failures = 0;
    private offlineAttempts = 0;
    private lastFailureKind: FailureKind | undefined;
    private timer: unknown;
    private polling = false;
    private refreshRequested = false;
    private started = false;
    private stopped = false;

    /** @param options - Dependencies and settings */
    public constructor(options: ConnectionManagerOptions) {
        this.options = options;
        this.tolerance = options.failureTolerance ?? 2;
    }

    /** Current connection state (undefined before the first attempt finished) */
    public get isConnected(): boolean {
        return this.connected === true;
    }

    /** Starts polling immediately */
    public start(): void {
        if (this.started || this.stopped) {
            return;
        }
        this.started = true;
        this.schedule(0);
    }

    /** Stops polling; a running request is left to the transport abort */
    public stop(): void {
        this.stopped = true;
        this.clearTimer();
    }

    /**
     * Requests a /context refresh soon (after commands or WebSocket events). Calls within the
     * delay are merged. Ignored while the connection is down - the backoff stays in charge.
     *
     * @param delayMs - Debounce delay
     */
    public requestRefresh(delayMs = DEFAULT_REFRESH_DELAY_MS): void {
        if (!this.started || this.stopped || this.connected !== true) {
            return;
        }
        if (this.polling) {
            this.refreshRequested = true;
            return;
        }
        this.schedule(delayMs);
    }

    private schedule(delayMs: number): void {
        if (this.stopped) {
            return;
        }
        this.clearTimer();
        this.timer = this.options.scheduler.setTimeout(() => {
            this.timer = undefined;
            void this.poll();
        }, delayMs);
    }

    private clearTimer(): void {
        if (this.timer !== undefined) {
            this.options.scheduler.clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private async poll(): Promise<void> {
        if (this.stopped || this.polling) {
            return;
        }
        this.polling = true;
        this.refreshRequested = false;
        let nextDelay: number;
        try {
            const context = await this.options.source.getContext();
            if (this.stopped) {
                return;
            }
            await this.handleSuccess(context);
            nextDelay = this.refreshRequested ? DEFAULT_REFRESH_DELAY_MS : this.options.pollIntervalMs;
        } catch (error) {
            if (this.stopped || error instanceof AbortedError) {
                return;
            }
            nextDelay = await this.handleFailure(error);
        } finally {
            this.polling = false;
        }
        this.schedule(nextDelay);
    }

    private async handleSuccess(context: UserContext): Promise<void> {
        const wasConnected = this.connected;
        this.failures = 0;
        this.offlineAttempts = 0;
        this.lastFailureKind = undefined;
        if (wasConnected !== true) {
            this.options.log.info(
                wasConnected === false
                    ? 'Connection to MELCloud Home restored'
                    : `Connected to MELCloud Home (${context.ataUnits.length} air-to-air unit(s))`,
            );
            await this.setConnected(true);
        }
        try {
            await this.options.onContext(context);
        } catch (error) {
            // processing problems are not connection problems
            this.options.log.error(`Processing MELCloud Home data failed: ${describeError(error)}`);
        }
    }

    /**
     * Updates counters, logs and returns the delay until the next attempt.
     *
     * @param error - Error of the failed poll
     */
    private async handleFailure(error: unknown): Promise<number> {
        const { log, pollIntervalMs } = this.options;
        const kind = classifyFailure(error);
        const reason = describeError(error);
        const kindChanged = kind !== this.lastFailureKind;
        this.lastFailureKind = kind;
        this.failures++;

        if (kind === 'credentials') {
            const delay = BACKOFF.credentials.initialMs;
            if (kindChanged) {
                log.error(
                    `MELCloud Home rejected the login - please check e-mail and password. Retrying every ${formatDuration(delay)}`,
                );
            } else {
                log.debug(`Login still rejected - retrying in ${formatDuration(delay)}`);
            }
            await this.setConnected(false);
            return delay;
        }

        // short glitches while connected are tolerated without changing the state
        if (this.connected === true && this.failures <= this.tolerance) {
            log.debug(
                `Update from MELCloud Home failed (${reason}) - attempt ${this.failures}/${this.tolerance + 1}, retrying in ${formatDuration(pollIntervalMs)}`,
            );
            return pollIntervalMs;
        }

        const backoff = BACKOFF[kind];
        const delay = Math.min(backoff.initialMs * 2 ** this.offlineAttempts, backoff.maxMs);
        this.offlineAttempts++;
        if (this.connected !== false || kindChanged) {
            const prefix =
                this.connected === true ? 'Connection to MELCloud Home lost' : 'Cannot connect to MELCloud Home';
            log.warn(`${prefix}: ${reason} - retrying in ${formatDuration(delay)}`);
        } else {
            log.debug(`Still no connection to MELCloud Home (${reason}) - retrying in ${formatDuration(delay)}`);
        }
        await this.setConnected(false);
        return delay;
    }

    private async setConnected(connected: boolean): Promise<void> {
        if (this.connected === connected) {
            return;
        }
        this.connected = connected;
        try {
            await this.options.onConnectionChange(connected);
        } catch (error) {
            this.options.log.error(`Updating the connection state failed: ${describeError(error)}`);
        }
    }
}
