/*
 * Air-to-air units: object tree, state updates, command handling (docs/api.md section 8).
 *
 * Object IDs are based on the stable unit UUID, never on the display name.
 * The cloud stays the source of truth; after an accepted command the new value is shown
 * optimistically until /context confirms it (or a guard time elapses).
 */

import type { Scheduler } from '../api/connection';
import { describeError } from '../api/errors';
import type { Logger } from '../api/http';
import type { AtaControlRequest, AtaUnit, HourlyEnergy, Reading, UserContext } from '../api/types';
import {
    ACTUAL_FAN_SPEED_CODES,
    FAN_SPEED_CODES,
    MODE_CODES,
    ROOM_ICONS,
    VANE_HORIZONTAL_CODES,
    VANE_VERTICAL_CODES,
    actualFanSpeedStates,
    fanSpeedStates,
    fromCode,
    isAllowedCode,
    modeStates,
    overallTemperatureLimits,
    toCode,
    vaneStates,
    roomIcon,
} from '../mapping';
import { CommandQueue } from './commands';
import { applyEnergy, restoreEnergyTrackerData, startOfLocalDay, type EnergyTrackerData } from './energy';
import { MAX_OFF_TIMER_MINUTES, OffTimers } from './off-timer';
import type { TelemetrySink } from './telemetry';

/** How long an optimistic value wins over a different value from /context */
export const OPTIMISTIC_GUARD_MS = 120_000;

/** How long the adapter keeps trying to get a requested vane swing or auto applied (docs/api.md section 9.1) */
export const SWING_RETRY_WINDOW_MS = 30 * 60_000;

/** Maximum automatic repetitions of one swing or auto request */
export const SWING_RETRY_MAX = 3;

type VaneField = 'vaneHorizontalDirection' | 'vaneVerticalDirection';

/** ioBroker swing code and log label per vane */
const VANE_AXES: Readonly<Record<VaneField, { swing: number; label: string }>> = {
    vaneHorizontalDirection: { swing: 12, label: 'horizontal' },
    vaneVerticalDirection: { swing: 7, label: 'vertical' },
};

/** ioBroker code of vane auto (same on both vanes) */
const VANE_AUTO = 0;

/** Vane values the cloud drops until the unit reports again */
type MovingVaneValue = 'Swing' | 'Auto';

/**
 * A requested swing or auto that the unit may not have applied yet (both vanes behave the same).
 * The cloud drops "Swing"/"Auto" until the unit reports again; the report then shows the old position.
 */
interface SwingWish {
    /** Requested API value */
    value: MovingVaneValue;
    /** ioBroker code of the requested value */
    code: number;
    /** Vane code reported before the request */
    before: ioBroker.StateValue;
    /** End of the retry window */
    until: number;
    /** Repetitions sent so far */
    retries: number;
    /** The cloud has shown the requested value since the last request */
    stored: boolean;
}

/**
 * True for the fixed vane positions 1-5 (same codes on both vanes).
 *
 * @param code - Vane code
 */
function isFixedPosition(code: ioBroker.StateValue): boolean {
    return typeof code === 'number' && code >= 1 && code <= 5;
}

/** Narrow view of the adapter, so this module stays testable */
export interface AdapterPort {
    /** Adapter namespace, e.g. melhome.0 */
    namespace: string;
    /** Creates or updates an object (relative id) */
    extendObject(id: string, obj: ioBroker.PartialObject): Promise<void>;
    /** Reads an object (relative id) */
    getObject(id: string): Promise<ioBroker.Object | null | undefined>;
    /** Writes a state (relative id) */
    setState(id: string, val: ioBroker.StateValue, ack: boolean): Promise<void>;
    /** Reads a state (relative id) */
    getState(id: string): Promise<ioBroker.State | null | undefined>;
    /** Reads all states matching a pattern (relative) */
    getStates(pattern: string): Promise<Record<string, ioBroker.State | null | undefined>>;
    /** Replaces characters not allowed in object IDs */
    sanitizeId(id: string): string;
}

/** What the devices need from the REST client */
export interface ControlClient {
    /** Sends one control request */
    controlAta(unitId: string, request: AtaControlRequest): Promise<void>;
}

