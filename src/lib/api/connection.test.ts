/*
 * One test per row of the reconnection table in docs/api.md section 2.3.
 */

import { expect } from 'chai';
import { CaptureLog, EMAIL, FakeCloud, ManualScheduler, PASSWORD, settle } from '../../../test/helpers/fake-cloud';
import { AuthClient, TokenManager } from './auth';
import { MelCloudHomeClient } from './client';
import {
    BACKOFF,
    ConnectionManager,
    START_JITTER_MS,
    classifyFailure,
    formatDuration,
    type ContextSource,
} from './connection';
import {
    AbortedError,
    ApiError,
    CredentialsRejectedError,
    LoginFlowError,
    NetworkError,
    RateLimitedError,
    ServiceUnavailableError,
    TokenRejectedError,
} from './errors';
import { HttpTransport } from './http';
import type { UserContext } from './types';

const POLL = 60_000;
const MIN = 60_000;
const EMPTY: UserContext = { ataUnits: [], atwUnitCount: 0 };

/** Context source whose next results can be scripted */
class ScriptedSource implements ContextSource {
    public readonly results: (Error | UserContext)[] = [];
    public calls = 0;
    public fallback: Error | UserContext = EMPTY;

    public getContext(): Promise<UserContext> {
        this.calls++;
        const next = this.results.length > 0 ? this.results.shift()! : this.fallback;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    }
}

function setup(source: ContextSource = new ScriptedSource()): {
    manager: ConnectionManager;
    scheduler: ManualScheduler;
    log: CaptureLog;
    states: boolean[];
    contexts: UserContext[];
} {
    const scheduler = new ManualScheduler();
    const log = new CaptureLog();
    const states: boolean[] = [];
    const contexts: UserContext[] = [];
    const manager = new ConnectionManager({
        source,
        scheduler,
        log,
        pollIntervalMs: POLL,
        startJitterMs: 0,
        onConnectionChange: connected => {
            states.push(connected);
        },
        onContext: context => {
            contexts.push(context);
        },
    });
    return { manager, scheduler, log, states, contexts };
}

/**
 * Runs n poll cycles and returns the delays scheduled after each one.
 *
 * @param scheduler - Scheduler
 * @param n - Number of cycles
 */
async function cycles(scheduler: ManualScheduler, n: number): Promise<number[]> {
    const delays: number[] = [];
    for (let i = 0; i < n; i++) {
        await scheduler.runNext();
        delays.push(scheduler.nextDelay!);
    }
    return delays;
}

