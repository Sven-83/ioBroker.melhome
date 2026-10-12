/*
 * API types and defensive parsing (docs/api.md sections 3 and 5).
 *
 * Rules: unknown fields are ignored, missing fields become null, unknown values
 * are reported once via the warning callback and become null. Nothing in here throws
 * on unexpected content - only a context that is not an object at all is rejected.
 *
 * Values are normalised to the MELCloud Home control vocabulary (the words the PUT
 * endpoint expects). The translation to ioBroker codes lives in lib/mapping.ts.
 */

import { stripLineBreaks } from './errors';

export const OPERATION_MODES = ['Heat', 'Cool', 'Automatic', 'Dry', 'Fan'] as const;
export type OperationMode = (typeof OPERATION_MODES)[number];

export const FAN_SPEEDS = ['Auto', 'One', 'Two', 'Three', 'Four', 'Five'] as const;
export type FanSpeed = (typeof FAN_SPEEDS)[number];

export const ACTUAL_FAN_SPEEDS = ['Off', 'One', 'Two', 'Three', 'Four', 'Five'] as const;
export type ActualFanSpeed = (typeof ACTUAL_FAN_SPEEDS)[number];

export const VANE_VERTICAL_DIRECTIONS = ['Auto', 'Swing', 'One', 'Two', 'Three', 'Four', 'Five'] as const;
export type VaneVerticalDirection = (typeof VANE_VERTICAL_DIRECTIONS)[number];

export const VANE_HORIZONTAL_DIRECTIONS = [
    'Auto',
    'Swing',
    'Left',
    'LeftCentre',
    'Centre',
    'RightCentre',
    'Right',
] as const;
export type VaneHorizontalDirection = (typeof VANE_HORIZONTAL_DIRECTIONS)[number];

const NUMERIC_TO_WORD: Record<string, string> = {
    0: 'Auto',
    1: 'One',
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five',
};
/** /context fallback of the reference for vertical swing (docs/api.md section 5.3) */
const VANE_VERTICAL_NUMERIC: Record<string, string> = { ...NUMERIC_TO_WORD, 7: 'Swing' };
const VANE_HORIZONTAL_AMERICAN: Record<string, string> = {
    Center: 'Centre',
    CenterLeft: 'LeftCentre',
    LeftCenter: 'LeftCentre',
    CenterRight: 'RightCentre',
    RightCenter: 'RightCentre',
};

/** ATA capabilities with the defaults of the reference implementation */
export interface AtaCapabilities {
    /** Number of selectable fan speeds */
    numberOfFanSpeeds: number;
    /** Fan speed "Auto" available */
    hasAutomaticFanSpeed: boolean;
    /** Minimum target temperature in heat mode */
    minTempHeat: number;
    /** Maximum target temperature in heat mode */
    maxTempHeat: number;
    /** Minimum target temperature in cool/dry mode */
    minTempCoolDry: number;
    /** Maximum target temperature in cool/dry mode */
    maxTempCoolDry: number;
    /** Minimum target temperature in automatic mode */
    minTempAutomatic: number;
    /** Maximum target temperature in automatic mode */
    maxTempAutomatic: number;
    /** Target temperature in 0.5 steps */
    hasHalfDegreeIncrements: boolean;
    /** Extended heating range (down to 10 °C) */
    hasExtendedTemperatureRange: boolean;
    /** Cool mode available */
    hasCoolOperationMode: boolean;
    /** Heat mode available */
    hasHeatOperationMode: boolean;
    /** Automatic mode available */
    hasAutoOperationMode: boolean;
    /** Dry mode available */
    hasDryOperationMode: boolean;
    /** Vane swing available */
    hasSwing: boolean;
    /** Vane direction adjustable */
    hasAirDirection: boolean;
    /** Horizontal (wide) vane motorised - unconfirmed */
    supportsWideVane: boolean;
    /** Standby mode available */
    hasStandby: boolean;
    /** Energy meter available */
    hasEnergyConsumedMeter: boolean;
    /** Part of a multi-split system (null if unknown) */
    isMultiSplitSystem: boolean | null;
}