/** Dependencies of the device layer */
export interface AtaDevicesOptions {
    /** Adapter functions */
    port: AdapterPort;
    /** REST client for control requests */
    client: ControlClient;
    /** Adapter logger */
    log: Logger;
    /** Timer functions of the adapter */
    scheduler: Scheduler;
    /** Abortable sleep */
    sleep: (ms: number) => Promise<void>;
    /** Asks the connection manager for a quick /context refresh */
    requestRefresh: () => void;
    /** Clock (tests) */
    now?: () => number;
    /** Debounce of commands (tests) */
    debounceMs?: number;
    /** Gap between requests to one unit (tests) */
    gapMs?: number;
    /** Dashboard room icon per unit id (instance settings) */
    roomIcons?: Readonly<Record<string, string>>;
}

type ControlField =
    'power' | 'mode' | 'targetTemp' | 'fanSpeed' | 'vaneVerticalDirection' | 'vaneHorizontalDirection' | 'standby';

const ROOT = 'devices';

const name = (en: string, de: string): ioBroker.StringOrTranslated => ({ en, de });

/**
 * Current ioBroker value of a control field.
 *
 * @param unit - Unit state
 * @param field - Control field
 */
function controlValue(unit: AtaUnit, field: ControlField): ioBroker.StateValue {
    switch (field) {
        case 'power':
            return unit.power;
        case 'mode':
            return toCode(MODE_CODES, unit.operationMode);
        case 'targetTemp':
            return unit.setTemperature;
        case 'fanSpeed':
            return toCode(FAN_SPEED_CODES, unit.setFanSpeed);
        case 'vaneVerticalDirection':
            return toCode(VANE_VERTICAL_CODES, unit.vaneVerticalDirection);
        case 'vaneHorizontalDirection':
            return toCode(VANE_HORIZONTAL_CODES, unit.vaneHorizontalDirection);
        case 'standby':
            return unit.inStandbyMode;
    }
}

/**
 * ioBroker values of the fields an accepted request changed.
 *
 * @param request - Accepted control request
 */
function fieldsOfRequest(request: AtaControlRequest): Partial<Record<ControlField, ioBroker.StateValue>> {
    const fields: Partial<Record<ControlField, ioBroker.StateValue>> = {};
    if (request.power !== undefined) {
        fields.power = request.power;
    }
    if (request.operationMode !== undefined) {
        fields.mode = toCode(MODE_CODES, request.operationMode);
    }
    if (request.setTemperature !== undefined) {
        fields.targetTemp = request.setTemperature;
    }
    if (request.setFanSpeed !== undefined) {
        fields.fanSpeed = toCode(FAN_SPEED_CODES, request.setFanSpeed);
    }
    if (request.vaneVerticalDirection !== undefined) {
        fields.vaneVerticalDirection = toCode(VANE_VERTICAL_CODES, request.vaneVerticalDirection);
    }
    if (request.vaneHorizontalDirection !== undefined) {
        fields.vaneHorizontalDirection = toCode(VANE_HORIZONTAL_CODES, request.vaneHorizontalDirection);
    }
    if (request.inStandbyMode !== undefined) {
        fields.standby = request.inStandbyMode;
    }
    return fields;
}

/**
 * Object definitions of one unit (relative IDs).
 *
 * @param base - Relative device id (devices.<uuid>)
 * @param unit - Unit
 * @param namespace - Adapter namespace (for statusStates)
 */
