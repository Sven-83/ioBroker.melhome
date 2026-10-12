import { expect } from 'chai';
import { fixture } from '../../../test/helpers/fake-cloud';
import {
    DEFAULT_ATA_CAPABILITIES,
    buildAtaControlBody,
    parseApiTimestamp,
    parseBool,
    parseHourlyEnergy,
    parseNumber,
    parseOutdoorTemperature,
    parseRssi,
    parseUserContext,
} from './types';

describe('api/types', () => {
    describe('parseBool / parseNumber', () => {
        it('accepts API strings in any case and real values', () => {
            expect(parseBool('True')).to.equal(true);
            expect(parseBool('false')).to.equal(false);
            expect(parseBool(' TRUE ')).to.equal(true);
            expect(parseBool(true)).to.equal(true);
            expect(parseBool('yes')).to.equal(null);
            expect(parseBool(undefined)).to.equal(null);
        });

        it('parses numbers defensively', () => {
            expect(parseNumber('21.5')).to.equal(21.5);
            expect(parseNumber(20)).to.equal(20);
            expect(parseNumber('')).to.equal(null);
            expect(parseNumber('abc')).to.equal(null);
            expect(parseNumber(Number.NaN)).to.equal(null);
            expect(parseNumber(null)).to.equal(null);
        });
    });

    describe('parseUserContext', () => {
        const warnings: { key: string; message: string }[] = [];
        const context = parseUserContext(JSON.parse(fixture('context.json')), (key, message) =>
            warnings.push({ key, message }),
        );

        it('reads own and shared buildings and skips units without id', () => {
            expect(context).to.not.equal(null);
            expect(context!.ataUnits.map(u => u.id)).to.deep.equal([
                '00000000-0000-4000-8000-000000000001',
                '00000000-0000-4000-8000-000000000002',
                '00000000-0000-4000-8000-000000000003',
            ]);
            expect(context!.atwUnitCount).to.equal(1);
            expect(context!.ataUnits[2].isGuest).to.equal(true);
            expect(context!.ataUnits[2].buildingName).to.equal('Shared house');
            expect(warnings.some(w => w.key === 'unit-without-id')).to.equal(true);
        });

        it('parses a complete unit', () => {
            const unit = context!.ataUnits[0];
            expect(unit).to.include({
                name: 'Living room',
                buildingName: 'Home',
                isGuest: false,
                isConnected: true,
                timeZone: 'Europe/Berlin',
                power: true,
                operationMode: 'Heat',
                setTemperature: 21.5,
                roomTemperature: 20,
                setFanSpeed: 'Auto',
                actualFanSpeed: 'Two',
                vaneVerticalDirection: 'Auto',
                vaneHorizontalDirection: 'Centre',
                inStandbyMode: false,
                isInError: false,
                errorCode: '',
                rssi: -48,
            });
            expect(unit.capabilities.hasEnergyConsumedMeter).to.equal(true);
            expect(unit.capabilities.isMultiSplitSystem).to.equal(true);
            expect(unit.capabilities).to.not.have.property('someFutureFlag');
        });

        it('normalises numeric codes, American spelling and string capabilities', () => {
            const unit = context!.ataUnits[1];
            expect(unit.setFanSpeed).to.equal('Three');
            expect(unit.vaneVerticalDirection).to.equal('Swing');
            expect(unit.vaneHorizontalDirection).to.equal('LeftCentre');
            expect(unit.power).to.equal(false);
            expect(unit.roomTemperature).to.equal(null);
            expect(unit.inStandbyMode).to.equal(null);
            expect(unit.isInError).to.equal(true);
            expect(unit.errorCode).to.equal('E6');
            expect(unit.capabilities.numberOfFanSpeeds).to.equal(3);
            expect(unit.capabilities.hasHalfDegreeIncrements).to.equal(false);
            expect(unit.capabilities.maxTempHeat).to.equal(DEFAULT_ATA_CAPABILITIES.maxTempHeat);
        });

        it('removes line breaks from names (log injection)', () => {
            expect(context!.ataUnits[1].name).to.equal('Bed room');
        });

        it('maps unknown values to null and warns with a stable key', () => {
            const unit = context!.ataUnits[2];
            expect(unit.operationMode).to.equal(null);
            expect(unit.vaneHorizontalDirection).to.equal('Swing');
            expect(unit.isInError).to.equal(true, 'falls back to the top-level isInError');
            const warning = warnings.find(w => w.message.includes('Turbo'));
            expect(warning?.key).to.equal('00000000-0000-4000-8000-000000000003:operation mode:Turbo');
        });

        it('defaults all capabilities if they are missing', () => {
            expect(context!.ataUnits[2].capabilities).to.deep.equal(DEFAULT_ATA_CAPABILITIES);
        });

        it('rejects non-objects and tolerates empty objects', () => {
            expect(parseUserContext('nonsense', () => undefined)).to.equal(null);
            expect(parseUserContext([], () => undefined)).to.equal(null);
            expect(parseUserContext({}, () => undefined)).to.deep.equal({ ataUnits: [], atwUnitCount: 0 });
            expect(parseUserContext({ buildings: 'x', guestBuildings: [null, 1] }, () => undefined)).to.deep.equal({
                ataUnits: [],
                atwUnitCount: 0,
            });
        });

        it('lists a unit only once if it appears in two buildings', () => {
            const unit = { id: 'u1', settings: [] };
            const parsed = parseUserContext(
                {
                    buildings: [{ id: 'b', airToAirUnits: [unit] }],
                    guestBuildings: [{ id: 'b', airToAirUnits: [unit] }],
                },
                () => undefined,
            );
            expect(parsed!.ataUnits).to.have.length(1);
        });
    });

    describe('buildAtaControlBody', () => {
        it('always sends all 8 fields with null for unchanged ones', () => {
            expect(buildAtaControlBody({ power: true, operationMode: 'Automatic' })).to.deep.equal({
                power: true,
                operationMode: 'Automatic',
                setFanSpeed: null,
                vaneHorizontalDirection: null,
                vaneVerticalDirection: null,
                setTemperature: null,
                temperatureIncrementOverride: null,
                inStandbyMode: null,
            });
        });

        it('keeps false and 0 values', () => {
            const body = buildAtaControlBody({ power: false, setTemperature: 0 });
            expect(body.power).to.equal(false);
            expect(body.setTemperature).to.equal(0);
        });
    });

    describe('timestamps and telemetry', () => {
        it('parses UTC telemetry timestamps', () => {
            expect(parseApiTimestamp('2025-12-09 09:00:00.000000000')).to.equal(Date.UTC(2025, 11, 9, 9));
            expect(parseApiTimestamp('2025-12-09T09:00:00Z')).to.equal(Date.UTC(2025, 11, 9, 9));
            expect(parseApiTimestamp('2025-12-09T10:00:00+01:00')).to.equal(Date.UTC(2025, 11, 9, 9));
            expect(parseApiTimestamp('invalid')).to.equal(null);
            expect(parseApiTimestamp(undefined)).to.equal(null);
        });

        it('converts local unit time to UTC (winter and summer time)', () => {
            expect(parseApiTimestamp('2026-01-12T20:17:51', 'Europe/Berlin')).to.equal(
                Date.UTC(2026, 0, 12, 19, 17, 51),
            );
            expect(parseApiTimestamp('2026-07-12T20:00:00', 'Europe/Berlin')).to.equal(Date.UTC(2026, 6, 12, 18));
            expect(parseApiTimestamp('2026-07-12T20:00:00', 'Not/AZone')).to.equal(Date.UTC(2026, 6, 12, 20));
        });

        it('takes the newest genuine outdoor temperature (second != 0)', () => {
            const reading = parseOutdoorTemperature(JSON.parse(fixture('trendsummary.json')), 'Europe/Berlin');
            expect(reading).to.deep.equal({ value: 4, time: Date.UTC(2026, 0, 12, 19, 17, 51) });
            expect(parseOutdoorTemperature([], null)).to.equal(null);
            expect(parseOutdoorTemperature({ datasets: [{ label: 'OTHER', data: [] }] }, null)).to.equal(null);
        });

        it('takes the newest rssi reading', () => {
            expect(parseRssi(JSON.parse(fixture('rssi.json')))).to.deep.equal({
                value: -61,
                time: Date.UTC(2025, 11, 9, 9, 41),
            });
            expect(parseRssi(null)).to.equal(null);
        });

        it('reads hourly energy, later duplicates win, garbage is skipped', () => {
            const energy = parseHourlyEnergy(JSON.parse(fixture('energy.json')));
            expect([...energy.entries()]).to.deep.equal([
                [Date.UTC(2025, 11, 9, 8), 300],
                [Date.UTC(2025, 11, 9, 9), 450],
            ]);
            expect(parseHourlyEnergy(null).size).to.equal(0);
        });
    });
});