export const DEFAULT_ATA_CAPABILITIES: Readonly<AtaCapabilities> = Object.freeze({
    numberOfFanSpeeds: 5,
    hasAutomaticFanSpeed: true,
    minTempHeat: 10,
    maxTempHeat: 31,
    minTempCoolDry: 16,
    maxTempCoolDry: 31,
    minTempAutomatic: 16,
    maxTempAutomatic: 31,
    hasHalfDegreeIncrements: true,
    hasExtendedTemperatureRange: true,
    hasCoolOperationMode: true,
    hasHeatOperationMode: true,
    hasAutoOperationMode: true,
    hasDryOperationMode: true,
    hasSwing: true,
    hasAirDirection: true,
    supportsWideVane: false,
    hasStandby: false,
    hasEnergyConsumedMeter: false,
    isMultiSplitSystem: null,
});

/** One air-to-air unit as delivered by /context */
export interface AtaUnit {
    /** Stable unit UUID */
    id: string;
    /** Room name given in the app (line breaks removed - still untrusted, escape in HTML!) */
    name: string;
    /** Building UUID */
    buildingId: string;
    /** Building name (untrusted text) */
    buildingName: string;
    /** Building is shared with this account */
    isGuest: boolean;
    /** Cloud can reach the unit */
    isConnected: boolean;
    /** IANA time zone of the unit */
    timeZone: string | null;
    /** Unit switched on */
    power: boolean | null;
    /** Operation mode */
    operationMode: OperationMode | null;
    /** Target temperature °C */
    setTemperature: number | null;
    /** Room temperature °C */
    roomTemperature: number | null;
    /** Requested fan speed */
    setFanSpeed: FanSpeed | null;
    /** Fan speed the unit is running at */
    actualFanSpeed: ActualFanSpeed | null;
    /** Vertical vane position */
    vaneVerticalDirection: VaneVerticalDirection | null;
    /** Horizontal vane position */
    vaneHorizontalDirection: VaneHorizontalDirection | null;
    /** Standby active */
    inStandbyMode: boolean | null;
    /** Unit reports an error */
    isInError: boolean;
    /** Empty string if there is no error */
    errorCode: string;
    /** Outdated according to the reference - prefer the telemetry endpoint */
    rssi: number | null;
    /** Capabilities with defaults applied */
    capabilities: AtaCapabilities;
}

/** Parsed /context */
export interface UserContext {
    /** Supported air-to-air units */
    ataUnits: AtaUnit[];
    /** Number of air-to-water units (not supported in v1) */
    atwUnitCount: number;
}

/** Fields of a control request; unset fields are sent as null */
export interface AtaControlRequest {
    /** Switch on/off (power on requires operationMode) */
    power?: boolean;
    /** Operation mode */
    operationMode?: OperationMode;
    /** Fan speed */
    setFanSpeed?: FanSpeed;
    /** Horizontal vane (never together with vertical) */
    vaneHorizontalDirection?: VaneHorizontalDirection;
    /** Vertical vane (never together with horizontal) */
    vaneVerticalDirection?: VaneVerticalDirection;
    /** Target temperature °C */
    setTemperature?: number;
    /** Temperature step override (unused by the app) */
    temperatureIncrementOverride?: number;
    /** Standby mode */
    inStandbyMode?: boolean;
}

/** A measured value with the time the unit recorded it */
export interface Reading {
    /** Measured value */
    value: number;
    /** Epoch ms (UTC) */
    time: number;
}

/** Hourly energy values: hour start (epoch ms) -> Wh consumed in that hour */
export type HourlyEnergy = Map<number, number>;