export function buildUnitObjects(
    base: string,
    unit: AtaUnit,
    namespace: string,
): { id: string; obj: ioBroker.PartialObject }[] {
    const caps = unit.capabilities;
    const temp = overallTemperatureLimits(caps);
    const objects: { id: string; obj: ioBroker.PartialObject }[] = [];
    const channel = (id: string, channelName: ioBroker.StringOrTranslated): void => {
        objects.push({ id: `${base}.${id}`, obj: { type: 'channel', common: { name: channelName }, native: {} } });
    };
    const state = (id: string, common: Partial<ioBroker.StateCommon>): void => {
        objects.push({
            id: `${base}.${id}`,
            obj: { type: 'state', common: { read: true, write: false, ...common }, native: {} },
        });
    };

    objects.push({
        id: base,
        obj: {
            type: 'device',
            common: {
                name: unit.name,
                statusStates: {
                    onlineId: `${namespace}.${base}.info.deviceOnline`,
                    errorId: `${namespace}.${base}.info.hasError`,
                },
            } as ioBroker.DeviceCommon,
            native: { unitId: unit.id },
        },
    });

    channel('info', name('Information', 'Information'));
    state('info.name', { name: name('Room name', 'Raumname'), type: 'string', role: 'info.name' });
    state('info.building', { name: name('Building', 'Gebäude'), type: 'string', role: 'text' });
    state('info.isGuest', { name: name('Shared building', 'Geteiltes Gebäude'), type: 'boolean', role: 'indicator' });
    state('info.deviceOnline', {
        name: name('Unit reachable', 'Gerät erreichbar'),
        type: 'boolean',
        role: 'indicator.reachable',
    });
    state('info.hasError', {
        name: name('Unit reports an error', 'Gerät meldet Störung'),
        type: 'boolean',
        role: 'indicator.maintenance.alarm',
    });
    state('info.errorCode', { name: name('Error code', 'Fehlercode'), type: 'string', role: 'text' });
    state('info.icon', {
        name: name('Dashboard room icon', 'Dashboard-Raumsymbol'),
        type: 'string',
        role: 'text',
        states: Object.fromEntries(ROOM_ICONS.map(icon => [icon, icon])),
    });
    state('info.roomTemp', {
        name: name('Room temperature', 'Raumtemperatur'),
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
    });
    state('info.outdoorTemp', {
        name: name('Outdoor temperature', 'Außentemperatur'),
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
    });
    state('info.outdoorTempTime', {
        name: name('Time of the outdoor temperature reading', 'Zeitpunkt der Außentemperatur'),
        type: 'number',
        role: 'value.time',
    });
    state('info.actualFanSpeed', {
        name: name('Actual fan speed', 'Aktuelle Lüfterstufe'),
        type: 'number',
        role: 'value',
        states: actualFanSpeedStates(),
    });
    state('info.wifiSignal', {
        name: name('Wi-Fi signal', 'WLAN-Signal'),
        type: 'number',
        role: 'value',
        unit: 'dBm',
    });
    state('info.lastUpdate', {
        name: name('Last update from the cloud', 'Letzte Aktualisierung aus der Cloud'),
        type: 'number',
        role: 'value.time',
    });

    channel('control', name('Control', 'Steuerung'));
    state('control.power', { name: name('Power', 'Ein/Aus'), type: 'boolean', role: 'switch.power', write: true });
    state('control.mode', {
        name: name('Operation mode', 'Betriebsmodus'),
        type: 'number',
        role: 'level.mode.airconditioner',
        write: true,
        states: modeStates(caps),
    });
    state('control.targetTemp', {
        name: name('Target temperature', 'Solltemperatur'),
        type: 'number',
        role: 'level.temperature',
        write: true,
        unit: '°C',
        min: temp.min,
        max: temp.max,
        step: temp.step,
    });
    state('control.fanSpeed', {
        name: name('Fan speed', 'Lüfterstufe'),
        type: 'number',
        role: 'level.mode.fan',
        write: true,
        states: fanSpeedStates(caps),
    });
    state('control.vaneVerticalDirection', {
        name: name('Vertical vane', 'Lamelle vertikal (Höhe)'),
        type: 'number',
        role: 'level.mode.swing',
        write: caps.hasAirDirection,
        states: vaneStates(VANE_VERTICAL_CODES, caps),
    });
    state('control.vaneHorizontalDirection', {
        name: name('Horizontal vane', 'Lamelle horizontal (Seite)'),
        type: 'number',
        role: 'level.mode.swing',
        write: caps.supportsWideVane,
        states: vaneStates(VANE_HORIZONTAL_CODES, caps),
    });
    if (caps.hasStandby) {
        state('control.standby', { name: name('Standby', 'Standby'), type: 'boolean', role: 'switch', write: true });
    }
    state('control.offTimer', {
        name: name('Switch off in (0 = no timer)', 'Ausschalten in (0 = kein Timer)'),
        type: 'number',
        role: 'level.timer',
        write: true,
        unit: 'min',
        min: 0,
        max: MAX_OFF_TIMER_MINUTES,
        def: 0,
    });
    state('control.offTimerRemaining', {
        name: name('Off timer remaining', 'Restzeit Abschalt-Timer'),
        type: 'number',
        role: 'value.interval',
        unit: 's',
        def: 0,
    });
    state('control.offTimerEnd', {
        name: name('Off timer end', 'Ende Abschalt-Timer'),
        type: 'number',
        role: 'date.end',
        def: 0,
    });

    if (caps.hasEnergyConsumedMeter) {
        channel('energy', name('Energy', 'Energie'));
        state('energy.total', {
            name: name('Energy consumed (counter)', 'Energieverbrauch (Zähler)'),
            type: 'number',
            role: 'value.energy.consumed',
            unit: 'kWh',
        });
        state('energy.lastHour', {
            name: name('Energy of the latest hour', 'Energie der letzten Stunde'),
            type: 'number',
            role: 'value.energy',
            unit: 'kWh',
        });
        state('energy.today', {
            name: name('Energy today', 'Energie heute'),
            type: 'number',
            role: 'value.energy',
            unit: 'kWh',
        });
    }

    channel('capabilities', name('Capabilities', 'Fähigkeiten'));
    const capNumber = (id: string, label: ioBroker.StringOrTranslated, unitText?: string): void =>
        state(`capabilities.${id}`, { name: label, type: 'number', role: 'value', unit: unitText });
    const capFlag = (id: string, label: ioBroker.StringOrTranslated): void =>
        state(`capabilities.${id}`, { name: label, type: 'boolean', role: 'indicator' });
    capNumber('minTempHeat', name('Min. temperature heat', 'Min. Temperatur Heizen'), '°C');
    capNumber('maxTempHeat', name('Max. temperature heat', 'Max. Temperatur Heizen'), '°C');
    capNumber('minTempCoolDry', name('Min. temperature cool/dry', 'Min. Temperatur Kühlen/Trocknen'), '°C');
    capNumber('maxTempCoolDry', name('Max. temperature cool/dry', 'Max. Temperatur Kühlen/Trocknen'), '°C');
    capNumber('minTempAuto', name('Min. temperature auto', 'Min. Temperatur Auto'), '°C');
    capNumber('maxTempAuto', name('Max. temperature auto', 'Max. Temperatur Auto'), '°C');
    capNumber('tempStep', name('Temperature step', 'Temperatur-Schrittweite'), '°C');
    capNumber('fanSpeeds', name('Number of fan speeds', 'Anzahl Lüfterstufen'));
    state('capabilities.modes', { name: name('Available modes', 'Verfügbare Modi'), type: 'string', role: 'json' });
    capFlag('hasSwing', name('Swing available', 'Swing verfügbar'));
    capFlag('hasAirDirection', name('Vertical vane adjustable', 'Lamelle vertikal verstellbar'));
    capFlag('supportsWideVane', name('Horizontal vane adjustable', 'Lamelle horizontal verstellbar'));
    capFlag('hasStandby', name('Standby available', 'Standby verfügbar'));
    capFlag('hasEnergyMeter', name('Energy meter available', 'Energiezähler verfügbar'));
    capFlag('isMultiSplit', name('Multi-split system', 'Multi-Split-System'));

    return objects;
}

