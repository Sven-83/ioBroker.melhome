import { expect } from 'chai';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaptureLog, FIXTURES, ManualScheduler, settle } from '../../../test/helpers/fake-cloud';
import { NetworkError } from './errors';
import {
    PING_INTERVAL_MS,
    PONG_TIMEOUT_MS,
    QUICK_RECONNECT_MS,
    RECONNECT_INITIAL_MS,
    RECONNECT_MAX_MS,
    RealtimeConnection,
    STABLE_SESSION_MS,
    parseFrame,
    type SocketLike,
    type UnitEvent,
} from './websocket';

const HASH = 'aaaaaaaa-1111-4000-8000-secrethash00';

class FakeSocket extends EventEmitter implements SocketLike {
    public pings = 0;
    public terminated = false;

    public constructor(public readonly url: string) {
        super();
    }

    public ping(): void {
        this.pings++;
    }

    public terminate(): void {
        if (!this.terminated) {
            this.terminated = true;
            this.emit('close', 1006);
        }
    }
}

interface Env {
    realtime: RealtimeConnection;
    scheduler: ManualScheduler;
    log: CaptureLog;
    sockets: FakeSocket[];
    events: UnitEvent[];
    status: boolean[];
    advance: (ms: number) => number;
    readonly hashCalls: number;
    readonly socket: FakeSocket;
}

function setup(hashes: (string | Error)[] = []): Env {
    const scheduler = new ManualScheduler();
    const log = new CaptureLog();
    const sockets: FakeSocket[] = [];
    const events: UnitEvent[] = [];
    const status: boolean[] = [];
    let clock = 0;
    let hashCalls = 0;
    const realtime = new RealtimeConnection({
        getHash: () => {
            hashCalls++;
            const next = hashes.length > 0 ? hashes.shift()! : HASH;
            return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        },
        scheduler,
        log,
        onUnitEvent: event => events.push(event),
        onConnectionChange: connected => {
            status.push(connected);
        },
        wsUrl: 'wss://ws.example.invalid',
        createSocket: url => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
        },
        now: () => clock,
        random: () => 0.5, // no jitter
    });
    return {
        realtime,
        scheduler,
        log,
        sockets,
        events,
        status,
        advance: (ms: number) => (clock += ms),
        get hashCalls() {
            return hashCalls;
        },
        get socket(): FakeSocket {
            return sockets[sockets.length - 1];
        },
    };
}

async function started(): Promise<Env> {
    const env = setup();
    env.realtime.start();
    await settle(() => env.sockets.length > 0);
    env.socket.emit('open');
    return env;
}

