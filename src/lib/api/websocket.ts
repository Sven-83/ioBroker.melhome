/*
 * WebSocket push connection (docs/api.md section 4).
 *
 * Frames are only triggers: every unit event asks for a /context refresh, REST stays the
 * single source of truth and polling continues unchanged. The connection is best effort -
 * any failure backs off and retries, the adapter works without it.
 *
 * - credential ("hash") from the Lambda via the REST client, a new one for every connection
 * - own ping every 30 s, no pong within 10 s -> connection counts as dead
 * - reconnect with backoff 5 s -> 300 s (+-20 % jitter); the server closes every connection
 *   after 2 h, so a session that lasted >= 60 s reconnects at once and resets the backoff
 * - the hash is part of the URL: neither the URL nor raw library errors reach the log
 */

import WebSocket from 'ws';
import type { Scheduler } from './connection';
import { DEFAULT_ENDPOINTS, USER_AGENT } from './constants';
import { AbortedError, describeError } from './errors';
import type { Logger } from './http';

/** The part of a ws WebSocket this module uses (tests pass a fake) */
export interface SocketLike {
    /** Socket opened or pong received */
    on(event: 'open' | 'pong', listener: () => void): unknown;
    /** Text or binary frame */
    on(event: 'message', listener: (data: unknown) => void): unknown;
    /** Socket closed (always follows an error) */
    on(event: 'close', listener: (code: number) => void): unknown;
    /** Handshake or protocol error */
    on(event: 'error', listener: (error: Error) => void): unknown;
    /** Detaches all listeners */
    removeAllListeners(): unknown;
    /** Sends a protocol ping */
    ping(): void;
    /** Closes the socket immediately */
    terminate(): void;
}

/** Event of a unit pushed by the cloud */
export interface UnitEvent {
    /** Unit UUID */
    unitId: string;
    /** messageType of the frame, e.g. unitStateChanged */
    type: string;
}

/** Dependencies and settings of the real-time connection */
export interface RealtimeOptions {
    /** Delivers a fresh WebSocket credential */
    getHash: () => Promise<string>;
    /** Timer functions of the adapter */
    scheduler: Scheduler;
    /** Adapter logger */
    log: Logger;
    /** Called for every unit event */
    onUnitEvent: (event: UnitEvent) => void;
    /** Called when the socket opens or closes */
    onConnectionChange: (connected: boolean) => void | Promise<void>;
    /** WebSocket host (tests) */
    wsUrl?: string;
    /** Socket factory (tests) */
    createSocket?: (url: string) => SocketLike;
    /** Clock (tests) */
    now?: () => number;
    /** Random number in [0, 1) for the jitter (tests) */
    random?: () => number;
}

const SECOND = 1000;
export const PING_INTERVAL_MS = 30 * SECOND;
export const PONG_TIMEOUT_MS = 10 * SECOND;
export const RECONNECT_INITIAL_MS = 5 * SECOND;
export const RECONNECT_MAX_MS = 300 * SECOND;
/** A session this long counts as stable: reconnect at once, reset the backoff */
export const STABLE_SESSION_MS = 60 * SECOND;
/** Delay before reconnecting after a stable session (normal 2 h server limit) */
export const QUICK_RECONNECT_MS = 1 * SECOND;
const HANDSHAKE_TIMEOUT_MS = 15 * SECOND;
const JITTER = 0.2;

/** Unit message types that trigger a refresh */
const UNIT_EVENTS = new Set(['unitStateChanged', 'unitCommunicationLost', 'unitCommunicationRestored']);

function defaultSocket(url: string): SocketLike {
    return new WebSocket(url, {
        headers: { 'User-Agent': USER_AGENT },
        handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
        perMessageDeflate: true,
    });
}

/**
 * Extracts unit events from one text frame (JSON array or single object, Data or data).
 * Unknown or malformed content is skipped.
 *
 * @param text - Frame payload
 * @param onUnknown - Called with the messageType of frames that are not unit events
 */
export function parseFrame(text: string, onUnknown?: (type: string) => void): UnitEvent[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        onUnknown?.('<invalid JSON>');
        return [];
    }
    const events: UnitEvent[] = [];
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!message || typeof message !== 'object') {
            continue;
        }
        const record = message as Record<string, unknown>;
        const type = typeof record.messageType === 'string' ? record.messageType : '';
        if (!UNIT_EVENTS.has(type)) {
            onUnknown?.(type || '<no messageType>');
            continue;
        }
        const data = record.Data ?? record.data;
        const unitId = data && typeof data === 'object' ? (data as Record<string, unknown>).id : undefined;
        if (typeof unitId === 'string' && unitId) {
            events.push({ unitId, type });
        }
    }
    return events;
}

/**
 * Keeps one WebSocket open while started.
 */
export class RealtimeConnection {
    private readonly options: RealtimeOptions;
    private readonly wsUrl: string;
    private readonly createSocket: (url: string) => SocketLike;
    private readonly now: () => number;
    private readonly random: () => number;
    private readonly unknownLogged = new Set<string>();

    private running = false;
    /** Increases with every start/stop, so late callbacks of an old run are ignored */
    private generation = 0;
    private socket: SocketLike | undefined;
    private connected = false;
    private openedAt = 0;
    private attempt = 0;
    private reconnectTimer: unknown;
    private pingTimer: unknown;
    private pongTimer: unknown;
    private everConnected = false;
    private lossLogged = false;

    /** @param options - Dependencies and callbacks */
    public constructor(options: RealtimeOptions) {
        this.options = options;
        this.wsUrl = options.wsUrl ?? DEFAULT_ENDPOINTS.ws;
        this.createSocket = options.createSocket ?? defaultSocket;
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
    }

