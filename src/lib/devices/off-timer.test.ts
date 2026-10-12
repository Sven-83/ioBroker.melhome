import { expect } from 'chai';
import { CaptureLog, ManualScheduler } from '../../../test/helpers/fake-cloud';
import { EXPIRED_GRACE_MS, OffTimers } from './off-timer';

const BASE = 100_000_000;

function setup(): {
    timers: OffTimers;
    scheduler: ManualScheduler;
    updates: [string, number, number][];
    expired: string[];
    advance: (ms: number) => void;
} {
    let clock = BASE;
    const scheduler = new ManualScheduler();
    const updates: [string, number, number][] = [];
    const expired: string[] = [];
    const timers = new OffTimers({
        scheduler,
        log: new CaptureLog(),
        now: () => clock,
        onExpire: unitId => {
            expired.push(unitId);
        },
        onUpdate: (unitId, remaining, end) => {
            updates.push([unitId, remaining, end]);
        },
    });
    return {
        timers,
        scheduler,
        updates,
        expired,
        advance: ms => {
            clock += ms;
        },
    };
}

describe('devices/off-timer', () => {
    it('counts down and fires once', async () => {
        const env = setup();
        expect(await env.timers.set('u1', 1)).to.equal(1);
        expect(env.updates.at(-1)).to.deep.equal(['u1', 60, BASE + 60_000]);
        env.advance(10_000);
        await env.scheduler.run(10_000);
        expect(env.updates.at(-1)).to.deep.equal(['u1', 50, BASE + 60_000]);
        expect(env.timers.remaining('u1')).to.equal(50);
        env.advance(50_000);
        await env.scheduler.run(10_000);
        expect(env.expired).to.deep.equal(['u1']);
        expect(env.updates.at(-1)).to.deep.equal(['u1', 0, 0]);
        expect(env.scheduler.pending, 'tick stops without timers').to.have.length(0);
    });

    it('clamps the duration and cancels with 0', async () => {
        const env = setup();
        expect(await env.timers.set('u1', 1000)).to.equal(360);
        expect(await env.timers.set('u1', 0)).to.equal(0);
        expect(env.updates.at(-1)).to.deep.equal(['u1', 0, 0]);
        expect(env.timers.remaining('u1')).to.equal(0);
    });

    it('restores a running timer after a restart', async () => {
        const env = setup();
        await env.timers.restore('u1', BASE + 5 * 60_000);
        expect(env.updates.at(-1)).to.deep.equal(['u1', 300, BASE + 300_000]);
        expect(env.scheduler.pending).to.have.length(1);
    });

    it('switches off if the timer expired shortly before the restart', async () => {
        const env = setup();
        await env.timers.restore('u1', BASE - 60_000);
        expect(env.expired).to.deep.equal(['u1']);
    });

    it('ignores timers that expired long ago', async () => {
        const env = setup();
        await env.timers.restore('u1', BASE - EXPIRED_GRACE_MS - 1);
        expect(env.expired).to.deep.equal([]);
        expect(env.updates.at(-1)).to.deep.equal(['u1', 0, 0]);
    });

    it('stop clears the tick', async () => {
        const env = setup();
        await env.timers.set('u1', 5);
        env.timers.stop();
        expect(env.scheduler.pending).to.have.length(0);
    });
});