/**
 * Manages all air-to-air units.
 */
export class AtaDevices implements TelemetrySink {
    private readonly options: AtaDevicesOptions;
    private readonly port: AdapterPort;
    private readonly log: Logger;
    private readonly now: () => number;
    private readonly units = new Map<string, AtaUnit>();
    /** object key (sanitised) -> unit id */
    private readonly keys = new Map<string, string>();
    /** unit id -> signature of the created objects */
    private readonly objectSignatures = new Map<string, string>();
    /** relative state id -> last value written with ack */
    private readonly written = new Map<string, ioBroker.StateValue>();
    /** unitId.field -> optimistic value */
    private readonly guards = new Map<string, { value: ioBroker.StateValue; until: number; pending: boolean }>();
    private readonly energy = new Map<string, EnergyTrackerData>();
    private readonly queue: CommandQueue;
    private readonly timers: OffTimers;
    private readonly missingLogged = new Set<string>();
    /** "<unit id>.<vane field>" -> requested swing */
    private readonly swingWishes = new Map<string, SwingWish>();

    /** @param options - Dependencies */
    public constructor(options: AtaDevicesOptions) {
        this.options = options;
        this.port = options.port;
        this.log = options.log;
        this.now = options.now ?? Date.now;
        this.queue = new CommandQueue({
            send: (unitId, request) => options.client.controlAta(unitId, request),
            getUnit: unitId => this.units.get(unitId),
            onAccepted: (unitId, request) => this.onAccepted(unitId, request),
            onFailed: (unitId, request) => this.onFailed(unitId, request),
            onBatchDone: () => options.requestRefresh(),
            scheduler: options.scheduler,
            sleep: options.sleep,
            log: options.log,
            debounceMs: options.debounceMs,
            gapMs: options.gapMs,
        });
        this.timers = new OffTimers({
            scheduler: options.scheduler,
            log: options.log,
            now: this.now,
            nameOf: unitId => this.units.get(unitId)?.name ?? unitId,
            onExpire: unitId => this.switchOffByTimer(unitId),
            onUpdate: (unitId, remaining, end) => this.writeTimer(unitId, remaining, end),
        });
    }

