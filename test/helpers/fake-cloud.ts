/*
 * In-memory simulation of the MELCloud Home cloud for unit tests:
 * IdentityServer (PAR, authorize, callback, token), Cognito login form and the mobile BFF.
 * Replaces fetch - no network access in tests.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ENDPOINTS } from '../../src/lib/api/constants';
import type { FetchFn, Logger } from '../../src/lib/api/http';

export const FIXTURES = join(__dirname, '..', 'fixtures');

/**
 * Reads a fixture file.
 *
 * @param name - File name in test/fixtures
 */
export function fixture(name: string): string {
    return readFileSync(join(FIXTURES, name), 'utf8');
}

export const COGNITO = 'https://live-melcloudhome.auth.eu-west-1.amazoncognito.com';
export const EMAIL = 'user@example.invalid';
export const PASSWORD = 'correct horse battery staple';

/** A recorded request */
export interface RecordedRequest {
    /** HTTP method */
    method: string;
    /** Full URL */
    url: string;
    /** Request headers */
    headers: Headers;
    /** Request body */
    body: string;
}

/** Injected failure for the next matching request */
export interface Fault {
    /** Applies to URLs matching this pattern */
    match: RegExp;
    /** HTTP status to answer, or a network error */
    response: number | 'network';
    /** Response headers, e.g. Retry-After */
    headers?: Record<string, string>;
}

/**
 * Fake cloud with switches for every failure scenario.
 */
export class FakeCloud {
    public readonly requests: RecordedRequest[] = [];
    public readonly controlBodies: unknown[] = [];
    public password = PASSWORD;
    /** Lifetime of issued access tokens (s) */
    public tokenLifetime = 3600;
    /** IdentityServer still has a session: authorize redirects straight to the app */
    public sessionShortcut = false;
    /** Refresh tokens are rejected (session ended on the server) */
    public rejectRefresh = false;
    /** HTML served as Cognito login page */
    public loginPage = fixture('cognito-login.html');
    public contextBody = fixture('context.json');
    public faults: Fault[] = [];
    public loginCount = 0;
    public refreshCount = 0;

    private readonly validAccess = new Set<string>();
    private readonly validRefresh = new Set<string>();
    private readonly codes = new Map<string, string>();
    private counter = 0;
    private challenge = '';

