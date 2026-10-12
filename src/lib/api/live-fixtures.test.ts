/*
 * Parsing of real (anonymised) responses captured with tools/probe.ts on 2026-10-12:
 * 2x MSZ-AY on an MXZ-3F54VF4 multi-split system.
 */

import { expect } from 'chai';
import { fixture } from '../../../test/helpers/fake-cloud';
import { parseHourlyEnergy, parseOutdoorTemperature, parseRssi, parseUserContext } from './types';

const live = (name: string): unknown => JSON.parse(fixture(`live/${name}`));

describe('api/types with live responses', () => {
    const warnings: string[] = [];
    const context = parseUserContext(live('context.json'), (_key, message) => warnings.push(message))!;
    const [livingRoom, bedroom] = context.ataUnits;

    it('parses both units without warnings', () => {
        expect(warnings).to.deep.equal([]);
        expect(context.ataUnits).to.have.length(2);
        expect(context.atwUnitCount).to.equal(0);
    });

    it('reads state values as words', () => {
        expect(livingRoom).to.include({
            power: false,
            operationMode: 'Cool',
            setTemperature: 17,
            roomTemperature: 22.5,
            setFanSpeed: 'Three',
            actualFanSpeed: 'Off',
            vaneVerticalDirection: 'Swing',
            vaneHorizontalDirection: 'Swing',
            inStandbyMode: false,
            isConnected: true,
        });
        expect(bedroom).to.include({
            operationMode: 'Automatic',
            setFanSpeed: 'Auto',
            vaneVerticalDirection: 'Auto',
            vaneHorizontalDirection: 'Centre',
        });
    });

    it('reports different wide-vane support per unit', () => {
        expect(livingRoom.capabilities.supportsWideVane).to.equal(true);
        expect(bedroom.capabilities.supportsWideVane).to.equal(false);
        for (const unit of context.ataUnits) {
            expect(unit.capabilities).to.include({
                hasStandby: true,
                hasEnergyConsumedMeter: true,
                isMultiSplitSystem: true,
                numberOfFanSpeeds: 5,
                minTempHeat: 10,
                hasHalfDegreeIncrements: true,
            });
        }
    });

    it('finds the newest genuine outdoor temperature in local unit time', () => {
        const reading = parseOutdoorTemperature(live('unit1-trendsummary.json'), livingRoom.timeZone);
        expect(reading).to.deep.equal({ value: 12, time: Date.UTC(2026, 9, 12, 20, 13, 32) });
    });

    it('reads rssi telemetry (the value in /context is stale)', () => {
        expect(parseRssi(live('unit1-rssi.json'))?.value).to.equal(-44);
        expect(livingRoom.rssi).to.equal(-30);
    });

    it('reads hourly energy of both indoor units', () => {
        expect([...parseHourlyEnergy(live('unit1-energy.json')).values()]).to.deep.equal([0]);
        const bedroomEnergy = parseHourlyEnergy(live('unit2-energy.json'));
        expect(bedroomEnergy.size).to.equal(5);
        expect(bedroomEnergy.get(Date.UTC(2026, 9, 12, 19))).to.equal(300);
    });
});