    /** Known units for the instance settings (id and room name) */
    public listUnits(): { id: string; name: string }[] {
        return [...this.units.values()].map(unit => ({ id: unit.id, name: unit.name }));
    }

    /** Restores persisted off timers (call once at startup) */
    public async restoreTimers(): Promise<void> {
        const states = await this.port.getStates(`${ROOT}.*.control.offTimerEnd`);
        for (const [fullId, state] of Object.entries(states)) {
            const end = Number(state?.val ?? 0);
            const match = new RegExp(
                `^${escapeRegExp(this.port.namespace)}\\.${ROOT}\\.([^.]+)\\.control\\.offTimerEnd$`,
            ).exec(fullId);
            if (!match || !(end > 0)) {
                continue;
            }
            const object = await this.port.getObject(`${ROOT}.${match[1]}`);
            const unitId = typeof object?.native?.unitId === 'string' ? object.native.unitId : match[1];
            this.keys.set(match[1], unitId);
            await this.timers.restore(unitId, end);
        }
    }

    /** Stops timers and drops pending commands */
    public stop(): void {
        this.queue.stop();
        this.timers.stop();
        this.swingWishes.clear();
    }

    /**
     * Processes a fresh /context.
     *
     * @param context - Parsed context
     */
    public async update(context: UserContext): Promise<void> {
        const seen = new Set<string>();
        for (const unit of context.ataUnits) {
            seen.add(unit.id);
            this.units.set(unit.id, unit);
            try {
                this.checkSwingWish(unit);
                await this.ensureObjects(unit);
                await this.writeUnit(unit);
            } catch (error) {
                this.log.error(`Updating unit ${unit.name} failed: ${describeError(error)}`);
            }
        }
        for (const [unitId, unit] of this.units) {
            if (!seen.has(unitId)) {
                if (!this.missingLogged.has(unitId)) {
                    this.missingLogged.add(unitId);
                    this.log.info(`Unit ${unit.name} is no longer part of the MELCloud Home account`);
                }
                await this.write(`${this.base(unitId)}.info.deviceOnline`, false);
            } else {
                this.missingLogged.delete(unitId);
            }
        }
    }

    /**
     * Handles a state change with ack=false below devices.*.control.
     *
     * @param id - Full state id
     * @param state - New state
     */
    public async handleCommand(id: string, state: ioBroker.State): Promise<void> {
        const prefix = `${this.port.namespace}.${ROOT}.`;
        if (!id.startsWith(prefix) || state.ack) {
            return;
        }
        const [key, channel, field] = id.slice(prefix.length).split('.');
        const unitId = this.keys.get(key);
        const unit = unitId ? this.units.get(unitId) : undefined;
        if (channel !== 'control' || !unitId) {
            return;
        }
        const relative = `${ROOT}.${key}.control.${field}`;
        // a user write makes the cached ack value obsolete
        this.written.delete(relative);

        if (field === 'offTimer') {
            await this.handleOffTimer(unitId, relative, state.val);
            return;
        }
        if (!unit) {
            this.log.warn(`Command ${field} ignored - unit state not known yet`);
            return;
        }
        const request = this.toRequest(unit, field, state.val);
        if (!request) {
            await this.restore(unit, field as ControlField);
            return;
        }
        this.trackSwingWish(unit, request);
        // keep the user's value visible while the command waits in the queue
        const until = this.now() + OPTIMISTIC_GUARD_MS;
        for (const [guardField, value] of Object.entries(fieldsOfRequest(request))) {
            this.guards.set(`${unitId}.${guardField}`, { value, until, pending: true });
        }
        this.queue.enqueue(unitId, request);
    }

    /**
     * @param unitId - Unit UUID
     * @param hourly - Hourly energy values
     */
    public async onEnergy(unitId: string, hourly: HourlyEnergy): Promise<void> {
        const base = this.base(unitId);
        let data = this.energy.get(unitId);
        if (!data) {
            const object = await this.port.getObject(base);
            const total = Number((await this.port.getState(`${base}.energy.total`))?.val ?? 0);
            data = restoreEnergyTrackerData(object?.native?.energyTracker, Number.isFinite(total) ? total : 0);
            this.energy.set(unitId, data);
        }
        const now = this.now();
        const values = applyEnergy(data, hourly, now, startOfLocalDay(now));
        await this.port.extendObject(base, { native: { energyTracker: data } });
        await this.write(`${base}.energy.total`, values.totalKwh);
        await this.write(`${base}.energy.today`, values.todayKwh);
        if (values.lastHourKwh !== null) {
            await this.write(`${base}.energy.lastHour`, values.lastHourKwh);
        }
    }