    /** True while the socket is open */
    public get isConnected(): boolean {
        return this.connected;
    }

    /** Opens the connection (no-op if already started) */
    public start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.generation++;
        this.attempt = 0;
        void this.connect(this.generation);
    }

    /** Closes the connection and cancels all timers; start() may be called again later */
    public stop(): void {
        if (!this.running) {
            return;
        }
        this.running = false;
        this.generation++;
        this.clearTimer('reconnectTimer');
        this.dropSocket();
    }

    private async connect(generation: number): Promise<void> {
        let hash: string;
        try {
            hash = await this.options.getHash();
        } catch (error) {
            if (generation !== this.generation || error instanceof AbortedError) {
                return;
            }
            this.options.log.debug(`Real-time credential not available: ${describeError(error)}`);
            this.scheduleReconnect(false);
            return;
        }
        if (generation !== this.generation) {
            return;
        }

        let socket: SocketLike;
        try {
            socket = this.createSocket(`${this.wsUrl}/?hash=${encodeURIComponent(hash)}`);
        } catch (error) {
            this.options.log.debug(`Real-time connection could not be created: ${describeError(error)}`);
            this.scheduleReconnect(false);
            return;
        }
        this.socket = socket;

        socket.on('open', () => {
            if (this.socket !== socket) {
                return;
            }
            this.openedAt = this.now();
            this.setConnected(true);
            if (!this.everConnected) {
                this.everConnected = true;
                this.options.log.info('Real-time connection established');
            } else if (this.lossLogged) {
                this.options.log.info('Real-time connection restored');
            } else {
                this.options.log.debug('Real-time connection reopened');
            }
            this.lossLogged = false;
            this.schedulePing();
        });
        socket.on('message', data => {
            if (this.socket === socket) {
                this.onMessage(data);
            }
        });
        socket.on('pong', () => {
            if (this.socket === socket) {
                this.clearTimer('pongTimer');
            }
        });
        socket.on('error', error => {
            // a close event always follows; the message may contain the URL
            this.options.log.debug(`Real-time connection error: ${describeError(error)}`);
        });
        socket.on('close', code => {
            if (this.socket !== socket) {
                return;
            }
            const stable = this.connected && this.now() - this.openedAt >= STABLE_SESSION_MS;
            this.dropSocket();
            this.options.log.debug(`Real-time connection closed (code ${code})`);
            if (this.running) {
                this.scheduleReconnect(stable);
            }
        });
    }

    private onMessage(data: unknown): void {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        const events = parseFrame(text, type => {
            if (!this.unknownLogged.has(type) && this.unknownLogged.size < 50) {
                this.unknownLogged.add(type);
                this.options.log.debug(`Real-time message of type ${type} ignored`);
            }
        });
        for (const event of events) {
            this.options.log.debug(`Real-time event ${event.type} for unit ${event.unitId}`);
            this.options.onUnitEvent(event);
        }
    }

    private schedulePing(): void {
        this.pingTimer = this.options.scheduler.setTimeout(() => {
            this.pingTimer = undefined;
            const socket = this.socket;
            if (!socket || !this.connected) {
                return;
            }
            try {
                socket.ping();
            } catch (error) {
                this.options.log.debug(`Real-time ping failed: ${describeError(error)}`);
            }
            this.pongTimer = this.options.scheduler.setTimeout(() => {
                this.pongTimer = undefined;
                if (this.socket === socket) {
                    this.options.log.debug('Real-time connection silent - reconnecting');
                    // terminate() emits close, which schedules the reconnect
                    socket.terminate();
                }
            }, PONG_TIMEOUT_MS);
            this.schedulePing();
        }, PING_INTERVAL_MS);
    }

    /**
     * @param afterStableSession - The closed session lasted long enough to count as normal operation
     */
    private scheduleReconnect(afterStableSession: boolean): void {
        if (!this.running) {
            return;
        }
        let delay: number;
        if (afterStableSession) {
            this.attempt = 0;
            delay = QUICK_RECONNECT_MS;
        } else {
            const base = Math.min(RECONNECT_INITIAL_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
            delay = Math.round(base * (1 - JITTER + 2 * JITTER * this.random()));
            this.attempt++;
            if (this.everConnected && !this.lossLogged) {
                this.lossLogged = true;
                this.options.log.info('Real-time connection lost - retrying in the background, polling continues');
            }
        }
        const generation = this.generation;
        this.clearTimer('reconnectTimer');
        this.reconnectTimer = this.options.scheduler.setTimeout(() => {
            this.reconnectTimer = undefined;
            if (generation === this.generation) {
                void this.connect(generation);
            }
        }, delay);
    }

    private dropSocket(): void {
        this.clearTimer('pingTimer');
        this.clearTimer('pongTimer');
        const socket = this.socket;
        this.socket = undefined;
        if (socket) {
            socket.removeAllListeners();
            // keep a listener so a late error of the dropped socket cannot crash the process
            socket.on('error', () => undefined);
            try {
                socket.terminate();
            } catch {
                // already closed
            }
        }
        this.setConnected(false);
    }

    private setConnected(connected: boolean): void {
        if (this.connected === connected) {
            return;
        }
        this.connected = connected;
        Promise.resolve(this.options.onConnectionChange(connected)).catch(error => {
            this.options.log.debug(`Real-time status update failed: ${describeError(error)}`);
        });
    }

    private clearTimer(name: 'reconnectTimer' | 'pingTimer' | 'pongTimer'): void {
        if (this[name] !== undefined) {
            this.options.scheduler.clearTimeout(this[name]);
            this[name] = undefined;
        }
    }
}