    /**
     * fetch replacement
     *
     * @param input - URL
     * @param init - Request options
     */
    public readonly fetch: FetchFn = (input, init = {}) => {
        const method = (init.method ?? 'GET').toUpperCase();
        const headers = new Headers(init.headers);
        const body = typeof init.body === 'string' ? init.body : '';
        this.requests.push({ method, url: input, headers, body });

        if (init.signal?.aborted) {
            return Promise.reject(new DOMException('aborted', 'AbortError'));
        }
        const faultIndex = this.faults.findIndex(f => f.match.test(input));
        if (faultIndex >= 0) {
            const [fault] = this.faults.splice(faultIndex, 1);
            if (fault.response === 'network') {
                return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }));
            }
            const nullBody = fault.response === 204 || fault.response === 304;
            return Promise.resolve(
                new Response(nullBody ? null : '{"error":"injected"}', {
                    status: fault.response,
                    headers: fault.headers,
                }),
            );
        }
        return Promise.resolve(this.route(method, new URL(input), headers, body));
    };

    /** Invalidates all access tokens (server-side expiry) */
    public expireAccessTokens(): void {
        this.validAccess.clear();
    }

    /**
     * Number of requests to a path (substring match)
     *
     * @param pathPart - Part of the URL
     */
    public count(pathPart: string): number {
        return this.requests.filter(r => r.url.includes(pathPart)).length;
    }

    private next(prefix: string): string {
        this.counter++;
        return `${prefix}-${this.counter}`;
    }

    private issueTokens(): Response {
        const access = this.next('access');
        const refresh = this.next('refresh');
        this.validAccess.add(access);
        this.validRefresh.add(refresh);
        return json(200, {
            access_token: access,
            refresh_token: refresh,
            expires_in: this.tokenLifetime,
            token_type: 'Bearer',
        });
    }

    private route(method: string, url: URL, headers: Headers, body: string): Response {
        const auth = DEFAULT_ENDPOINTS.auth;
        const path = url.pathname;

        if (url.origin === auth && path === '/connect/par' && method === 'POST') {
            const form = new URLSearchParams(body);
            this.challenge = form.get('code_challenge') ?? '';
            if (form.get('client_id') !== 'homemobile' || form.get('code_challenge_method') !== 'S256') {
                return json(400, { error: 'invalid_request' });
            }
            return json(201, { request_uri: 'urn:ietf:params:oauth:request_uri:fake', expires_in: 90 });
        }
        if (url.origin === auth && path === '/connect/authorize') {
            if (this.sessionShortcut) {
                return redirect(`melcloudhome://?code=${this.issueCode()}&state=x`);
            }
            return redirect(
                `${COGNITO}/oauth2/authorize?client_id=fakeclient`,
                'idsrv.external=1; Path=/; Secure; HttpOnly',
            );
        }
        if (url.origin === COGNITO && path === '/oauth2/authorize') {
            return redirect('/login?client_id=fakeclient&state=fakestate', 'XSRF-TOKEN=cognito-xsrf; Path=/; Secure');
        }
        if (url.origin === COGNITO && path === '/login' && method === 'GET') {
            return html(200, this.loginPage);
        }
        if (url.origin === COGNITO && path === '/login' && method === 'POST') {
            const form = new URLSearchParams(body);
            const cookieOk = (headers.get('cookie') ?? '').includes('XSRF-TOKEN=cognito-xsrf');
            if (!cookieOk || form.get('_csrf') !== '00000000-csrf-token-0000') {
                return html(403, 'csrf failed');
            }
            if (form.get('username') !== EMAIL || form.get('password') !== this.password) {
                return html(200, `${this.loginPage}<p class="error">Incorrect username or password.</p>`);
            }
            return redirect(`${auth}/signin-oidc?code=cognito-code&state=fakestate`);
        }
        if (url.origin === auth && path === '/signin-oidc') {
            if (!(headers.get('cookie') ?? '').includes('idsrv.external=1')) {
                return html(400, 'missing correlation cookie');
            }
            return html(
                200,
                '<html><body><a href="/connect/authorize/callback?client_id=homemobile&amp;request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Afake">continue</a></body></html>',
            );
        }
        if (url.origin === auth && path === '/connect/authorize/callback') {
            return redirect(`melcloudhome://?code=${this.issueCode()}&scope=openid&state=x`);
        }
        if (url.origin === auth && path === '/connect/token' && method === 'POST') {
            return this.token(new URLSearchParams(body));
        }
        return this.api(method, url, headers, body);
    }

    private issueCode(): string {
        const code = this.next('code');
        this.codes.set(code, this.challenge);
        return code;
    }

    private token(form: URLSearchParams): Response {
        if (form.get('grant_type') === 'authorization_code') {
            const code = form.get('code') ?? '';
            const challenge = this.codes.get(code);
            this.codes.delete(code);
            const verifier = form.get('code_verifier') ?? '';
            const expected = createHash('sha256').update(verifier).digest('base64url');
            if (challenge === undefined || challenge !== expected) {
                return json(400, { error: 'invalid_grant' });
            }
            this.loginCount++;
            return this.issueTokens();
        }
        if (form.get('grant_type') === 'refresh_token') {
            const refresh = form.get('refresh_token') ?? '';
            if (this.rejectRefresh || !this.validRefresh.has(refresh)) {
                return json(400, { error: 'invalid_grant' });
            }
            this.validRefresh.delete(refresh); // single use
            this.refreshCount++;
            return this.issueTokens();
        }
        return json(400, { error: 'unsupported_grant_type' });
    }

    private api(method: string, url: URL, headers: Headers, body: string): Response {
        const token = (headers.get('authorization') ?? '').replace(/^Bearer /, '');
        const isApi = url.origin === DEFAULT_ENDPOINTS.api || url.href === DEFAULT_ENDPOINTS.wsHash;
        if (!isApi) {
            return html(404, 'not found');
        }
        if (!this.validAccess.has(token)) {
            return new Response('', { status: 401 });
        }
        if (url.href === DEFAULT_ENDPOINTS.wsHash) {
            return json(200, { hash: 'ws-secret-hash', userId: 'user' });
        }
        const path = url.pathname;
        if (path === '/context' && method === 'GET') {
            return new Response(this.contextBody, { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        if (path.startsWith('/monitor/ataunit/') && method === 'PUT') {
            this.controlBodies.push(JSON.parse(body));
            return new Response('', { status: 200 });
        }
        if (path.startsWith('/telemetry/telemetry/energy/')) {
            return new Response(fixture('energy.json'), { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        if (path.startsWith('/telemetry/telemetry/actual/')) {
            return new Response(fixture('rssi.json'), { status: 200 });
        }
        if (path === '/report/v1/trendsummary') {
            return new Response(fixture('trendsummary.json'), { status: 200 });
        }
        return new Response('', { status: 404 });
    }
}

function json(status: number, data: unknown): Response {
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function html(status: number, text: string): Response {
    return new Response(text, { status, headers: { 'content-type': 'text/html' } });
}

function redirect(location: string, cookie?: string): Response {
    const headers = new Headers({ location });
    if (cookie) {
        headers.append('set-cookie', cookie);
    }
    return new Response(null, { status: 302, headers });
}

/** Logger that records all messages */
export class CaptureLog implements Logger {
    public readonly entries: { level: string; message: string }[] = [];

    /** @param message - Message */
    public debug(message: string): void {
        this.entries.push({ level: 'debug', message });
    }
    /** @param message - Message */
    public info(message: string): void {
        this.entries.push({ level: 'info', message });
    }
    /** @param message - Message */
    public warn(message: string): void {
        this.entries.push({ level: 'warn', message });
    }
    /** @param message - Message */
    public error(message: string): void {
        this.entries.push({ level: 'error', message });
    }

    /**
     * Messages of one level.
     *
     * @param level - Log level
     */
    public at(level: string): string[] {
        return this.entries.filter(e => e.level === level).map(e => e.message);
    }

    /** All messages as one text */
    public get text(): string {
        return this.entries.map(e => `${e.level}: ${e.message}`).join('\n');
    }
}

/** Timer replacement that runs callbacks on demand and records the delays */
export class ManualScheduler {
    public readonly pending: { id: number; callback: () => void; ms: number }[] = [];
    private nextId = 1;

    /**
     * @param callback - Callback
     * @param ms - Delay
     */
    public setTimeout(callback: () => void, ms: number): unknown {
        const id = this.nextId++;
        this.pending.push({ id, callback, ms });
        return id;
    }

    /** @param handle - Timer id */
    public clearTimeout(handle: unknown): void {
        const index = this.pending.findIndex(t => t.id === handle);
        if (index >= 0) {
            this.pending.splice(index, 1);
        }
    }

    /** Delay of the only pending timer */
    public get nextDelay(): number | undefined {
        return this.pending[0]?.ms;
    }

    /** Runs the next timer and waits until the triggered work has scheduled a new timer */
    public async runNext(): Promise<void> {
        const timer = this.pending.shift();
        if (!timer) {
            throw new Error('No timer pending');
        }
        timer.callback();
        await settle(() => this.pending.length > 0);
    }

    /**
     * Runs the first pending timer with the given delay and lets the triggered work finish.
     *
     * @param ms - Delay the timer was scheduled with
     */
    public async run(ms: number): Promise<void> {
        const index = this.pending.findIndex(t => t.ms === ms);
        if (index < 0) {
            throw new Error(`No timer with ${ms} ms pending (pending: ${this.pending.map(t => t.ms).join(', ')})`);
        }
        const [timer] = this.pending.splice(index, 1);
        timer.callback();
        await settle();
    }

    /**
     * True if a timer with this delay is pending.
     *
     * @param ms - Delay
     */
    public has(ms: number): boolean {
        return this.pending.some(t => t.ms === ms);
    }
}

/**
 * Lets pending promises run until the condition holds (or gives up after many rounds).
 *
 * @param condition - Stop condition
 */
export async function settle(condition: () => boolean = () => false): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}