    /**
     * @param unitId - Unit UUID
     * @param reading - Wi-Fi signal
     */
    public async onWifiSignal(unitId: string, reading: Reading): Promise<void> {
        await this.write(`${this.base(unitId)}.info.wifiSignal`, reading.value);
    }

    /**
     * @param unitId - Unit UUID
     * @param reading - Outdoor temperature
     */
    public async onOutdoorTemperature(unitId: string, reading: Reading): Promise<void> {
        await this.write(`${this.base(unitId)}.info.outdoorTemp`, reading.value);
        await this.write(`${this.base(unitId)}.info.outdoorTempTime`, reading.time);
    }

    /**
     * Relative object id of a unit.
     *
     * @param unitId - Unit UUID
     */
    private base(unitId: string): string {
        const key = this.port.sanitizeId(unitId);
        this.keys.set(key, unitId);
        return `${ROOT}.${key}`;
    }

    private async ensureObjects(unit: AtaUnit): Promise<void> {
        const signature = JSON.stringify([unit.name, unit.capabilities]);
        if (this.objectSignatures.get(unit.id) === signature) {
            return;
        }
        const base = this.base(unit.id);
        for (const { id, obj } of buildUnitObjects(base, unit, this.port.namespace)) {
            await this.port.extendObject(id, obj);
        }
        if (!this.objectSignatures.has(unit.id)) {
            this.log.debug(`Objects of unit ${unit.name} created/updated`);
        }
        this.objectSignatures.set(unit.id, signature);
    }

    private async writeUnit(unit: AtaUnit): Promise<void> {
        const base = this.base(unit.id);
        const caps = unit.capabilities;
        const now = this.now();

        await this.write(`${base}.info.name`, unit.name);
        await this.write(`${base}.info.building`, unit.buildingName);
        await this.write(`${base}.info.isGuest`, unit.isGuest);
        await this.write(`${base}.info.deviceOnline`, unit.isConnected);
        await this.write(`${base}.info.hasError`, unit.isInError);
        await this.write(`${base}.info.errorCode`, unit.errorCode);
        await this.write(`${base}.info.icon`, roomIcon(this.options.roomIcons?.[unit.id]));
        await this.write(`${base}.info.roomTemp`, unit.roomTemperature);
        await this.write(`${base}.info.actualFanSpeed`, toCode(ACTUAL_FAN_SPEED_CODES, unit.actualFanSpeed));
        await this.write(`${base}.info.lastUpdate`, now);

        const fields: ControlField[] = [
            'power',
            'mode',
            'targetTemp',
            'fanSpeed',
            'vaneVerticalDirection',
            'vaneHorizontalDirection',
        ];
        if (caps.hasStandby) {
            fields.push('standby');
        }
        for (const field of fields) {
            if (this.guards.get(`${unit.id}.${field}`)?.pending) {
                // command not sent yet - do not acknowledge anything for this field
                continue;
            }
            await this.write(`${base}.control.${field}`, this.guarded(unit.id, field, controlValue(unit, field), now));
        }

        await this.write(`${base}.capabilities.minTempHeat`, caps.minTempHeat);
        await this.write(`${base}.capabilities.maxTempHeat`, caps.maxTempHeat);
        await this.write(`${base}.capabilities.minTempCoolDry`, caps.minTempCoolDry);
        await this.write(`${base}.capabilities.maxTempCoolDry`, caps.maxTempCoolDry);
        await this.write(`${base}.capabilities.minTempAuto`, caps.minTempAutomatic);
        await this.write(`${base}.capabilities.maxTempAuto`, caps.maxTempAutomatic);
        await this.write(`${base}.capabilities.tempStep`, caps.hasHalfDegreeIncrements ? 0.5 : 1);
        await this.write(`${base}.capabilities.fanSpeeds`, caps.numberOfFanSpeeds);
        await this.write(`${base}.capabilities.modes`, JSON.stringify(Object.keys(modeStates(caps)).map(Number)));
        await this.write(`${base}.capabilities.hasSwing`, caps.hasSwing);
        await this.write(`${base}.capabilities.hasAirDirection`, caps.hasAirDirection);
        await this.write(`${base}.capabilities.supportsWideVane`, caps.supportsWideVane);
        await this.write(`${base}.capabilities.hasStandby`, caps.hasStandby);
        await this.write(`${base}.capabilities.hasEnergyMeter`, caps.hasEnergyConsumedMeter);
        await this.write(`${base}.capabilities.isMultiSplit`, caps.isMultiSplitSystem);
    }