describe('websocket', () => {
    describe('parseFrame', () => {
        it('extracts the unit of every captured frame', () => {
            const frames = JSON.parse(readFileSync(join(FIXTURES, 'live', 'websocket-frames.json'), 'utf8')) as {
                data: unknown;
            }[];
            for (const frame of frames) {
                const events = parseFrame(JSON.stringify(frame.data));
                expect(events).to.have.length(1);
                expect(events[0].type).to.equal('unitStateChanged');
                expect(events[0].unitId).to.match(/^00000000-0000-4000-8000-/);
            }
        });

        it('accepts single objects, lower-case data and reachability messages', () => {
            expect(
                parseFrame(JSON.stringify({ messageType: 'unitCommunicationLost', data: { id: 'u1', timestamp: 1 } })),
            ).to.deep.equal([{ unitId: 'u1', type: 'unitCommunicationLost' }]);
            expect(
                parseFrame(JSON.stringify([{ messageType: 'unitCommunicationRestored', Data: { id: 'u2' } }])),
            ).to.deep.equal([{ unitId: 'u2', type: 'unitCommunicationRestored' }]);
        });

        it('skips unknown and malformed content', () => {
            const unknown: string[] = [];
            expect(parseFrame('not json', t => unknown.push(t))).to.deep.equal([]);
            expect(
                parseFrame('[null, 5, {"messageType":"other"}, {"messageType":"unitStateChanged"}]', t =>
                    unknown.push(t),
                ),
            ).to.deep.equal([]);
            expect(unknown).to.deep.equal(['<invalid JSON>', 'other']);
        });
    });

    describe('RealtimeConnection', () => {
        it('connects with a fresh hash and reports unit events', async () => {
            const env = await started();
            expect(env.socket.url).to.equal(`wss://ws.example.invalid/?hash=${HASH}`);
            expect(env.status).to.deep.equal([true]);
            expect(env.realtime.isConnected).to.equal(true);
            expect(env.log.at('info')).to.deep.equal(['Real-time connection established']);

            env.socket.emit(
                'message',
                Buffer.from('[{"messageType":"unitStateChanged","Data":{"id":"u1","settings":[]}}]'),
            );
            expect(env.events).to.deep.equal([{ unitId: 'u1', type: 'unitStateChanged' }]);
        });

        it('never logs the hash', async () => {
            const env = await started();
            env.socket.emit(
                'error',
                new Error(`Unexpected server response: 401 for wss://ws.example.invalid/?hash=${HASH}`),
            );
            env.socket.emit('close', 1006);
            expect(env.log.text).to.not.include(HASH);
            expect(env.log.text).to.include('hash=***');
        });

        it('pings every 30 s and reconnects when no pong arrives', async () => {
            const env = await started();
            await env.scheduler.run(PING_INTERVAL_MS);
            expect(env.socket.pings).to.equal(1);
            env.socket.emit('pong');
            expect(env.scheduler.has(PONG_TIMEOUT_MS)).to.equal(false);

            await env.scheduler.run(PING_INTERVAL_MS);
            expect(env.socket.pings).to.equal(2);
            const first = env.socket;
            await env.scheduler.run(PONG_TIMEOUT_MS);
            expect(first.terminated).to.equal(true);
            expect(env.status).to.deep.equal([true, false]);
            expect(env.scheduler.has(RECONNECT_INITIAL_MS)).to.equal(true);
        });

        it('reconnects at once after a stable session (2 h server limit) without info log', async () => {
            const env = await started();
            env.advance(2 * 3600_000);
            env.socket.emit('close', 1001);
            expect(env.scheduler.has(QUICK_RECONNECT_MS)).to.equal(true);
            await env.scheduler.run(QUICK_RECONNECT_MS);
            await settle(() => env.sockets.length > 1);
            env.socket.emit('open');
            expect(env.sockets).to.have.length(2);
            expect(env.hashCalls).to.equal(2);
            expect(env.log.at('info')).to.deep.equal(['Real-time connection established']);
        });

        it('backs off exponentially up to 300 s and logs loss and restore once', async () => {
            const env = await started();
            const delays: number[] = [];
            for (let i = 0; i < 8; i++) {
                env.socket.emit('close', 1006); // closes before it counts as stable
                const timer = env.scheduler.pending.find(t => t.ms !== PING_INTERVAL_MS)!;
                delays.push(timer.ms);
                await env.scheduler.run(timer.ms);
                await settle(() => env.sockets.length > i + 1);
            }
            expect(delays).to.deep.equal(
                [5, 10, 20, 40, 80, 160, 300, 300].map(s => Math.min(s * 1000, RECONNECT_MAX_MS)),
            );
            expect(env.log.at('info').filter(m => m.includes('lost'))).to.have.length(1);

            env.socket.emit('open');
            expect(env.log.at('info')).to.include('Real-time connection restored');
            // only a stable session resets the backoff
            env.advance(STABLE_SESSION_MS);
            env.socket.emit('close', 1001);
            expect(env.scheduler.has(QUICK_RECONNECT_MS)).to.equal(true);
        });

        it('applies +-20 % jitter', async () => {
            const scheduler = new ManualScheduler();
            const realtime = new RealtimeConnection({
                getHash: () => Promise.reject(new NetworkError('offline')),
                scheduler,
                log: new CaptureLog(),
                onUnitEvent: () => undefined,
                onConnectionChange: () => undefined,
                random: () => 0,
            });
            realtime.start();
            await settle(() => scheduler.pending.length > 0);
            expect(scheduler.nextDelay).to.equal(RECONNECT_INITIAL_MS * 0.8);
            realtime.stop();
            expect(scheduler.pending).to.have.length(0);
        });

        it('retries with backoff when the credential cannot be fetched', async () => {
            const env = setup([new NetworkError('offline')]);
            env.realtime.start();
            await settle(() => env.scheduler.pending.length > 0);
            expect(env.sockets).to.have.length(0);
            expect(env.scheduler.nextDelay).to.equal(RECONNECT_INITIAL_MS);
            await env.scheduler.run(RECONNECT_INITIAL_MS);
            await settle(() => env.sockets.length > 0);
            expect(env.sockets).to.have.length(1);
            expect(env.log.at('info')).to.deep.equal([]);
        });

        it('stops cleanly: no timers, socket terminated, no reconnect', async () => {
            const env = await started();
            await env.scheduler.run(PING_INTERVAL_MS);
            env.realtime.stop();
            expect(env.scheduler.pending).to.have.length(0);
            expect(env.socket.terminated).to.equal(true);
            expect(env.status).to.deep.equal([true, false]);
            expect(env.socket.listenerCount('error')).to.equal(1);

            // late events of the dropped socket change nothing
            env.socket.emit('message', '[{"messageType":"unitStateChanged","Data":{"id":"u1"}}]');
            expect(env.events).to.deep.equal([]);
        });

        it('ignores a hash that arrives after stop and can be started again', async () => {
            let resolveHash: (hash: string) => void = () => undefined;
            const scheduler = new ManualScheduler();
            const sockets: FakeSocket[] = [];
            const realtime = new RealtimeConnection({
                getHash: () => new Promise<string>(resolve => (resolveHash = resolve)),
                scheduler,
                log: new CaptureLog(),
                onUnitEvent: () => undefined,
                onConnectionChange: () => undefined,
                createSocket: url => {
                    const socket = new FakeSocket(url);
                    sockets.push(socket);
                    return socket;
                },
            });
            realtime.start();
            realtime.stop();
            resolveHash(HASH);
            await settle();
            expect(sockets).to.have.length(0);

            realtime.start();
            resolveHash(HASH);
            await settle(() => sockets.length > 0);
            expect(sockets).to.have.length(1);
            realtime.stop();
        });
    });
});