describe('api/connection', () => {
    it('classifies failures', () => {
        expect(classifyFailure(new NetworkError('x'))).to.equal('network');
        expect(classifyFailure(new ServiceUnavailableError(503))).to.equal('service');
        expect(classifyFailure(new RateLimitedError(1000))).to.equal('rateLimit');
        expect(classifyFailure(new CredentialsRejectedError())).to.equal('credentials');
        expect(classifyFailure(new LoginFlowError('x'))).to.equal('login');
        expect(classifyFailure(new TokenRejectedError('x'))).to.equal('login');
        expect(classifyFailure(new ApiError('x', 404))).to.equal('api');
        expect(classifyFailure(new Error('x'))).to.equal('api');
        expect(formatDuration(30_000)).to.equal('30 s');
        expect(formatDuration(15 * MIN)).to.equal('15 min');
    });

    it('delays the first poll by a random start jitter', () => {
        const scheduler = new ManualScheduler();
        const manager = new ConnectionManager({
            source: new ScriptedSource(),
            scheduler,
            log: new CaptureLog(),
            pollIntervalMs: POLL,
            random: () => 0.5,
            onConnectionChange: () => undefined,
            onContext: () => undefined,
        });
        manager.start();
        expect(scheduler.nextDelay).to.equal(START_JITTER_MS / 2);
    });

    it('waits at least as long as Retry-After demands (HTTP 429)', async () => {
        const source = new ScriptedSource();
        const { manager, scheduler } = setup(source);
        manager.start();
        await scheduler.runNext();
        // while connected: the tolerated failure waits for Retry-After instead of the poll interval
        source.results.push(new RateLimitedError(5 * MIN));
        expect(await cycles(scheduler, 1)).to.deep.equal([5 * MIN]);
        // a short Retry-After never shortens the poll interval
        source.results.push(new RateLimitedError(1000));
        expect(await cycles(scheduler, 1)).to.deep.equal([POLL]);
        // offline: backoff of the rate limit kind, but never below Retry-After
        source.results.push(new RateLimitedError(), new RateLimitedError(20 * MIN));
        expect(await cycles(scheduler, 2)).to.deep.equal([BACKOFF.rateLimit.initialMs, 20 * MIN]);
        expect(manager.isConnected).to.equal(false);
    });

    it('connects and polls at the configured interval', async () => {
        const { manager, scheduler, log, states, contexts } = setup();
        manager.start();
        expect(scheduler.nextDelay).to.equal(0);
        expect(await cycles(scheduler, 3)).to.deep.equal([POLL, POLL, POLL]);
        expect(states).to.deep.equal([true]);
        expect(contexts).to.have.length(3);
        expect(manager.isConnected).to.equal(true);
        expect(log.at('info')).to.deep.equal(['Connected to MELCloud Home (0 air-to-air unit(s))']);
    });

    it('row "network down / DNS / timeout": 30 s doubling up to 5 min, forever', async () => {
        const source = new ScriptedSource();
        source.fallback = new NetworkError('Network error: ENOTFOUND');
        const { manager, scheduler, log, states } = setup(source);
        manager.start();
        const delays = await cycles(scheduler, 8);
        expect(delays).to.deep.equal([30_000, 60_000, 120_000, 240_000, 5 * MIN, 5 * MIN, 5 * MIN, 5 * MIN]);
        expect(states).to.deep.equal([false]);
        // one warning, repetitions on debug only
        expect(log.at('warn')).to.have.length(1);
        expect(log.at('warn')[0]).to.include('Cannot connect to MELCloud Home').and.include('30 s');
        expect(log.at('debug').length).to.equal(7);
    });

    it('row "adapter start without internet": recovers without restart', async () => {
        const source = new ScriptedSource();
        source.results.push(new NetworkError('offline'), new NetworkError('offline'));
        const { manager, scheduler, log, states } = setup(source);
        manager.start();
        const delays = await cycles(scheduler, 4);
        expect(delays).to.deep.equal([30_000, 60_000, POLL, POLL]);
        expect(states).to.deep.equal([false, true]);
        expect(log.at('info')).to.include('Connection to MELCloud Home restored');
    });

    it('row "cloud outage (5xx)": tolerates 2 failures, then 120 s doubling up to 15 min', async () => {
        const source = new ScriptedSource();
        source.results.push(EMPTY);
        for (let i = 0; i < 9; i++) {
            source.results.push(new ServiceUnavailableError(503));
        }
        const { manager, scheduler, log, states } = setup(source);
        manager.start();
        const delays = await cycles(scheduler, 11);
        expect(delays).to.deep.equal([
            POLL, // connected
            POLL, // failure 1 - tolerated
            POLL, // failure 2 - tolerated
            120_000, // failure 3 - offline
            240_000,
            480_000,
            900_000,
            900_000,
            900_000,
            900_000,
            POLL, // recovered
        ]);
        expect(states).to.deep.equal([true, false, true]);
        expect(log.at('warn')).to.have.length(1);
        expect(log.at('warn')[0]).to.include('Connection to MELCloud Home lost');
        expect(log.at('info')).to.include('Connection to MELCloud Home restored');
    });

    it('resets the tolerance after a success', async () => {
        const source = new ScriptedSource();
        source.results.push(EMPTY, new NetworkError('x'), new NetworkError('x'), EMPTY, new NetworkError('x'));
        const { manager, scheduler, states } = setup(source);
        manager.start();
        expect(await cycles(scheduler, 5)).to.deep.equal([POLL, POLL, POLL, POLL, POLL]);
        expect(states).to.deep.equal([true]);
    });

    it('row "credentials rejected": logs one error and retries every 30 min until it works', async () => {
        const source = new ScriptedSource();
        source.results.push(EMPTY, ...Array.from({ length: 4 }, () => new CredentialsRejectedError()));
        const { manager, scheduler, log, states } = setup(source);
        manager.start();
        const delays = await cycles(scheduler, 6);
        expect(delays).to.deep.equal([POLL, 30 * MIN, 30 * MIN, 30 * MIN, 30 * MIN, POLL]);
        expect(states).to.deep.equal([true, false, true]);
        expect(log.at('error')).to.have.length(1);
        expect(log.at('error')[0]).to.include('rejected the login');
        expect(BACKOFF.credentials.maxMs).to.equal(30 * MIN);
    });

    it('row "re-login fails technically": 60 s doubling up to 15 min', async () => {
        const source = new ScriptedSource();
        source.fallback = new LoginFlowError('Login page has no CSRF token');
        const { manager, scheduler, log } = setup(source);
        manager.start();
        expect(await cycles(scheduler, 6)).to.deep.equal([60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
        expect(log.at('warn')[0]).to.include('CSRF');
    });

    it('logs again when the kind of failure changes', async () => {
        const source = new ScriptedSource();
        source.results.push(new NetworkError('dns'), new NetworkError('dns'), new ServiceUnavailableError(502));
        const { manager, scheduler, log } = setup(source);
        manager.start();
        await cycles(scheduler, 3);
        expect(log.at('warn')).to.have.length(2);
    });

    it('requestRefresh debounces and is ignored while offline', async () => {
        const source = new ScriptedSource();
        const { manager, scheduler } = setup(source);
        manager.requestRefresh();
        expect(scheduler.pending).to.have.length(0, 'ignored before start');
        manager.start();
        await scheduler.runNext();
        manager.requestRefresh();
        manager.requestRefresh();
        expect(scheduler.pending.map(t => t.ms)).to.deep.equal([2000]);

        source.results.push(new NetworkError('x'), new NetworkError('x'), new NetworkError('x'));
        await cycles(scheduler, 3);
        expect(manager.isConnected).to.equal(false);
        const delay = scheduler.nextDelay;
        manager.requestRefresh();
        expect(scheduler.nextDelay).to.equal(delay);
    });

    it('requestRefresh during a running poll triggers a quick follow-up', async () => {
        let release: (() => void) | undefined;
        const source: ContextSource = {
            getContext: () =>
                new Promise(resolve => {
                    release = () => resolve(EMPTY);
                }),
        };
        const { manager, scheduler } = setup(source);
        manager.start();
        scheduler.pending.shift()!.callback(); // poll 1 running
        release!();
        await settle(() => scheduler.pending.length > 0);
        scheduler.pending.shift()!.callback(); // poll 2 running
        manager.requestRefresh();
        expect(scheduler.pending).to.have.length(0);
        release!();
        await settle(() => scheduler.pending.length > 0);
        expect(scheduler.nextDelay).to.equal(2000);
    });

    it('stop clears the timer and ignores late results', async () => {
        let release: ((value: UserContext) => void) | undefined;
        const source: ContextSource = {
            getContext: () =>
                new Promise(resolve => {
                    release = resolve;
                }),
        };
        const { manager, scheduler, states, contexts } = setup(source);
        manager.start();
        scheduler.pending.shift()!.callback();
        manager.stop();
        release!(EMPTY);
        await settle();
        expect(scheduler.pending).to.have.length(0);
        expect(states).to.deep.equal([]);
        expect(contexts).to.deep.equal([]);
        manager.start();
        expect(scheduler.pending).to.have.length(0, 'no restart after stop');
    });

    it('treats an aborted request as shutdown, not as failure', async () => {
        const source = new ScriptedSource();
        source.results.push(new AbortedError());
        const { manager, scheduler, states, log } = setup(source);
        manager.start();
        await scheduler.runNext().catch(() => undefined);
        await settle();
        expect(states).to.deep.equal([]);
        expect(log.at('warn')).to.deep.equal([]);
    });

    it('keeps the connection if processing the data fails', async () => {
        const scheduler = new ManualScheduler();
        const log = new CaptureLog();
        const manager = new ConnectionManager({
            source: new ScriptedSource(),
            scheduler,
            log,
            pollIntervalMs: POLL,
            onConnectionChange: () => undefined,
            onContext: () => {
                throw new Error('broken object tree');
            },
        });
        manager.start();
        await scheduler.runNext();
        expect(manager.isConnected).to.equal(true);
        expect(scheduler.nextDelay).to.equal(POLL);
        expect(log.at('error')[0]).to.include('broken object tree');
    });

    describe('end to end with the simulated cloud', () => {
        function e2e(): { cloud: FakeCloud; manager: ConnectionManager; scheduler: ManualScheduler; log: CaptureLog } {
            const cloud = new FakeCloud();
            const log = new CaptureLog();
            const http = new HttpTransport({ fetch: cloud.fetch, minIntervalMs: 0 });
            const tokens = new TokenManager(new AuthClient(http), { email: EMAIL, password: PASSWORD }, log);
            const client = new MelCloudHomeClient({ http, tokens, log, sleep: () => Promise.resolve() });
            const scheduler = new ManualScheduler();
            const manager = new ConnectionManager({
                source: client,
                scheduler,
                log,
                pollIntervalMs: POLL,
                startJitterMs: 0,
                onConnectionChange: () => undefined,
                onContext: () => undefined,
            });
            return { cloud, manager, scheduler, log };
        }

        it('row "access token expired / 401": refresh, then re-login, without losing the connection', async () => {
            const { cloud, manager, scheduler } = e2e();
            manager.start();
            await scheduler.runNext();
            cloud.expireAccessTokens();
            await scheduler.runNext();
            expect(cloud.refreshCount).to.equal(1);
            cloud.expireAccessTokens();
            cloud.rejectRefresh = true; // row "refresh token rejected"
            await scheduler.runNext();
            expect(cloud.loginCount).to.equal(2);
            expect(manager.isConnected).to.equal(true);
        });

        it('row "password changed": slow retries, reconnects once the password works again', async () => {
            const { cloud, manager, scheduler, log } = e2e();
            cloud.password = 'changed in the app';
            manager.start();
            await scheduler.runNext();
            expect(scheduler.nextDelay).to.equal(30 * MIN);
            expect(manager.isConnected).to.equal(false);
            cloud.password = PASSWORD;
            await scheduler.runNext();
            expect(manager.isConnected).to.equal(true);
            expect(log.at('error')).to.have.length(1);
            expect(log.text).to.not.include(PASSWORD);
        });

        it('row "cloud outage": recovers after the outage', async () => {
            const { cloud, manager, scheduler } = e2e();
            manager.start();
            await scheduler.runNext();
            for (let i = 0; i < 6; i++) {
                cloud.faults.push({ match: /\/context$/, response: 503 });
            }
            // 3 polls with 2 attempts each (client retries once)
            await cycles(scheduler, 3);
            expect(manager.isConnected).to.equal(false);
            await scheduler.runNext();
            expect(manager.isConnected).to.equal(true);
            expect(cloud.loginCount).to.equal(1);
        });
    });
});