export type WarningCallback = (key: string, message: string) => void;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/**
 * Parses "True"/"False" (any case) or real booleans.
 *
 * @param value - Raw value
 */
export function parseBool(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'true') {
            return true;
        }
        if (lower === 'false') {
            return false;
        }
    }
    return null;
}

/**
 * Parses numbers and numeric strings; "" and garbage become null.
 *
 * @param value - Raw value
 */
export function parseNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function parseString(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return null;
}

/**
 * Maps a raw value onto an allowed vocabulary.
 *
 * @param raw - Value from the API
 * @param allowed - Allowed words
 * @param aliases - Alternative spellings / numeric codes
 * @param onUnknown - Called for values outside the vocabulary
 */
function parseEnum<T extends string>(
    raw: unknown,
    allowed: readonly T[],
    aliases: Record<string, string>,
    onUnknown: (value: string) => void,
): T | null {
    const text = parseString(raw)?.trim();
    if (text === undefined || text === '') {
        return null;
    }
    const candidate = aliases[text] ?? text;
    const match = allowed.find(word => word.toLowerCase() === candidate.toLowerCase());
    if (match) {
        return match;
    }
    onUnknown(text);
    return null;
}

/**
 * Reads the capabilities object, falling back to defaults per field.
 *
 * @param raw - capabilities from /context
 */
export function parseCapabilities(raw: unknown): AtaCapabilities {
    const data = isObject(raw) ? raw : {};
    const result: AtaCapabilities = { ...DEFAULT_ATA_CAPABILITIES };
    for (const key of Object.keys(DEFAULT_ATA_CAPABILITIES) as (keyof AtaCapabilities)[]) {
        const value = data[key];
        if (key === 'isMultiSplitSystem') {
            result.isMultiSplitSystem = parseBool(value);
        } else if (typeof DEFAULT_ATA_CAPABILITIES[key] === 'number') {
            const parsed = parseNumber(value);
            if (parsed !== null) {
                (result[key] as number) = parsed;
            }
        } else {
            const parsed = parseBool(value);
            if (parsed !== null) {
                (result[key] as boolean) = parsed;
            }
        }
    }
    return result;
}

/**
 * Converts the settings array ([{name, value}]) to a map.
 *
 * @param raw - settings from /context
 */
function settingsMap(raw: unknown): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const item of asArray(raw)) {
        if (isObject(item) && typeof item.name === 'string') {
            map.set(item.name, item.value);
        }
    }
    return map;
}

/**
 * Parses one air-to-air unit; returns null if it has no usable id.
 *
 * @param raw - Unit object
 * @param building - Building it belongs to
 * @param building.id - Building id
 * @param building.name - Building name
 * @param building.isGuest - Shared building
 * @param warn - Warning callback
 */
