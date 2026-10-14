/*
 * Translation between MELCloud Home values and the neutral ioBroker state codes (docs/api.md section 5).
 *
 * The ioBroker codes are those of the classic MELCloud / Jaeger dashboard, so the states stay compatible
 * with ioBroker.melcloud. This is the only place that knows both vocabularies.
 */

import type {
    ActualFanSpeed,
    AtaCapabilities,
    FanSpeed,
    OperationMode,
    VaneHorizontalDirection,
    VaneVerticalDirection,
} from './api/types';

/** ioBroker code -> API value */
type CodeMap<T extends string> = Readonly<Record<number, T>>;

export const MODE_CODES: CodeMap<OperationMode> = { 8: 'Automatic', 1: 'Heat', 3: 'Cool', 2: 'Dry', 7: 'Fan' };
export const FAN_SPEED_CODES: CodeMap<FanSpeed> = { 0: 'Auto', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' };
export const ACTUAL_FAN_SPEED_CODES: CodeMap<ActualFanSpeed> = {
    0: 'Off',
    1: 'One',
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five',
};
export const VANE_VERTICAL_CODES: CodeMap<VaneVerticalDirection> = {
    0: 'Auto',
    1: 'One',
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five',
    7: 'Swing',
};
export const VANE_HORIZONTAL_CODES: CodeMap<VaneHorizontalDirection> = {
    0: 'Auto',
    1: 'Left',
    2: 'LeftCentre',
    3: 'Centre',
    4: 'RightCentre',
    5: 'Right',
    12: 'Swing',
};

const MODE_LABELS: Readonly<Record<number, string>> = { 8: 'Auto', 1: 'Heat', 3: 'Cool', 2: 'Dry', 7: 'Fan' };
const POSITION_LABELS: Readonly<Record<string, string>> = {
    Auto: 'Auto',
    Swing: 'Swing',
    One: 'Position 1 (top)',
    Two: 'Position 2',
    Three: 'Position 3',
    Four: 'Position 4',
    Five: 'Position 5 (bottom)',
    Left: 'Position 1 (left)',
    LeftCentre: 'Position 2',
    Centre: 'Position 3 (centre)',
    RightCentre: 'Position 4',
    Right: 'Position 5 (right)',
};

/**
 * API value -> ioBroker code (null for null/unknown).
 *
 * @param map - Code map
 * @param value - API value
 */
export function toCode<T extends string>(map: CodeMap<T>, value: T | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    for (const [code, apiValue] of Object.entries(map)) {
        if (apiValue === value) {
            return Number(code);
        }
    }
    return null;
}

/**
 * ioBroker code -> API value (undefined for unknown codes).
 *
 * @param map - Code map
 * @param code - Value written by the user
 */
export function fromCode<T extends string>(map: CodeMap<T>, code: unknown): T | undefined {
    const number = typeof code === 'string' && code.trim() !== '' ? Number(code) : code;
    if (typeof number !== 'number' || !Number.isInteger(number)) {
        return undefined;
    }
    return Object.prototype.hasOwnProperty.call(map, number) ? map[number] : undefined;
}

/**
 * Modes the unit supports, as common.states (fan mode is always available).
 *
 * @param caps - Unit capabilities
 */
export function modeStates(caps: AtaCapabilities): Record<string, string> {
    const available: Record<OperationMode, boolean> = {
        Automatic: caps.hasAutoOperationMode,
        Heat: caps.hasHeatOperationMode,
        Cool: caps.hasCoolOperationMode,
        Dry: caps.hasDryOperationMode,
        Fan: true,
    };
    const states: Record<string, string> = {};
    for (const [code, mode] of Object.entries(MODE_CODES)) {
        if (available[mode]) {
            states[code] = MODE_LABELS[Number(code)];
        }
    }
    return states;
}

/**
 * Selectable fan speeds as common.states.
 *
 * @param caps - Unit capabilities
 */
export function fanSpeedStates(caps: AtaCapabilities): Record<string, string> {
    const states: Record<string, string> = {};
    if (caps.hasAutomaticFanSpeed) {
        states[0] = 'Auto';
    }
    const speeds = Math.max(1, Math.min(5, Math.round(caps.numberOfFanSpeeds)));
    for (let speed = 1; speed <= speeds; speed++) {
        states[speed] = `Speed ${speed}`;
    }
    return states;
}

/** Actual fan speed as common.states */
export function actualFanSpeedStates(): Record<string, string> {
    return { 0: 'Off', 1: 'Speed 1', 2: 'Speed 2', 3: 'Speed 3', 4: 'Speed 4', 5: 'Speed 5' };
}

/**
 * Vane positions as common.states.
 *
 * @param map - VANE_VERTICAL_CODES or VANE_HORIZONTAL_CODES
 * @param caps - Unit capabilities (swing only if supported)
 */
export function vaneStates(
    map: CodeMap<VaneVerticalDirection> | CodeMap<VaneHorizontalDirection>,
    caps: AtaCapabilities,
): Record<string, string> {
    const states: Record<string, string> = {};
    for (const [code, value] of Object.entries(map)) {
        if (value === 'Swing' && !caps.hasSwing) {
            continue;
        }
        states[code] = POSITION_LABELS[value] ?? value;
    }
    return states;
}

/**
 * Checks whether a code is allowed by the given states (respects capabilities).
 *
 * @param states - Result of modeStates / fanSpeedStates / vaneStates
 * @param code - Value written by the user
 */
export function isAllowedCode(states: Record<string, string>, code: unknown): boolean {
    const number = typeof code === 'string' && code.trim() !== '' ? Number(code) : code;
    return typeof number === 'number' && Number.isInteger(number) && String(number) in states;
}

/** Target temperature limits of one mode */
export interface TemperatureLimits {
    /** Lowest allowed target temperature */
    min: number;
    /** Highest allowed target temperature */
    max: number;
    /** Step width */
    step: number;
}

/**
 * Target temperature limits for a mode (fan mode has no target; the widest range is returned).
 *
 * @param caps - Unit capabilities
 * @param mode - Operation mode, null if unknown
 */
export function temperatureLimits(caps: AtaCapabilities, mode: OperationMode | null): TemperatureLimits {
    const step = caps.hasHalfDegreeIncrements ? 0.5 : 1;
    switch (mode) {
        case 'Heat':
            return { min: caps.minTempHeat, max: caps.maxTempHeat, step };
        case 'Cool':
        case 'Dry':
            return { min: caps.minTempCoolDry, max: caps.maxTempCoolDry, step };
        case 'Automatic':
            return { min: caps.minTempAutomatic, max: caps.maxTempAutomatic, step };
        default:
            return overallTemperatureLimits(caps);
    }
}

/**
 * Widest temperature range over all modes (for common.min/max).
 *
 * @param caps - Unit capabilities
 */
export function overallTemperatureLimits(caps: AtaCapabilities): TemperatureLimits {
    return {
        min: Math.min(caps.minTempHeat, caps.minTempCoolDry, caps.minTempAutomatic),
        max: Math.max(caps.maxTempHeat, caps.maxTempCoolDry, caps.maxTempAutomatic),
        step: caps.hasHalfDegreeIncrements ? 0.5 : 1,
    };
}

/**
 * Rounds to the step width and clamps to the limits of the mode.
 *
 * @param value - Requested temperature
 * @param limits - Limits of the mode
 */
export function clampTemperature(value: number, limits: TemperatureLimits): number {
    const rounded = Math.round(value / limits.step) * limits.step;
    return Math.min(limits.max, Math.max(limits.min, Number(rounded.toFixed(1))));
}

/** Room icons the dashboard knows; "auto" lets the dashboard pick its default */
export const ROOM_ICONS = ['auto', 'armchair', 'bed', 'desk', 'dining', 'child', 'unit'] as const;

/**
 * Validated room icon from the instance settings.
 *
 * @param value - Configured icon, may be missing or unknown
 */
export function roomIcon(value: unknown): string {
    return typeof value === 'string' && (ROOM_ICONS as readonly string[]).includes(value) ? value : 'auto';
}