    /**
     * Returns the optimistic value while its guard is active and the cloud still reports something else.
     *
     * @param unitId - Unit UUID
     * @param field - Control field
     * @param reported - Value from /context
     * @param now - Current time
     */
    private guarded(
        unitId: string,
        field: ControlField,
        reported: ioBroker.StateValue,
        now: number,
    ): ioBroker.StateValue {
        const key = `${unitId}.${field}`;
        const guard = this.guards.get(key);
        if (!guard) {
            return reported;
        }
        if (guard.value === reported || now >= guard.until) {
            this.guards.delete(key);
            return reported;
        }
        return guard.value;
    }

    /**
     * Validates a user value and converts it into a control request.
     *
     * @param unit - Unit state
     * @param field - Control field
     * @param value - Value written by the user
     */
    private toRequest(unit: AtaUnit, field: string, value: ioBroker.StateValue): AtaControlRequest | undefined {
        const caps = unit.capabilities;
        const reject = (reason: string): undefined => {
            this.log.warn(`Command for ${unit.name} rejected: ${reason}`);
            return undefined;
        };
        switch (field) {
            case 'power':
                return typeof value === 'boolean' ? { power: value } : reject(`power must be true or false`);
            case 'standby':
                if (!caps.hasStandby) {
                    return reject('the unit has no standby mode');
                }
                return typeof value === 'boolean' ? { inStandbyMode: value } : reject('standby must be true or false');
            case 'mode': {
                const mode = fromCode(MODE_CODES, value);
                return mode && isAllowedCode(modeStates(caps), value)
                    ? { operationMode: mode }
                    : reject(`mode ${String(value)} is not supported`);
            }
            case 'fanSpeed': {
                const speed = fromCode(FAN_SPEED_CODES, value);
                return speed && isAllowedCode(fanSpeedStates(caps), value)
                    ? { setFanSpeed: speed }
                    : reject(`fan speed ${String(value)} is not supported`);
            }
            case 'vaneVerticalDirection': {
                const direction = fromCode(VANE_VERTICAL_CODES, value);
                if (!caps.hasAirDirection) {
                    return reject('the vertical vane is not adjustable');
                }
                return direction && isAllowedCode(vaneStates(VANE_VERTICAL_CODES, caps), value)
                    ? { vaneVerticalDirection: direction }
                    : reject(`vertical vane ${String(value)} is not supported`);
            }
            case 'vaneHorizontalDirection': {
                const direction = fromCode(VANE_HORIZONTAL_CODES, value);
                if (!caps.supportsWideVane) {
                    return reject('the horizontal vane of this unit is not adjustable');
                }
                return direction && isAllowedCode(vaneStates(VANE_HORIZONTAL_CODES, caps), value)
                    ? { vaneHorizontalDirection: direction }
                    : reject(`horizontal vane ${String(value)} is not supported`);
            }
            case 'targetTemp': {
                const temperature = typeof value === 'string' ? Number(value) : value;
                return typeof temperature === 'number' && Number.isFinite(temperature)
                    ? { setTemperature: temperature }
                    : reject('target temperature must be a number');
            }
            default:
                return reject(`${field} is read-only`);
        }
    }

    private async onAccepted(unitId: string, request: AtaControlRequest): Promise<void> {
        const base = this.base(unitId);
        const until = this.now() + OPTIMISTIC_GUARD_MS;
        for (const [field, value] of Object.entries(fieldsOfRequest(request))) {
            this.guards.set(`${unitId}.${field}`, { value, until, pending: false });
            await this.write(`${base}.control.${field}`, value, true);
        }
    }

    private async onFailed(unitId: string, request: AtaControlRequest): Promise<void> {
        const unit = this.units.get(unitId);
        if (!unit) {
            return;
        }
        for (const field of Object.keys(VANE_AXES) as VaneField[]) {
            if (request[field] !== undefined) {
                this.swingWishes.delete(`${unitId}.${field}`);
            }
        }
        for (const field of Object.keys(fieldsOfRequest(request)) as ControlField[]) {
            this.guards.delete(`${unitId}.${field}`);
            await this.restore(unit, field);
        }
    }

