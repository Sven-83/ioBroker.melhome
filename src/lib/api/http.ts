/*
 * HTTP transport shared by auth and REST client:
 * - one request at a time with a minimum spacing (rate-limit protection, docs/api.md section 6)
 * - timeout and shutdown abort
 * - maps low-level failures to NetworkError / AbortedError
 */

import { HTTP_TIMEOUT_MS, MIN_REQUEST_INTERVAL_MS } from './constants';
import { AbortedError, NetworkError, describeError } from './errors';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Minimal logger interface (matches ioBroker.Logger) */
export interface Logger {
    /** Debug message */
    debug(message: string): void;
    /** Info message */
    info(message: string): void;
    /** Warning */
    warn(message: string): void;
    /** Error */
    error(message: string): void;
}

/** Settings of the transport */
export interface HttpTransportOptions {
    /** fetch implementation, defaults to the global fetch */
    fetch?: FetchFn;
    /** Minimum spacing between two requests in ms */
    minIntervalMs?: number;
    /** Timeout per request in ms */
    timeoutMs?: number;
    /** Clock, injectable for tests */
    now?: () => number;
    /** Sleep function, injectable for tests */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * Serialised, paced and abortable fetch.
 */
export class HttpTransport {
    private readonly fetchFn: FetchFn;
    private readonly minIntervalMs: number;
    private readonly timeoutMs: number;
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly shutdown = new AbortController();
    private queue: Promise<void> = Promise.resolve();
    private lastRequestAt = 0;

    /** @param options - Settings, mainly for tests */
    public constructor(options: HttpTransportOptions = {}) {
        this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
        this.minIntervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
        this.timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
        this.now = options.now ?? Date.now;
        this.sleep = options.sleep ?? (ms => this.abortableSleep(ms));
    }

    /**
     * Waits, but returns early when the transport is aborted (no timer survives unload).
     *
     * @param ms - Wait time
     */
    public abortableSleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            if (this.aborted) {
                resolve();
                return;
            }
            let timer: NodeJS.Timeout | undefined = undefined;
            const done = (): void => {
                clearTimeout(timer);
                this.shutdown.signal.removeEventListener('abort', done);
                resolve();
            };
            timer = setTimeout(done, ms);
            this.shutdown.signal.addEventListener('abort', done);
        });
    }

    /** True after {@link abort} was called */
    public get aborted(): boolean {
        return this.shutdown.signal.aborted;
    }

    /** Aborts running and all future requests (adapter unload) */
    public abort(): void {
        this.shutdown.abort();
    }

    /**
     * Performs one request. The response body is read completely before the
     * next queued request may start.
     *
     * @param url - Absolute URL
     * @param init - fetch options (signal is managed here)
     */
    public async request(url: string, init: RequestInit = {}): Promise<{ response: Response; body: string }> {
        const run = this.queue.then(() => this.execute(url, init));
        // keep the queue alive regardless of the outcome of this request
        this.queue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    private async execute(url: string, init: RequestInit): Promise<{ response: Response; body: string }> {
        if (this.aborted) {
            throw new AbortedError();
        }
        const wait = this.lastRequestAt + this.minIntervalMs - this.now();
        if (wait > 0) {
            await this.sleep(wait);
            if (this.aborted) {
                throw new AbortedError();
            }
        }
        this.lastRequestAt = this.now();

        const controller = new AbortController();
        const onShutdown = (): void => controller.abort();
        this.shutdown.signal.addEventListener('abort', onShutdown);
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, this.timeoutMs);

        try {
            const response = await this.fetchFn(url, { ...init, signal: controller.signal });
            const body = await response.text();
            return { response, body };
        } catch (error) {
            if (this.aborted) {
                throw new AbortedError();
            }
            if (timedOut) {
                throw new NetworkError(`Request timed out after ${Math.round(this.timeoutMs / 1000)} s`);
            }
            throw new NetworkError(`Network error: ${describeNetworkError(error)}`);
        } finally {
            clearTimeout(timer);
            this.shutdown.signal.removeEventListener('abort', onShutdown);
        }
    }
}

/**
 * Node's fetch reports "fetch failed" and hides the real reason in `cause`.
 *
 * @param error - Error thrown by fetch
 */
function describeNetworkError(error: unknown): string {
    if (error instanceof Error && error.cause) {
        const cause = error.cause as { code?: string; message?: string };
        return describeError(cause.code ?? cause.message ?? error.message);
    }
    return describeError(error);
}
