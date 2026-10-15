/*
 * Tests for the browser dashboard logic (www/js/core.js).
 */

import { expect } from 'chai';
import type * as Core from '../www/js/core.js';

// plain browser script with a CommonJS fallback
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../www/js/core.js') as typeof Core;

describe('dashboard core', () => {
    it('uses German only for a German system, English otherwise', () => {
        expect(core.pickLanguage('de')).to.equal('de');
        expect(core.pickLanguage('fr')).to.equal('en');
        expect(core.pickLanguage(undefined)).to.equal('en');
        expect(core.t('de', 'mode1')).to.equal('Heizen');
        expect(core.t('en', 'mode1')).to.equal('Heat');
        expect(core.t('de', 'unknownKey')).to.equal('unknownKey');
    });

    it('has the same text keys in both languages', () => {
        expect(Object.keys(core.TEXTS.de).sort()).to.deep.equal(Object.keys(core.TEXTS.en).sort());
    });

    it('reads codes from common.states: auto first, swing last', () => {
        expect(core.codesOf({ 0: 'Auto', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4', 5: 'P5', 12: 'Swing' })).to.deep.equal([
            0, 1, 2, 3, 4, 5, 12,
        ]);
        expect(core.codesOf({ 7: 'Swing', 1: 'P1', 0: 'Auto' })).to.deep.equal([0, 1, 7]);
        expect(core.codesOf({ x: 'bad', '-1': 'bad', 2: 'ok' })).to.deep.equal([2]);
        expect(core.codesOf(null)).to.deep.equal([]);
        expect(core.vaneButtonCodes({ 0: 'Auto', 1: 'P1', 5: 'P5', 7: 'Swing' })).to.deep.equal([1, 5, 7]);
        expect(core.vaneButtonCodes(null)).to.deep.equal([]);
    });

    it('picks the temperature range of the mode from the capabilities', () => {
        const caps = {
            minTempHeat: 10,
            maxTempHeat: 31,
            minTempCoolDry: 16,
            maxTempCoolDry: 31,
            minTempAuto: 16,
            maxTempAuto: 31,
            tempStep: 0.5,
        };
        expect(core.temperatureRange(caps, 1)).to.deep.equal({ min: 10, max: 31, step: 0.5 });
        expect(core.temperatureRange(caps, 3)).to.deep.equal({ min: 16, max: 31, step: 0.5 });
        expect(core.temperatureRange(caps, 7)).to.deep.equal({ min: 10, max: 31, step: 0.5 });
        expect(core.temperatureRange({}, 3)).to.deep.equal({ min: 16, max: 31, step: 0.5 });
        expect(core.temperatureRange({ minTempCoolDry: 40, maxTempCoolDry: 20 }, 3).min).to.equal(16);
    });

    it('steps the target temperature on the grid and inside the range', () => {
        const range = { min: 16, max: 31, step: 0.5 };
        expect(core.stepTemperature(21, 1, range)).to.equal(21.5);
        expect(core.stepTemperature(21.3, -1, range)).to.equal(21);
        expect(core.stepTemperature(31, 1, range)).to.equal(31);
        expect(core.stepTemperature(16, -1, range)).to.equal(16);
        expect(core.stepTemperature(22, 1, { min: 16, max: 31, step: 1 })).to.equal(23);
    });

    it('turns the dial needle from -125° to +125°', () => {
        const range = { min: 16, max: 31, step: 0.5 };
        expect(core.needleAngle(16, range)).to.equal(-125);
        expect(core.needleAngle(31, range)).to.equal(125);
        expect(core.needleAngle(50, range)).to.equal(125);
        expect(core.needleAngle(null, range)).to.equal(0);
    });

    it('formats temperatures, timer values and countdowns', () => {
        expect(core.formatTemperature('de', 21.5)).to.equal('21,5°');
        expect(core.formatTemperature('en', 21.5)).to.equal('21.5°');
        expect(core.formatTemperature('de', null)).to.equal('–°');
        expect(core.formatMinutes('de', 0)).to.equal('Aus');
        expect(core.formatMinutes('de', 45)).to.equal('45 Min');
        expect(core.formatMinutes('de', 90)).to.equal('1 Std 30 Min');
        expect(core.formatMinutes('en', 120)).to.equal('2 h');
        expect(core.formatCountdown(65_000)).to.equal('01:05');
        expect(core.formatCountdown(3_725_000)).to.equal('1:02:05');
    });

    it('turns the timer wheel: one turn is 60 minutes, limited to 0...360', () => {
        expect(core.rotateTimer(0, 0, 90)).to.equal(15);
        expect(core.rotateTimer(10, 170, -170)).to.be.closeTo(13.33, 0.01); // across 180°
        expect(core.rotateTimer(5, 90, 0)).to.equal(0);
        expect(core.rotateTimer(358, 0, 90)).to.equal(360);
        expect(core.confirmedTimerMinutes(32.4)).to.equal(32);
        expect(core.confirmedTimerMinutes(1.2)).to.equal(1); // shown as "1 Min"
        expect(core.confirmedTimerMinutes(0.4)).to.equal(0);
        expect(core.angleDeg(0, 0, 0, -1)).to.equal(0);
        expect(core.angleDeg(0, 0, 1, 0)).to.equal(90);
    });

    it('shows reachability before power', () => {
        expect(core.statusKey({ online: false, power: true })).to.equal('unreachable');
        expect(core.statusKey({ online: true, power: true })).to.equal('running');
        expect(core.statusKey({ online: true, power: false })).to.equal('ready');
        expect(core.statusKey({ online: null, power: null })).to.equal('ready');
    });

    it('finds heat/cool conflicts of running multi-split units in one building', () => {
        type UnitValues = { id: string; multiSplit: unknown; building: unknown; power: unknown; mode: unknown };
        const unit = (id: string, mode: number, extra: Record<string, unknown> = {}): UnitValues => ({
            id,
            multiSplit: true,
            building: 'B',
            power: true,
            mode,
            ...extra,
        });
        expect([...core.modeConflicts([unit('a', 1), unit('b', 3)])]).to.have.members(['a', 'b']);
        expect([...core.modeConflicts([unit('a', 1), unit('b', 2)])]).to.have.members(['a', 'b']);
        expect(core.modeConflicts([unit('a', 3), unit('b', 2)]).size).to.equal(0); // both cool
        expect(core.modeConflicts([unit('a', 1), unit('b', 7)]).size).to.equal(0); // fan only
        expect(core.modeConflicts([unit('a', 1), unit('b', 8)]).size).to.equal(0); // auto follows
        expect(core.modeConflicts([unit('a', 1), unit('b', 3, { power: false })]).size).to.equal(0);
        expect(core.modeConflicts([unit('a', 1), unit('b', 3, { multiSplit: false })]).size).to.equal(0);
        expect(core.modeConflicts([unit('a', 1), unit('b', 3, { building: 'C' })]).size).to.equal(0);
        expect([...core.modeConflicts([unit('a', 1), unit('b', 3), unit('c', 3)])]).to.have.members(['a', 'b', 'c']);
    });

    it('uses only built-in icon markup', () => {
        expect(core.roomIconSvg('bed', 0)).to.equal(core.ROOM_ICONS.bed);
        expect(core.roomIconSvg('auto', 0)).to.equal(core.ROOM_ICONS.armchair);
        expect(core.roomIconSvg('auto', 1)).to.equal(core.ROOM_ICONS.bed);
        expect(core.roomIconSvg('<img src=x onerror=alert(1)>', 1)).to.equal(core.ROOM_ICONS.bed);
        expect(core.roomIconSvg('constructor', 0)).to.equal(core.ROOM_ICONS.armchair);
        expect(core.vaneIconSvg('h', 12)).to.include('Q12 4 20 15');
        expect(core.vaneIconSvg('v', 7)).to.include('rotate(-90 12 12)');
        expect(core.vaneIconSvg('h', 1)).to.not.equal(core.vaneIconSvg('v', 1));
        expect(core.vaneIconSvg('h', 3).match(/currentColor/g)).to.have.length(1);
        expect(core.vaneLabel('de', 'h', 3)).to.equal('Position 3');
    });

    it('debounces per key', () => {
        const timers: { fn: () => void; ms: number }[] = [];
        const debouncer = core.createDebouncer(600, {
            setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }) - 1,
            clearTimeout: (handle: unknown) => {
                timers[handle as number] = { fn: () => undefined, ms: -1 };
            },
        });
        const calls: string[] = [];
        debouncer.run('a', () => calls.push('a1'));
        debouncer.run('a', () => calls.push('a2'));
        debouncer.run('b', () => calls.push('b1'));
        expect(debouncer.isPending('a')).to.equal(true);
        timers.forEach(timer => timer.fn());
        expect(calls).to.deep.equal(['a2', 'b1']);
        expect(debouncer.isPending('a')).to.equal(false);
    });

    it('finds unit ids and the instance', () => {
        expect(
            core.unitIdsOf(
                ['melhome.0.devices.b', 'melhome.0.devices.a', 'melhome.0.devices.a.info', 'other.0.devices.c'],
                'melhome.0',
            ),
        ).to.deep.equal(['a', 'b']);
        expect(core.instanceFromSearch('?instance=2')).to.equal(2);
        expect(core.instanceFromSearch('?x=1&instance=1')).to.equal(1);
        expect(core.instanceFromSearch('?instance=abc')).to.equal(0);
        expect(core.instanceFromSearch('')).to.equal(0);
    });
});
