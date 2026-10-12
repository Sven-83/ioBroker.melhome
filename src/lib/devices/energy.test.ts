import { expect } from 'chai';
import { applyEnergy, newEnergyTrackerData, restoreEnergyTrackerData } from './energy';

const H = 3_600_000;
const day = Date.UTC(2026, 9, 12);
const hours = (entries: [number, number][]): Map<number, number> =>
    new Map(entries.map(([h, wh]) => [day + h * H, wh]));

describe('devices/energy', () => {
    it('marks history as seen on the first run without counting it', () => {
        const data = newEnergyTrackerData(5);
        const values = applyEnergy(
            data,
            hours([
                [8, 300],
                [9, 400],
            ]),
            day + 10 * H,
            day,
        );
        expect(values).to.deep.equal({ totalKwh: 5, lastHourKwh: 0.4, todayKwh: 0.7 });
        expect(data.initialised).to.equal(true);
    });

    it('adds growing hours and new hours only once', () => {
        const data = newEnergyTrackerData();
        applyEnergy(data, hours([[9, 100]]), day + 10 * H, day);
        let values = applyEnergy(
            data,
            hours([
                [9, 300],
                [10, 100],
            ]),
            day + 10.5 * H,
            day,
        );
        expect(values.totalKwh).to.equal(0.3);
        values = applyEnergy(
            data,
            hours([
                [9, 300],
                [10, 100],
            ]),
            day + 10.6 * H,
            day,
        );
        expect(values.totalKwh).to.equal(0.3, 'same values again add nothing');
        values = applyEnergy(
            data,
            hours([
                [9, 200],
                [10, 250],
            ]),
            day + 11 * H,
            day,
        );
        expect(values.totalKwh).to.equal(0.45, 'a lower value never reduces the counter');
    });

    it('ignores implausible values', () => {
        const data = newEnergyTrackerData();
        applyEnergy(data, hours([[9, 100]]), day + 10 * H, day);
        const values = applyEnergy(data, hours([[10, 500_000]]), day + 11 * H, day);
        expect(values.totalKwh).to.equal(0);
        expect(values.lastHourKwh).to.equal(0.1);
    });

    it('forgets hours older than 48 h', () => {
        const data = newEnergyTrackerData();
        applyEnergy(data, hours([[0, 100]]), day + H, day);
        applyEnergy(data, new Map(), day + 50 * H, day);
        expect(data.seen).to.deep.equal({});
    });

    it('restores persisted data defensively', () => {
        expect(restoreEnergyTrackerData(undefined, 3)).to.deep.equal(newEnergyTrackerData(3));
        const restored = restoreEnergyTrackerData(
            { totalWh: 1234, seen: { [day]: 100, bad: 5, [day + H]: 'x' }, initialised: true },
            0,
        );
        expect(restored).to.deep.equal({ totalWh: 1234, seen: { [day]: 100 }, initialised: true });
    });
});