export function parseAtaUnit(
    raw: unknown,
    building: { id: string; name: string; isGuest: boolean },
    warn: WarningCallback,
): AtaUnit | null {
    if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.trim() === '') {
        warn('unit-without-id', 'Ignoring an air-to-air unit without id in the MELCloud Home response');
        return null;
    }
    const id = raw.id.trim();
    const settings = settingsMap(raw.settings);
    const unknown =
        (field: string) =>
        (value: string): void =>
            warn(
                `${id}:${field}:${value}`,
                `Unit ${id} reported unknown ${field} "${stripLineBreaks(value)}" - value ignored`,
            );

    const isInError = parseBool(settings.get('IsInError')) ?? parseBool(raw.isInError) ?? false;

    return {
        id,
        name: stripLineBreaks(parseString(raw.givenDisplayName)?.trim() || id),
        buildingId: building.id,
        buildingName: building.name,
        isGuest: building.isGuest,
        isConnected: parseBool(raw.isConnected) ?? false,
        timeZone: parseString(raw.timeZone) ?? null,
        power: parseBool(settings.get('Power')),
        operationMode: parseEnum(settings.get('OperationMode'), OPERATION_MODES, {}, unknown('operation mode')),
        setTemperature: parseNumber(settings.get('SetTemperature')),
        roomTemperature: parseNumber(settings.get('RoomTemperature')),
        setFanSpeed: parseEnum(settings.get('SetFanSpeed'), FAN_SPEEDS, NUMERIC_TO_WORD, unknown('fan speed')),
        actualFanSpeed: parseEnum(settings.get('ActualFanSpeed'), ACTUAL_FAN_SPEEDS, {}, unknown('actual fan speed')),
        vaneVerticalDirection: parseEnum(
            settings.get('VaneVerticalDirection'),
            VANE_VERTICAL_DIRECTIONS,
            VANE_VERTICAL_NUMERIC,
            unknown('vertical vane direction'),
        ),
        vaneHorizontalDirection: parseEnum(
            settings.get('VaneHorizontalDirection'),
            VANE_HORIZONTAL_DIRECTIONS,
            VANE_HORIZONTAL_AMERICAN,
            unknown('horizontal vane direction'),
        ),
        inStandbyMode: parseBool(settings.get('InStandbyMode')),
        isInError,
        errorCode: stripLineBreaks(parseString(settings.get('ErrorCode'))?.trim() ?? ''),
        rssi: parseNumber(raw.rssi),
        capabilities: parseCapabilities(raw.capabilities),
    };
}

/**
 * Parses the /context response (own and shared buildings).
 *
 * @param raw - Parsed JSON body
 * @param warn - Warning callback
 */
export function parseUserContext(raw: unknown, warn: WarningCallback): UserContext | null {
    if (!isObject(raw)) {
        return null;
    }
    const ataUnits: AtaUnit[] = [];
    const seen = new Set<string>();
    let atwUnitCount = 0;

    const buildings = [
        ...asArray(raw.buildings).map(b => ({ raw: b, isGuest: false })),
        ...asArray(raw.guestBuildings).map(b => ({ raw: b, isGuest: true })),
    ];
    for (const { raw: building, isGuest } of buildings) {
        if (!isObject(building)) {
            continue;
        }
        const info = {
            id: parseString(building.id) ?? '',
            name: stripLineBreaks(parseString(building.name)?.trim() ?? ''),
            isGuest,
        };
        for (const rawUnit of asArray(building.airToAirUnits)) {
            const unit = parseAtaUnit(rawUnit, info, warn);
            // a building shared with oneself may appear twice
            if (unit && !seen.has(unit.id)) {
                seen.add(unit.id);
                ataUnits.push(unit);
            }
        }
        atwUnitCount += asArray(building.airToWaterUnits).length;
    }
    return { ataUnits, atwUnitCount };
}

/**
 * Builds the complete control body: all 8 fields, unchanged ones as null (docs/api.md section 3.3).
 *
 * @param request - Fields to change
 */
export function buildAtaControlBody(request: AtaControlRequest): Record<keyof AtaControlRequest, unknown> {
    return {
        power: request.power ?? null,
        operationMode: request.operationMode ?? null,
        setFanSpeed: request.setFanSpeed ?? null,
        vaneHorizontalDirection: request.vaneHorizontalDirection ?? null,
        vaneVerticalDirection: request.vaneVerticalDirection ?? null,
        setTemperature: request.setTemperature ?? null,
        temperatureIncrementOverride: request.temperatureIncrementOverride ?? null,
        inStandbyMode: request.inStandbyMode ?? null,
    };
}

/**
 * Parses a naive API timestamp ("2025-12-09 09:00:00.000000000" or "2026-01-12T20:00:00")
 * as wall-clock time in the given zone. Returns epoch ms or null.
 *
 * @param value - Timestamp text
 * @param timeZone - IANA zone of the timestamp, default UTC
 */
