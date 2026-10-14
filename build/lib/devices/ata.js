"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var ata_exports = {};
__export(ata_exports, {
  AtaDevices: () => AtaDevices,
  OPTIMISTIC_GUARD_MS: () => OPTIMISTIC_GUARD_MS,
  SWING_RETRY_MAX: () => SWING_RETRY_MAX,
  SWING_RETRY_WINDOW_MS: () => SWING_RETRY_WINDOW_MS,
  buildUnitObjects: () => buildUnitObjects
});
module.exports = __toCommonJS(ata_exports);
var import_errors = require("../api/errors");
var import_mapping = require("../mapping");
var import_commands = require("./commands");
var import_energy = require("./energy");
var import_off_timer = require("./off-timer");
const OPTIMISTIC_GUARD_MS = 12e4;
const SWING_RETRY_WINDOW_MS = 30 * 6e4;
const SWING_RETRY_MAX = 3;
const HORIZONTAL_SWING = 12;
function isFixedHorizontalPosition(code) {
  return typeof code === "number" && code >= 1 && code <= 5;
}
const ROOT = "devices";
const name = (en, de) => ({ en, de });
function controlValue(unit, field) {
  switch (field) {
    case "power":
      return unit.power;
    case "mode":
      return (0, import_mapping.toCode)(import_mapping.MODE_CODES, unit.operationMode);
    case "targetTemp":
      return unit.setTemperature;
    case "fanSpeed":
      return (0, import_mapping.toCode)(import_mapping.FAN_SPEED_CODES, unit.setFanSpeed);
    case "vaneVerticalDirection":
      return (0, import_mapping.toCode)(import_mapping.VANE_VERTICAL_CODES, unit.vaneVerticalDirection);
    case "vaneHorizontalDirection":
      return (0, import_mapping.toCode)(import_mapping.VANE_HORIZONTAL_CODES, unit.vaneHorizontalDirection);
    case "standby":
      return unit.inStandbyMode;
  }
}
function fieldsOfRequest(request) {
  const fields = {};
  if (request.power !== void 0) {
    fields.power = request.power;
  }
  if (request.operationMode !== void 0) {
    fields.mode = (0, import_mapping.toCode)(import_mapping.MODE_CODES, request.operationMode);
  }
  if (request.setTemperature !== void 0) {
    fields.targetTemp = request.setTemperature;
  }
  if (request.setFanSpeed !== void 0) {
    fields.fanSpeed = (0, import_mapping.toCode)(import_mapping.FAN_SPEED_CODES, request.setFanSpeed);
  }
  if (request.vaneVerticalDirection !== void 0) {
    fields.vaneVerticalDirection = (0, import_mapping.toCode)(import_mapping.VANE_VERTICAL_CODES, request.vaneVerticalDirection);
  }
  if (request.vaneHorizontalDirection !== void 0) {
    fields.vaneHorizontalDirection = (0, import_mapping.toCode)(import_mapping.VANE_HORIZONTAL_CODES, request.vaneHorizontalDirection);
  }
  if (request.inStandbyMode !== void 0) {
    fields.standby = request.inStandbyMode;
  }
  return fields;
}
function buildUnitObjects(base, unit, namespace) {
  const caps = unit.capabilities;
  const temp = (0, import_mapping.overallTemperatureLimits)(caps);
  const objects = [];
  const channel = (id, channelName) => {
    objects.push({ id: `${base}.${id}`, obj: { type: "channel", common: { name: channelName }, native: {} } });
  };
  const state = (id, common) => {
    objects.push({
      id: `${base}.${id}`,
      obj: { type: "state", common: { read: true, write: false, ...common }, native: {} }
    });
  };
  objects.push({
    id: base,
    obj: {
      type: "device",
      common: {
        name: unit.name,
        statusStates: {
          onlineId: `${namespace}.${base}.info.deviceOnline`,
          errorId: `${namespace}.${base}.info.hasError`
        }
      },
      native: { unitId: unit.id }
    }
  });
  channel("info", name("Information", "Information"));
  state("info.name", { name: name("Room name", "Raumname"), type: "string", role: "info.name" });
  state("info.building", { name: name("Building", "Geb\xE4ude"), type: "string", role: "text" });
  state("info.isGuest", { name: name("Shared building", "Geteiltes Geb\xE4ude"), type: "boolean", role: "indicator" });
  state("info.deviceOnline", {
    name: name("Unit reachable", "Ger\xE4t erreichbar"),
    type: "boolean",
    role: "indicator.reachable"
  });
  state("info.hasError", {
    name: name("Unit reports an error", "Ger\xE4t meldet St\xF6rung"),
    type: "boolean",
    role: "indicator.maintenance.alarm"
  });
  state("info.errorCode", { name: name("Error code", "Fehlercode"), type: "string", role: "text" });
  state("info.roomTemp", {
    name: name("Room temperature", "Raumtemperatur"),
    type: "number",
    role: "value.temperature",
    unit: "\xB0C"
  });
  state("info.outdoorTemp", {
    name: name("Outdoor temperature", "Au\xDFentemperatur"),
    type: "number",
    role: "value.temperature",
    unit: "\xB0C"
  });
  state("info.outdoorTempTime", {
    name: name("Time of the outdoor temperature reading", "Zeitpunkt der Au\xDFentemperatur"),
    type: "number",
    role: "value.time"
  });
  state("info.actualFanSpeed", {
    name: name("Actual fan speed", "Aktuelle L\xFCfterstufe"),
    type: "number",
    role: "value",
    states: (0, import_mapping.actualFanSpeedStates)()
  });
  state("info.wifiSignal", {
    name: name("Wi-Fi signal", "WLAN-Signal"),
    type: "number",
    role: "value",
    unit: "dBm"
  });
  state("info.lastUpdate", {
    name: name("Last update from the cloud", "Letzte Aktualisierung aus der Cloud"),
    type: "number",
    role: "value.time"
  });
  channel("control", name("Control", "Steuerung"));
  state("control.power", { name: name("Power", "Ein/Aus"), type: "boolean", role: "switch.power", write: true });
  state("control.mode", {
    name: name("Operation mode", "Betriebsmodus"),
    type: "number",
    role: "level.mode.airconditioner",
    write: true,
    states: (0, import_mapping.modeStates)(caps)
  });
  state("control.targetTemp", {
    name: name("Target temperature", "Solltemperatur"),
    type: "number",
    role: "level.temperature",
    write: true,
    unit: "\xB0C",
    min: temp.min,
    max: temp.max,
    step: temp.step
  });
  state("control.fanSpeed", {
    name: name("Fan speed", "L\xFCfterstufe"),
    type: "number",
    role: "level.mode.fan",
    write: true,
    states: (0, import_mapping.fanSpeedStates)(caps)
  });
  state("control.vaneVerticalDirection", {
    name: name("Vertical vane", "Lamelle vertikal (H\xF6he)"),
    type: "number",
    role: "level.mode.swing",
    write: caps.hasAirDirection,
    states: (0, import_mapping.vaneStates)(import_mapping.VANE_VERTICAL_CODES, caps)
  });
  state("control.vaneHorizontalDirection", {
    name: name("Horizontal vane", "Lamelle horizontal (Seite)"),
    type: "number",
    role: "level.mode.swing",
    write: caps.supportsWideVane,
    states: (0, import_mapping.vaneStates)(import_mapping.VANE_HORIZONTAL_CODES, caps)
  });
  if (caps.hasStandby) {
    state("control.standby", { name: name("Standby", "Standby"), type: "boolean", role: "switch", write: true });
  }
  state("control.offTimer", {
    name: name("Switch off in (0 = no timer)", "Ausschalten in (0 = kein Timer)"),
    type: "number",
    role: "level.timer",
    write: true,
    unit: "min",
    min: 0,
    max: import_off_timer.MAX_OFF_TIMER_MINUTES,
    def: 0
  });
  state("control.offTimerRemaining", {
    name: name("Off timer remaining", "Restzeit Abschalt-Timer"),
    type: "number",
    role: "value.interval",
    unit: "s",
    def: 0
  });
  state("control.offTimerEnd", {
    name: name("Off timer end", "Ende Abschalt-Timer"),
    type: "number",
    role: "date.end",
    def: 0
  });
  if (caps.hasEnergyConsumedMeter) {
    channel("energy", name("Energy", "Energie"));
    state("energy.total", {
      name: name("Energy consumed (counter)", "Energieverbrauch (Z\xE4hler)"),
      type: "number",
      role: "value.energy.consumed",
      unit: "kWh"
    });
    state("energy.lastHour", {
      name: name("Energy of the latest hour", "Energie der letzten Stunde"),
      type: "number",
      role: "value.energy",
      unit: "kWh"
    });
    state("energy.today", {
      name: name("Energy today", "Energie heute"),
      type: "number",
      role: "value.energy",
      unit: "kWh"
    });
  }
  channel("capabilities", name("Capabilities", "F\xE4higkeiten"));
  const capNumber = (id, label, unitText) => state(`capabilities.${id}`, { name: label, type: "number", role: "value", unit: unitText });
  const capFlag = (id, label) => state(`capabilities.${id}`, { name: label, type: "boolean", role: "indicator" });
  capNumber("minTempHeat", name("Min. temperature heat", "Min. Temperatur Heizen"), "\xB0C");
  capNumber("maxTempHeat", name("Max. temperature heat", "Max. Temperatur Heizen"), "\xB0C");
  capNumber("minTempCoolDry", name("Min. temperature cool/dry", "Min. Temperatur K\xFChlen/Trocknen"), "\xB0C");
  capNumber("maxTempCoolDry", name("Max. temperature cool/dry", "Max. Temperatur K\xFChlen/Trocknen"), "\xB0C");
  capNumber("minTempAuto", name("Min. temperature auto", "Min. Temperatur Auto"), "\xB0C");
  capNumber("maxTempAuto", name("Max. temperature auto", "Max. Temperatur Auto"), "\xB0C");
  capNumber("tempStep", name("Temperature step", "Temperatur-Schrittweite"), "\xB0C");
  capNumber("fanSpeeds", name("Number of fan speeds", "Anzahl L\xFCfterstufen"));
  state("capabilities.modes", { name: name("Available modes", "Verf\xFCgbare Modi"), type: "string", role: "json" });
  capFlag("hasSwing", name("Swing available", "Swing verf\xFCgbar"));
  capFlag("hasAirDirection", name("Vertical vane adjustable", "Lamelle vertikal verstellbar"));
  capFlag("supportsWideVane", name("Horizontal vane adjustable", "Lamelle horizontal verstellbar"));
  capFlag("hasStandby", name("Standby available", "Standby verf\xFCgbar"));
  capFlag("hasEnergyMeter", name("Energy meter available", "Energiez\xE4hler verf\xFCgbar"));
  capFlag("isMultiSplit", name("Multi-split system", "Multi-Split-System"));
  return objects;
}
class AtaDevices {
  options;
  port;
  log;
  now;
  units = /* @__PURE__ */ new Map();
  /** object key (sanitised) -> unit id */
  keys = /* @__PURE__ */ new Map();
  /** unit id -> signature of the created objects */
  objectSignatures = /* @__PURE__ */ new Map();
  /** relative state id -> last value written with ack */
  written = /* @__PURE__ */ new Map();
  /** unitId.field -> optimistic value */
  guards = /* @__PURE__ */ new Map();
  energy = /* @__PURE__ */ new Map();
  queue;
  timers;
  missingLogged = /* @__PURE__ */ new Set();
  /** unit id -> requested horizontal swing */
  swingWishes = /* @__PURE__ */ new Map();
  /** @param options - Dependencies */
  constructor(options) {
    var _a;
    this.options = options;
    this.port = options.port;
    this.log = options.log;
    this.now = (_a = options.now) != null ? _a : Date.now;
    this.queue = new import_commands.CommandQueue({
      send: (unitId, request) => options.client.controlAta(unitId, request),
      getUnit: (unitId) => this.units.get(unitId),
      onAccepted: (unitId, request) => this.onAccepted(unitId, request),
      onFailed: (unitId, request) => this.onFailed(unitId, request),
      onBatchDone: () => options.requestRefresh(),
      scheduler: options.scheduler,
      sleep: options.sleep,
      log: options.log,
      debounceMs: options.debounceMs,
      gapMs: options.gapMs
    });
    this.timers = new import_off_timer.OffTimers({
      scheduler: options.scheduler,
      log: options.log,
      now: this.now,
      nameOf: (unitId) => {
        var _a2, _b;
        return (_b = (_a2 = this.units.get(unitId)) == null ? void 0 : _a2.name) != null ? _b : unitId;
      },
      onExpire: (unitId) => this.switchOffByTimer(unitId),
      onUpdate: (unitId, remaining, end) => this.writeTimer(unitId, remaining, end)
    });
  }
  /** Restores persisted off timers (call once at startup) */
  async restoreTimers() {
    var _a, _b;
    const states = await this.port.getStates(`${ROOT}.*.control.offTimerEnd`);
    for (const [fullId, state] of Object.entries(states)) {
      const end = Number((_a = state == null ? void 0 : state.val) != null ? _a : 0);
      const match = new RegExp(
        `^${escapeRegExp(this.port.namespace)}\\.${ROOT}\\.([^.]+)\\.control\\.offTimerEnd$`
      ).exec(fullId);
      if (!match || !(end > 0)) {
        continue;
      }
      const object = await this.port.getObject(`${ROOT}.${match[1]}`);
      const unitId = typeof ((_b = object == null ? void 0 : object.native) == null ? void 0 : _b.unitId) === "string" ? object.native.unitId : match[1];
      this.keys.set(match[1], unitId);
      await this.timers.restore(unitId, end);
    }
  }
  /** Stops timers and drops pending commands */
  stop() {
    this.queue.stop();
    this.timers.stop();
    this.swingWishes.clear();
  }
  /**
   * Processes a fresh /context.
   *
   * @param context - Parsed context
   */
  async update(context) {
    const seen = /* @__PURE__ */ new Set();
    for (const unit of context.ataUnits) {
      seen.add(unit.id);
      this.units.set(unit.id, unit);
      try {
        this.checkSwingWish(unit);
        await this.ensureObjects(unit);
        await this.writeUnit(unit);
      } catch (error) {
        this.log.error(`Updating unit ${unit.name} failed: ${(0, import_errors.describeError)(error)}`);
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
  async handleCommand(id, state) {
    const prefix = `${this.port.namespace}.${ROOT}.`;
    if (!id.startsWith(prefix) || state.ack) {
      return;
    }
    const [key, channel, field] = id.slice(prefix.length).split(".");
    const unitId = this.keys.get(key);
    const unit = unitId ? this.units.get(unitId) : void 0;
    if (channel !== "control" || !unitId) {
      return;
    }
    const relative = `${ROOT}.${key}.control.${field}`;
    this.written.delete(relative);
    if (field === "offTimer") {
      await this.handleOffTimer(unitId, relative, state.val);
      return;
    }
    if (!unit) {
      this.log.warn(`Command ${field} ignored - unit state not known yet`);
      return;
    }
    const request = this.toRequest(unit, field, state.val);
    if (!request) {
      await this.restore(unit, field);
      return;
    }
    if (request.vaneHorizontalDirection !== void 0) {
      this.trackSwingWish(unit, request);
    }
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
  async onEnergy(unitId, hourly) {
    var _a, _b, _c;
    const base = this.base(unitId);
    let data = this.energy.get(unitId);
    if (!data) {
      const object = await this.port.getObject(base);
      const total = Number((_b = (_a = await this.port.getState(`${base}.energy.total`)) == null ? void 0 : _a.val) != null ? _b : 0);
      data = (0, import_energy.restoreEnergyTrackerData)((_c = object == null ? void 0 : object.native) == null ? void 0 : _c.energyTracker, Number.isFinite(total) ? total : 0);
      this.energy.set(unitId, data);
    }
    const now = this.now();
    const values = (0, import_energy.applyEnergy)(data, hourly, now, (0, import_energy.startOfLocalDay)(now));
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
  async onWifiSignal(unitId, reading) {
    await this.write(`${this.base(unitId)}.info.wifiSignal`, reading.value);
  }
  /**
   * @param unitId - Unit UUID
   * @param reading - Outdoor temperature
   */
  async onOutdoorTemperature(unitId, reading) {
    await this.write(`${this.base(unitId)}.info.outdoorTemp`, reading.value);
    await this.write(`${this.base(unitId)}.info.outdoorTempTime`, reading.time);
  }
  /**
   * Relative object id of a unit.
   *
   * @param unitId - Unit UUID
   */
  base(unitId) {
    const key = this.port.sanitizeId(unitId);
    this.keys.set(key, unitId);
    return `${ROOT}.${key}`;
  }
  async ensureObjects(unit) {
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
  async writeUnit(unit) {
    var _a;
    const base = this.base(unit.id);
    const caps = unit.capabilities;
    const now = this.now();
    await this.write(`${base}.info.name`, unit.name);
    await this.write(`${base}.info.building`, unit.buildingName);
    await this.write(`${base}.info.isGuest`, unit.isGuest);
    await this.write(`${base}.info.deviceOnline`, unit.isConnected);
    await this.write(`${base}.info.hasError`, unit.isInError);
    await this.write(`${base}.info.errorCode`, unit.errorCode);
    await this.write(`${base}.info.roomTemp`, unit.roomTemperature);
    await this.write(`${base}.info.actualFanSpeed`, (0, import_mapping.toCode)(import_mapping.ACTUAL_FAN_SPEED_CODES, unit.actualFanSpeed));
    await this.write(`${base}.info.lastUpdate`, now);
    const fields = [
      "power",
      "mode",
      "targetTemp",
      "fanSpeed",
      "vaneVerticalDirection",
      "vaneHorizontalDirection"
    ];
    if (caps.hasStandby) {
      fields.push("standby");
    }
    for (const field of fields) {
      if ((_a = this.guards.get(`${unit.id}.${field}`)) == null ? void 0 : _a.pending) {
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
    await this.write(`${base}.capabilities.modes`, JSON.stringify(Object.keys((0, import_mapping.modeStates)(caps)).map(Number)));
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
  guarded(unitId, field, reported, now) {
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
  toRequest(unit, field, value) {
    const caps = unit.capabilities;
    const reject = (reason) => {
      this.log.warn(`Command for ${unit.name} rejected: ${reason}`);
      return void 0;
    };
    switch (field) {
      case "power":
        return typeof value === "boolean" ? { power: value } : reject(`power must be true or false`);
      case "standby":
        if (!caps.hasStandby) {
          return reject("the unit has no standby mode");
        }
        return typeof value === "boolean" ? { inStandbyMode: value } : reject("standby must be true or false");
      case "mode": {
        const mode = (0, import_mapping.fromCode)(import_mapping.MODE_CODES, value);
        return mode && (0, import_mapping.isAllowedCode)((0, import_mapping.modeStates)(caps), value) ? { operationMode: mode } : reject(`mode ${String(value)} is not supported`);
      }
      case "fanSpeed": {
        const speed = (0, import_mapping.fromCode)(import_mapping.FAN_SPEED_CODES, value);
        return speed && (0, import_mapping.isAllowedCode)((0, import_mapping.fanSpeedStates)(caps), value) ? { setFanSpeed: speed } : reject(`fan speed ${String(value)} is not supported`);
      }
      case "vaneVerticalDirection": {
        const direction = (0, import_mapping.fromCode)(import_mapping.VANE_VERTICAL_CODES, value);
        if (!caps.hasAirDirection) {
          return reject("the vertical vane is not adjustable");
        }
        return direction && (0, import_mapping.isAllowedCode)((0, import_mapping.vaneStates)(import_mapping.VANE_VERTICAL_CODES, caps), value) ? { vaneVerticalDirection: direction } : reject(`vertical vane ${String(value)} is not supported`);
      }
      case "vaneHorizontalDirection": {
        const direction = (0, import_mapping.fromCode)(import_mapping.VANE_HORIZONTAL_CODES, value);
        if (!caps.supportsWideVane) {
          return reject("the horizontal vane of this unit is not adjustable");
        }
        return direction && (0, import_mapping.isAllowedCode)((0, import_mapping.vaneStates)(import_mapping.VANE_HORIZONTAL_CODES, caps), value) ? { vaneHorizontalDirection: direction } : reject(`horizontal vane ${String(value)} is not supported`);
      }
      case "targetTemp": {
        const temperature = typeof value === "string" ? Number(value) : value;
        return typeof temperature === "number" && Number.isFinite(temperature) ? { setTemperature: temperature } : reject("target temperature must be a number");
      }
      default:
        return reject(`${field} is read-only`);
    }
  }
  async onAccepted(unitId, request) {
    const base = this.base(unitId);
    const until = this.now() + OPTIMISTIC_GUARD_MS;
    for (const [field, value] of Object.entries(fieldsOfRequest(request))) {
      this.guards.set(`${unitId}.${field}`, { value, until, pending: false });
      await this.write(`${base}.control.${field}`, value, true);
    }
  }
  async onFailed(unitId, request) {
    const unit = this.units.get(unitId);
    if (!unit) {
      return;
    }
    if (request.vaneHorizontalDirection !== void 0) {
      this.swingWishes.delete(unitId);
    }
    for (const field of Object.keys(fieldsOfRequest(request))) {
      this.guards.delete(`${unitId}.${field}`);
      await this.restore(unit, field);
    }
  }
  /**
   * Remembers a horizontal swing request, any other horizontal value cancels it.
   *
   * @param unit - Unit state before the request
   * @param request - Control request of the user
   */
  trackSwingWish(unit, request) {
    if (request.vaneHorizontalDirection !== "Swing") {
      this.swingWishes.delete(unit.id);
      return;
    }
    this.swingWishes.set(unit.id, {
      before: controlValue(unit, "vaneHorizontalDirection"),
      until: this.now() + SWING_RETRY_WINDOW_MS,
      retries: 0,
      stored: false
    });
  }
  /**
   * Repeats a horizontal swing the unit did not apply: the cloud showed "Swing", then the unit
   * reported its old fixed position again (docs/api.md section 9.1).
   *
   * @param unit - Unit state from /context
   */
  checkSwingWish(unit) {
    const wish = this.swingWishes.get(unit.id);
    if (!wish) {
      return;
    }
    if (this.now() >= wish.until) {
      this.swingWishes.delete(unit.id);
      return;
    }
    const reported = controlValue(unit, "vaneHorizontalDirection");
    if (reported === HORIZONTAL_SWING) {
      wish.stored = true;
      return;
    }
    if (!wish.stored || !isFixedHorizontalPosition(reported)) {
      return;
    }
    if (isFixedHorizontalPosition(wish.before) && reported !== wish.before) {
      this.swingWishes.delete(unit.id);
      return;
    }
    if (wish.retries >= SWING_RETRY_MAX) {
      this.swingWishes.delete(unit.id);
      this.log.info(`${unit.name}: the unit did not apply the horizontal swing - giving up`);
      return;
    }
    wish.retries++;
    wish.stored = false;
    this.log.info(
      `${unit.name}: the unit still reports horizontal vane position ${unit.vaneHorizontalDirection} - sending swing again (${wish.retries}/${SWING_RETRY_MAX})`
    );
    this.guards.set(`${unit.id}.vaneHorizontalDirection`, {
      value: HORIZONTAL_SWING,
      until: this.now() + OPTIMISTIC_GUARD_MS,
      pending: true
    });
    this.queue.enqueue(unit.id, { vaneHorizontalDirection: "Swing" });
  }
  /**
   * Writes the last known value back (with ack) after a rejected or failed command.
   *
   * @param unit - Unit state
   * @param field - Control field
   */
  async restore(unit, field) {
    const value = controlValue(unit, field);
    if (value !== void 0) {
      await this.write(`${this.base(unit.id)}.control.${field}`, value, true);
    }
  }
  async handleOffTimer(unitId, relative, value) {
    var _a, _b;
    const minutes = typeof value === "string" ? Number(value) : value;
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
      this.log.warn(
        `Off timer value ${String(value)} rejected - use minutes between 0 and ${import_off_timer.MAX_OFF_TIMER_MINUTES}`
      );
      await this.write(relative, Math.ceil(this.timers.remaining(unitId) / 60), true);
      return;
    }
    const effective = await this.timers.set(unitId, minutes);
    await this.write(relative, effective, true);
    if (effective > 0) {
      this.log.info(`Off timer of ${(_b = (_a = this.units.get(unitId)) == null ? void 0 : _a.name) != null ? _b : unitId} set to ${effective} min`);
    }
  }
  async writeTimer(unitId, remainingSeconds, endTime) {
    const base = this.base(unitId);
    await this.write(`${base}.control.offTimerRemaining`, remainingSeconds);
    await this.write(`${base}.control.offTimerEnd`, endTime);
    if (endTime === 0) {
      await this.write(`${base}.control.offTimer`, 0);
    }
  }
  switchOffByTimer(unitId) {
    this.queue.enqueue(unitId, { power: false });
  }
  /**
   * Writes a state with ack=true if the value changed (or always with force).
   *
   * @param id - Relative state id
   * @param value - Value
   * @param force - Write even if unchanged (confirmation of a command)
   */
  async write(id, value, force = false) {
    if (!force && this.written.has(id) && this.written.get(id) === value) {
      return;
    }
    this.written.set(id, value);
    await this.port.setState(id, value, true);
  }
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AtaDevices,
  OPTIMISTIC_GUARD_MS,
  SWING_RETRY_MAX,
  SWING_RETRY_WINDOW_MS,
  buildUnitObjects
});
//# sourceMappingURL=ata.js.map