    /**
     * Remembers a swing or auto request per vane, any fixed position of that vane cancels it.
     *
     * @param unit - Unit state before the request
     * @param request - Control request of the user
     */
    private trackSwingWish(unit: AtaUnit, request: AtaControlRequest): void {
        for (const field of Object.keys(VANE_AXES) as VaneField[]) {
            const key = `${unit.id}.${field}`;
            if (request[field] === undefined) {
                continue;
            }
            const value = request[field];
            if (value !== 'Swing' && value !== 'Auto') {
                this.swingWishes.delete(key);
                continue;
            }
            this.swingWishes.set(key, {
                value,
                code: value === 'Swing' ? VANE_AXES[field].swing : VANE_AUTO,
                before: controlValue(unit, field),
                until: this.now() + SWING_RETRY_WINDOW_MS,
                retries: 0,
                stored: false,
            });
        }
    }

    /**
     * Repeats a swing or auto the unit did not apply: the cloud showed it, then the unit
     * reported its old fixed position again (docs/api.md section 9.1).
     *
     * @param unit - Unit state from /context
     */
    private checkSwingWish(unit: AtaUnit): void {
        for (const field of Object.keys(VANE_AXES) as VaneField[]) {
            this.checkSwingWishOf(unit, field);
        }
    }

    private checkSwingWishOf(unit: AtaUnit, field: VaneField): void {
        const key = `${unit.id}.${field}`;
        const wish = this.swingWishes.get(key);
        if (!wish) {
            return;
        }
        const axis = VANE_AXES[field];
        const what = wish.value.toLowerCase();
        if (this.now() >= wish.until) {
            this.swingWishes.delete(key);
            return;
        }
        const reported = controlValue(unit, field);
        if (reported === wish.code) {
            wish.stored = true;
            return;
        }
        if (!wish.stored || !isFixedPosition(reported)) {
            return;
        }
        if (isFixedPosition(wish.before) && reported !== wish.before) {
            // another position was chosen in the meantime (e.g. in the official app)
            this.swingWishes.delete(key);
            return;
        }
        if (wish.retries >= SWING_RETRY_MAX) {
            this.swingWishes.delete(key);
            this.log.info(`${unit.name}: the unit did not apply the ${axis.label} vane ${what} - giving up`);
            return;
        }
        wish.retries++;
        wish.stored = false;
        this.log.info(
            `${unit.name}: the unit still reports ${axis.label} vane position ${unit[field]} - ` +
                `sending ${what} again (${wish.retries}/${SWING_RETRY_MAX})`,
        );
        this.guards.set(`${unit.id}.${field}`, {
            value: wish.code,
            until: this.now() + OPTIMISTIC_GUARD_MS,
            pending: true,
        });
        this.queue.enqueue(unit.id, { [field]: wish.value });
    }

    /**
     * Writes the last known value back (with ack) after a rejected or failed command.
     *
     * @param unit - Unit state
     * @param field - Control field
     */
    private async restore(unit: AtaUnit, field: ControlField): Promise<void> {
        const value = (controlValue as (u: AtaUnit, f: string) => ioBroker.StateValue | undefined)(unit, field);
        if (value !== undefined) {
            await this.write(`${this.base(unit.id)}.control.${field}`, value, true);
        }
    }

    private async handleOffTimer(unitId: string, relative: string, value: ioBroker.StateValue): Promise<void> {
        const minutes = typeof value === 'string' ? Number(value) : value;
        if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
            this.log.warn(
                `Off timer value ${String(value)} rejected - use minutes between 0 and ${MAX_OFF_TIMER_MINUTES}`,
            );
            await this.write(relative, Math.ceil(this.timers.remaining(unitId) / 60), true);
            return;
        }
        const effective = await this.timers.set(unitId, minutes);
        await this.write(relative, effective, true);
        if (effective > 0) {
            this.log.info(`Off timer of ${this.units.get(unitId)?.name ?? unitId} set to ${effective} min`);
        }
    }

    private async writeTimer(unitId: string, remainingSeconds: number, endTime: number): Promise<void> {
        const base = this.base(unitId);
        await this.write(`${base}.control.offTimerRemaining`, remainingSeconds);
        await this.write(`${base}.control.offTimerEnd`, endTime);
        if (endTime === 0) {
            await this.write(`${base}.control.offTimer`, 0);
        }
    }

    private switchOffByTimer(unitId: string): void {
        this.queue.enqueue(unitId, { power: false });
    }

    /**
     * Writes a state with ack=true if the value changed (or always with force).
     *
     * @param id - Relative state id
     * @param value - Value
     * @param force - Write even if unchanged (confirmation of a command)
     */
    private async write(id: string, value: ioBroker.StateValue, force = false): Promise<void> {
        if (!force && this.written.has(id) && this.written.get(id) === value) {
            return;
        }
        this.written.set(id, value);
        await this.port.setState(id, value, true);
    }
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