export function parseApiTimestamp(value: unknown, timeZone = 'UTC'): number | null {
    const text = parseString(value);
    if (!text) {
        return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
        text.trim(),
    );
    if (!match) {
        return null;
    }
    const [, y, mo, d, h, mi, s = '0', frac = '0', offset] = match;
    const ms = Number(`0.${frac}`) * 1000;
    const wallClock = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Math.floor(ms));
    if (Number.isNaN(wallClock)) {
        return null;
    }
    if (offset) {
        if (offset === 'Z') {
            return wallClock;
        }
        const sign = offset.startsWith('-') ? -1 : 1;
        const digits = offset.replace(/[+:-]/g, '');
        const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
        return wallClock - sign * minutes * 60_000;
    }
    return wallClock - timeZoneOffsetMs(wallClock, timeZone);
}

/**
 * Offset of a zone at (approximately) the given instant in ms.
 *
 * @param instant - Epoch ms
 * @param timeZone - IANA zone
 */
function timeZoneOffsetMs(instant: number, timeZone: string): number {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(new Date(instant));
        const get = (type: string): number => Number(parts.find(p => p.type === type)?.value);
        const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
        return asUtc - Math.floor(instant / 1000) * 1000;
    } catch {
        return 0;
    }
}

/**
 * Collects all {time, value} points of a telemetry response (energy, rssi).
 *
 * @param raw - Parsed JSON body (null for HTTP 304)
 */
function telemetryPoints(raw: unknown): Reading[] {
    const points: Reading[] = [];
    if (!isObject(raw)) {
        return points;
    }
    for (const measure of asArray(raw.measureData)) {
        if (!isObject(measure)) {
            continue;
        }
        for (const point of asArray(measure.values)) {
            if (!isObject(point)) {
                continue;
            }
            const time = parseApiTimestamp(point.time);
            const value = parseNumber(point.value);
            if (time !== null && value !== null) {
                points.push({ time, value });
            }
        }
    }
    return points;
}

/**
 * Newest Wi-Fi signal reading (dBm) of a telemetry response.
 *
 * @param raw - Parsed JSON body
 */
export function parseRssi(raw: unknown): Reading | null {
    const points = telemetryPoints(raw);
    if (points.length === 0) {
        return null;
    }
    const newest = points.reduce((a, b) => (b.time > a.time ? b : a));
    return { value: Math.round(newest.value), time: newest.time };
}

/**
 * Hourly energy values (Wh per hour, not cumulative). Later duplicates of an hour win.
 *
 * @param raw - Parsed JSON body
 */
export function parseHourlyEnergy(raw: unknown): HourlyEnergy {
    const result: HourlyEnergy = new Map();
    for (const point of telemetryPoints(raw)) {
        if (point.value >= 0) {
            result.set(point.time, point.value);
        }
    }
    return result;
}

/**
 * Newest genuine outdoor temperature of a trendsummary response. Points with
 * second == 0 are synthetic chart points and ignored (docs/api.md section 3.6).
 *
 * @param raw - Parsed JSON body
 * @param timeZone - Time zone of the unit (timestamps are local wall-clock time)
 */
export function parseOutdoorTemperature(raw: unknown, timeZone: string | null): Reading | null {
    const report = Array.isArray(raw) ? raw[0] : raw;
    if (!isObject(report)) {
        return null;
    }
    const dataset = asArray(report.datasets).find(
        d => isObject(d) && typeof d.label === 'string' && d.label.includes('OUTDOOR_TEMPERATURE'),
    );
    if (!isObject(dataset)) {
        return null;
    }
    let newest: Reading | null = null;
    for (const point of asArray(dataset.data)) {
        if (!isObject(point)) {
            continue;
        }
        const time = parseApiTimestamp(point.x, timeZone ?? 'UTC');
        const value = parseNumber(point.y);
        if (time === null || value === null || new Date(time).getUTCSeconds() === 0) {
            continue;
        }
        if (!newest || time > newest.time) {
            newest = { value, time };
        }
    }
    return newest;
}
