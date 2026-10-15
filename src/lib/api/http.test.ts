import { expect } from 'chai';
import { AbortedError, NetworkError, describeError, redact, stripLineBreaks } from './errors';
import { ManualScheduler } from '../../../test/helpers/fake-cloud';
import { HttpTransport, type FetchFn } from './http';

describe('api/errors', () => {
    it('redacts codes, tokens, hashes, passwords and e-mail addresses', () => {
        const text = redact(
            'melcloudhome://?code=abc123&state=xyz wss://ws.melcloudhome.com/?hash=secret Bearer eyJhbGciOi.x-y_z password=hunter2 mail user@example.invalid',
        );
        expect(text).to.not.match(/abc123|xyz|secret|eyJhbGciOi|hunter2|user@example/);
        expect(text).to.include('code=***');
        expect(text).to.include('Bearer ***');
    });

    it('does not touch unrelated words', () => {
        expect(redact('decode=1 unicode')).to.equal('decode=1 unicode');
    });

    it('flattens all kinds of line breaks', () => {
        const separators = String.fromCharCode(0x85, 0x2028, 0x2029);
        expect(stripLineBreaks(`a\r\nb\nc\rd${separators}e`)).to.equal('a b c d   e');
    });

    it('describes errors without secrets', () => {
        expect(describeError(new Error('failed for https://x/?code=1\nfake line'))).to.equal(
            'failed for https://x/?code=*** fake line',
        );
        expect(new NetworkError('token refresh_token=abc').message).to.equal('token refresh_token=***');
    });
});

describe('api/http', () => {
    const ok: FetchFn = () => Promise.resolve(new Response('ok'));

    it('serialises requests and keeps the minimum interval', async () => {
        let clock = 1000;
        const waits: number[] = [];
        const started: number[] = [];
        const transport = new HttpTransport({
            minIntervalMs: 500,
            now: () => clock,
            sleep: ms => {
                waits.push(ms);
                clock += ms;
                return Promise.resolve();
            },
            fetch: () => {
                started.push(clock);
                clock += 100;
                return Promise.resolve(new Response('ok'));
            },
        });
        await Promise.all([
            transport.request('https://a'),
            transport.request('https://b'),
            transport.request('https://c'),
        ]);
        expect(started).to.deep.equal([1000, 1500, 2000]);
        expect(waits).to.deep.equal([400, 400]);
    });

    it('continues the queue after a failed request', async () => {
        let call = 0;
        const transport = new HttpTransport({
            minIntervalMs: 0,
            fetch: () =>
                ++call === 1 ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve(new Response('x')),
        });
        const first = transport.request('https://a');
        const second = transport.request('https://b');
        await expect(first).to.be.rejectedWith(NetworkError);
        expect((await second).body).to.equal('x');
    });

    it('reports the cause of fetch failures', async () => {
        const transport = new HttpTransport({
            minIntervalMs: 0,
            fetch: () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })),
        });
        await expect(transport.request('https://a')).to.be.rejectedWith(NetworkError, 'ENOTFOUND');
    });

    it('turns a timeout into a NetworkError', async () => {
        const transport = new HttpTransport({
            minIntervalMs: 0,
            timeoutMs: 20,
            fetch: (_url, init) =>
                new Promise((_resolve, reject) =>
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
                ),
        });
        await expect(transport.request('https://slow')).to.be.rejectedWith(NetworkError, 'timed out');
    });

    it('aborts running and future requests on shutdown', async () => {
        const transport = new HttpTransport({
            minIntervalMs: 0,
            fetch: (_url, init) =>
                new Promise((_resolve, reject) =>
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
                ),
        });
        const running = transport.request('https://hang');
        transport.abort();
        await expect(running).to.be.rejectedWith(AbortedError);
        await expect(transport.request('https://later')).to.be.rejectedWith(AbortedError);
        expect(transport.aborted).to.equal(true);
    });

    it('ends an abortable sleep early on shutdown', async () => {
        const transport = new HttpTransport({ fetch: ok });
        const started = Date.now();
        const sleeping = transport.abortableSleep(60_000);
        transport.abort();
        await sleeping;
        expect(Date.now() - started).to.be.below(1000);
    });

    it('uses the injected scheduler for sleeps and request timeouts', async () => {
        const scheduler = new ManualScheduler();
        const transport = new HttpTransport({ fetch: ok, scheduler, timeoutMs: 5000 });
        const sleeping = transport.abortableSleep(1234);
        expect(scheduler.nextDelay).to.equal(1234);
        scheduler.pending[0].callback();
        await sleeping;
        expect(scheduler.pending).to.have.length(0);
        await transport.request('https://a');
        // the timeout timer was scheduled and cleared again after the response
        expect(scheduler.pending).to.have.length(0);
    });

    it('does not hang when the scheduler refuses new timers (adapter unloading)', async () => {
        const transport = new HttpTransport({
            fetch: ok,
            scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
        });
        await transport.abortableSleep(60_000);
    });
});
