import { expect } from 'chai';
import { CaptureLog, ManualScheduler, fixture } from '../../../test/helpers/fake-cloud';
import { parseUserContext, type AtaControlRequest, type AtaUnit } from '../api/types';
import { CommandQueue, planRequests } from './commands';

const units = parseUserContext(JSON.parse(fixture('live/context.json')), () => undefined)!.ataUnits;
const livingRoom = units[0]; // Cool, off, supportsWideVane

function setupQueue(unit: AtaUnit | undefined = livingRoom): {
    queue: CommandQueue;
    scheduler: ManualScheduler;
    sent: AtaControlRequest[];
    accepted: AtaControlRequest[];
    failed: AtaControlRequest[];
    sleeps: number[];
    batches: number;
    fail: (count: number) => void;
} {
    const scheduler = new ManualScheduler();
    const result = {
        sent: [] as AtaControlRequest[],
        accepted: [] as AtaControlRequest[],
        failed: [] as AtaControlRequest[],
        sleeps: [] as number[],
        batches: 0,
    };
    let failures = 0;
    const queue = new CommandQueue({
        send: request => {
            result.sent.push(request as never);
            return Promise.resolve();
        },
        getUnit: () => unit,
        onAccepted: (_id, request) => {
            result.accepted.push(request);
        },
        onFailed: (_id, request) => {
            result.failed.push(request);
        },
        onBatchDone: () => {
            result.batches++;
        },
        scheduler,
        sleep: ms => {
            result.sleeps.push(ms);
            return Promise.resolve();
        },
        log: new CaptureLog(),
    });
    // replace send to record the request (first argument is the unit id)
    (queue as unknown as { options: { send: (id: string, r: AtaControlRequest) => Promise<void> } }).options.send = (
        _id,
        request,
    ) => {
        result.sent.push(request);
        if (failures > 0) {
            failures--;
            return Promise.reject(new Error('HTTP 500'));
        }
        return Promise.resolve();
    };
    return {
        queue,
        scheduler,
        ...result,
        get batches() {
            return result.batches;
        },
        fail: (count: number) => {
            failures = count;
        },
    };
}

describe('devices/commands', () => {
    describe('planRequests', () => {
        it('adds the current mode when switching on', () => {
            expect(planRequests({ power: true }, livingRoom)).to.deep.equal([{ power: true, operationMode: 'Cool' }]);
            expect(planRequests({ power: true, operationMode: 'Heat' }, livingRoom)).to.deep.equal([
                { power: true, operationMode: 'Heat' },
            ]);
        });

        it('refuses to switch on if the mode is unknown', () => {
            expect(() => planRequests({ power: true }, { ...livingRoom, operationMode: null })).to.throw(RangeError);
        });

        it('sends the vane axes in separate requests after the main request', () => {
            expect(
                planRequests(
                    { vaneHorizontalDirection: 'Left', setFanSpeed: 'Two', vaneVerticalDirection: 'Swing' },
                    livingRoom,
                ),
            ).to.deep.equal([
                { setFanSpeed: 'Two' },
                { vaneVerticalDirection: 'Swing' },
                { vaneHorizontalDirection: 'Left' },
            ]);
        });

        it('clamps the temperature to the limits of the effective mode', () => {
            expect(planRequests({ setTemperature: 12 }, livingRoom)).to.deep.equal([{ setTemperature: 16 }]);
            expect(planRequests({ setTemperature: 12, operationMode: 'Heat' }, livingRoom)).to.deep.equal([
                { setTemperature: 12, operationMode: 'Heat' },
            ]);
            expect(planRequests({ setTemperature: 21.26 }, livingRoom)).to.deep.equal([{ setTemperature: 21.5 }]);
        });
    });

    describe('CommandQueue', () => {
        it('merges commands within the debounce time into one request', async () => {
            const env = setupQueue();
            env.queue.enqueue('u1', { setTemperature: 20 });
            env.queue.enqueue('u1', { setTemperature: 20.5 });
            env.queue.enqueue('u1', { setFanSpeed: 'Two' });
            expect(env.scheduler.pending.map(t => t.ms)).to.deep.equal([800]);
            expect(env.queue.isPending('u1')).to.equal(true);
            await env.scheduler.run(800);
            expect(env.sent).to.deep.equal([{ setTemperature: 20.5, setFanSpeed: 'Two' }]);
            expect(env.accepted).to.have.length(1);
            expect(env.batches).to.equal(1);
            expect(env.queue.isPending('u1')).to.equal(false);
        });

        it('keeps a gap between requests to the same unit', async () => {
            const env = setupQueue();
            env.queue.enqueue('u1', { vaneVerticalDirection: 'One', vaneHorizontalDirection: 'Right', power: false });
            await env.scheduler.run(800);
            expect(env.sent).to.have.length(3);
            expect(env.sleeps).to.deep.equal([1500, 1500]);
        });

        it('reports failed requests and continues with the next one', async () => {
            const env = setupQueue();
            env.fail(1);
            env.queue.enqueue('u1', { setFanSpeed: 'Two', vaneVerticalDirection: 'One' });
            await env.scheduler.run(800);
            expect(env.failed).to.deep.equal([{ setFanSpeed: 'Two' }]);
            expect(env.accepted).to.deep.equal([{ vaneVerticalDirection: 'One' }]);
            expect(env.batches).to.equal(1);
        });

        it('reports commands that cannot be planned as failed', async () => {
            const env = setupQueue({ ...livingRoom, operationMode: null });
            env.queue.enqueue('u1', { power: true });
            await env.scheduler.run(800);
            expect(env.sent).to.deep.equal([]);
            expect(env.failed).to.deep.equal([{ power: true }]);
        });

        it('stop drops pending commands', async () => {
            const env = setupQueue();
            env.queue.enqueue('u1', { power: false });
            env.queue.stop();
            expect(env.scheduler.pending).to.have.length(0);
            env.queue.enqueue('u1', { power: false });
            expect(env.scheduler.pending).to.have.length(0);
            await Promise.resolve();
            expect(env.sent).to.deep.equal([]);
        });
    });
});
