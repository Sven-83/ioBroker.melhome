import { expect } from 'chai';
import { DEFAULT_ATA_CAPABILITIES, type AtaCapabilities } from './api/types';
import {
    FAN_SPEED_CODES,
    MODE_CODES,
    VANE_HORIZONTAL_CODES,
    VANE_VERTICAL_CODES,
    clampTemperature,
    fanSpeedStates,
    fromCode,
    isAllowedCode,
    modeStates,
    overallTemperatureLimits,
    temperatureLimits,
    toCode,
    vaneStates,
    roomIcon,
} from './mapping';

const caps = (overrides: Partial<AtaCapabilities> = {}): AtaCapabilities => ({
    ...DEFAULT_ATA_CAPABILITIES,
    ...overrides,
});

describe('mapping', () => {
    it('uses the dashboard codes (docs/api.md section 5)', () => {
        expect(toCode(MODE_CODES, 'Automatic')).to.equal(8);
        expect(toCode(MODE_CODES, 'Heat')).to.equal(1);
        expect(toCode(MODE_CODES, 'Dry')).to.equal(2);
        expect(toCode(MODE_CODES, 'Cool')).to.equal(3);
        expect(toCode(MODE_CODES, 'Fan')).to.equal(7);
        expect(toCode(FAN_SPEED_CODES, 'Auto')).to.equal(0);
        expect(toCode(FAN_SPEED_CODES, 'Three')).to.equal(3);
        expect(toCode(VANE_VERTICAL_CODES, 'Swing')).to.equal(7);
        expect(toCode(VANE_HORIZONTAL_CODES, 'Left')).to.equal(1);
        expect(toCode(VANE_HORIZONTAL_CODES, 'RightCentre')).to.equal(4);
        expect(toCode(VANE_HORIZONTAL_CODES, 'Swing')).to.equal(12);
        expect(toCode(MODE_CODES, null)).to.equal(null);
    });

    it('has no split position', () => {
        expect(fromCode(VANE_HORIZONTAL_CODES, 8)).to.equal(undefined);
        expect(vaneStates(VANE_HORIZONTAL_CODES, caps())).to.not.have.property('8');
    });

    it('converts user values back and rejects garbage', () => {
        expect(fromCode(MODE_CODES, 8)).to.equal('Automatic');
        expect(fromCode(MODE_CODES, '3')).to.equal('Cool');
        expect(fromCode(MODE_CODES, 4)).to.equal(undefined);
        expect(fromCode(MODE_CODES, 1.5)).to.equal(undefined);
        expect(fromCode(MODE_CODES, 'abc')).to.equal(undefined);
        expect(fromCode(MODE_CODES, 'constructor')).to.equal(undefined);
        expect(fromCode(MODE_CODES, null)).to.equal(undefined);
    });

    it('offers only supported modes and fan speeds', () => {
        expect(modeStates(caps({ hasDryOperationMode: false, hasAutoOperationMode: false }))).to.deep.equal({
            1: 'Heat',
            3: 'Cool',
            7: 'Fan',
        });
        expect(Object.keys(fanSpeedStates(caps({ numberOfFanSpeeds: 3, hasAutomaticFanSpeed: false })))).to.deep.equal([
            '1',
            '2',
            '3',
        ]);
        expect(isAllowedCode(fanSpeedStates(caps({ numberOfFanSpeeds: 3 })), 4)).to.equal(false);
        expect(isAllowedCode(fanSpeedStates(caps()), '5')).to.equal(true);
        expect(vaneStates(VANE_VERTICAL_CODES, caps({ hasSwing: false }))).to.not.have.property('7');
    });

    it('uses mode specific temperature limits', () => {
        const c = caps();
        expect(temperatureLimits(c, 'Heat')).to.deep.equal({ min: 10, max: 31, step: 0.5 });
        expect(temperatureLimits(c, 'Cool')).to.deep.equal({ min: 16, max: 31, step: 0.5 });
        expect(temperatureLimits(c, 'Fan')).to.deep.equal(overallTemperatureLimits(c));
        expect(temperatureLimits(caps({ hasHalfDegreeIncrements: false }), 'Dry').step).to.equal(1);
    });

    it('rounds and clamps target temperatures', () => {
        const cool = temperatureLimits(caps(), 'Cool');
        expect(clampTemperature(21.3, cool)).to.equal(21.5);
        expect(clampTemperature(21.2, cool)).to.equal(21);
        expect(clampTemperature(12, cool)).to.equal(16);
        expect(clampTemperature(40, cool)).to.equal(31);
        expect(clampTemperature(12, temperatureLimits(caps(), 'Heat'))).to.equal(12);
    });

    it('accepts only known room icons', () => {
        expect(roomIcon('bed')).to.equal('bed');
        expect(roomIcon('sauna')).to.equal('auto');
        expect(roomIcon(undefined)).to.equal('auto');
        expect(roomIcon(3)).to.equal('auto');
    });
});
