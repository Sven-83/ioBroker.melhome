"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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
var types_exports = {};
__export(types_exports, {
  ACTUAL_FAN_SPEEDS: () => ACTUAL_FAN_SPEEDS,
  DEFAULT_ATA_CAPABILITIES: () => DEFAULT_ATA_CAPABILITIES,
  FAN_SPEEDS: () => FAN_SPEEDS,
  OPERATION_MODES: () => OPERATION_MODES,
  VANE_HORIZONTAL_DIRECTIONS: () => VANE_HORIZONTAL_DIRECTIONS,
  VANE_VERTICAL_DIRECTIONS: () => VANE_VERTICAL_DIRECTIONS,
  buildAtaControlBody: () => buildAtaControlBody,
  parseApiTimestamp: () => parseApiTimestamp,
  parseAtaUnit: () => parseAtaUnit,
  parseBool: () => parseBool,
  parseCapabilities: () => parseCapabilities,
  parseHourlyEnergy: () => parseHourlyEnergy,
  parseNumber: () => parseNumber,
  parseOutdoorTemperature: () => parseOutdoorTemperature,
  parseRssi: () => parseRssi,
  parseUserContext: () => parseUserContext
});
module.exports = __toCommonJS(types_exports);
var import_errors = require("./errors");
const OPERATION_MODES = ["Heat", "Cool", "Automatic", "Dry", "Fan"];
const FAN_SPEEDS = ["Auto", "One", "Two", "Three", "Four", "Five"];
const ACTUAL_FAN_SPEEDS = ["Off", "One", "Two", "Three", "Four", "Five"];
const VANE_VERTICAL_DIRECTIONS = ["Auto", "Swing", "One", "Two", "Three", "Four", "Five"];
const VANE_HORIZONTAL_DIRECTIONS = [
  "Auto",
  "Swing",
  "Left",
  "LeftCentre",
  "Centre",
  "RightCentre",
  "Right"
];
const NUMERIC_TO_WORD = {
  0: "Auto",
  1: "One",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five"
};
const VANE_VERTICAL_NUMERIC = { ...NUMERIC_TO_WORD, 7: "Swing" };
const VANE_HORIZONTAL_AMERICAN = {
  Center: "Centre",
  CenterLeft: "LeftCentre",
  LeftCenter: "LeftCentre",
  CenterRight: "RightCentre",
  RightCenter: "RightCentre"
};
const DEFAULT_ATA_CAPABILITIES = Object.freeze({
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
  isMultiSplitSystem: null
});
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function parseBool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") {
      return true;
    }
    if (lower === "false") {
      return false;
    }
  }
  return null;
}
function parseNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function parseString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}
function parseEnum(raw, allowed, aliases, onUnknown) {
  var _a, _b;
  const text = (_a = parseString(raw)) == null ? void 0 : _a.trim();
  if (text === void 0 || text === "") {
    return null;
  }
  const candidate = (_b = aliases[text]) != null ? _b : text;
  const match = allowed.find((word) => word.toLowerCase() === candidate.toLowerCase());
  if (match) {
    return match;
  }
  onUnknown(text);
  return null;
}
function parseCapabilities(raw) {
  const data = isObject(raw) ? raw : {};
  const result = { ...DEFAULT_ATA_CAPABILITIES };
  for (const key of Object.keys(DEFAULT_ATA_CAPABILITIES)) {
    const value = data[key];
    if (key === "isMultiSplitSystem") {
      result.isMultiSplitSystem = parseBool(value);
    } else if (typeof DEFAULT_ATA_CAPABILITIES[key] === "number") {
      const parsed = parseNumber(value);
      if (parsed !== null) {
        result[key] = parsed;
      }
    } else {
      const parsed = parseBool(value);
      if (parsed !== null) {
        result[key] = parsed;
      }
    }
  }
  return result;
}
function settingsMap(raw) {
  const map = /* @__PURE__ */ new Map();
  for (const item of asArray(raw)) {
    if (isObject(item) && typeof item.name === "string") {
      map.set(item.name, item.value);
    }
  }
  return map;
}
function parseAtaUnit(raw, building, warn) {
  var _a, _b, _c, _d, _e, _f, _g;
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.trim() === "") {
    warn("unit-without-id", "Ignoring an air-to-air unit without id in the MELCloud Home response");
    return null;
  }
  const id = raw.id.trim();
  const settings = settingsMap(raw.settings);
  const unknown = (field) => (value) => warn(
    `${id}:${field}:${value}`,
    `Unit ${id} reported unknown ${field} "${(0, import_errors.stripLineBreaks)(value)}" - value ignored`
  );
  const isInError = (_b = (_a = parseBool(settings.get("IsInError"))) != null ? _a : parseBool(raw.isInError)) != null ? _b : false;
  return {
    id,
    name: (0, import_errors.stripLineBreaks)(((_c = parseString(raw.givenDisplayName)) == null ? void 0 : _c.trim()) || id),
    buildingId: building.id,
    buildingName: building.name,
    isGuest: building.isGuest,
    isConnected: (_d = parseBool(raw.isConnected)) != null ? _d : false,
    timeZone: (_e = parseString(raw.timeZone)) != null ? _e : null,
    power: parseBool(settings.get("Power")),
    operationMode: parseEnum(settings.get("OperationMode"), OPERATION_MODES, {}, unknown("operation mode")),
    setTemperature: parseNumber(settings.get("SetTemperature")),
    roomTemperature: parseNumber(settings.get("RoomTemperature")),
    setFanSpeed: parseEnum(settings.get("SetFanSpeed"), FAN_SPEEDS, NUMERIC_TO_WORD, unknown("fan speed")),
    actualFanSpeed: parseEnum(settings.get("ActualFanSpeed"), ACTUAL_FAN_SPEEDS, {}, unknown("actual fan speed")),
    vaneVerticalDirection: parseEnum(
      settings.get("VaneVerticalDirection"),
      VANE_VERTICAL_DIRECTIONS,
      VANE_VERTICAL_NUMERIC,
      unknown("vertical vane direction")
    ),
    vaneHorizontalDirection: parseEnum(
      settings.get("VaneHorizontalDirection"),
      VANE_HORIZONTAL_DIRECTIONS,
      VANE_HORIZONTAL_AMERICAN,
      unknown("horizontal vane direction")
    ),
    inStandbyMode: parseBool(settings.get("InStandbyMode")),
    isInError,
    errorCode: (0, import_errors.stripLineBreaks)((_g = (_f = parseString(settings.get("ErrorCode"))) == null ? void 0 : _f.trim()) != null ? _g : ""),
    rssi: parseNumber(raw.rssi),
    capabilities: parseCapabilities(raw.capabilities)
  };
}
function parseUserContext(raw, warn) {
  var _a, _b, _c;
  if (!isObject(raw)) {
    return null;
  }
  const ataUnits = [];
  const seen = /* @__PURE__ */ new Set();
  let atwUnitCount = 0;
  const buildings = [
    ...asArray(raw.buildings).map((b) => ({ raw: b, isGuest: false })),
    ...asArray(raw.guestBuildings).map((b) => ({ raw: b, isGuest: true }))
  ];
  for (const { raw: building, isGuest } of buildings) {
    if (!isObject(building)) {
      continue;
    }
    const info = {
      id: (_a = parseString(building.id)) != null ? _a : "",
      name: (0, import_errors.stripLineBreaks)((_c = (_b = parseString(building.name)) == null ? void 0 : _b.trim()) != null ? _c : ""),
      isGuest
    };
    for (const rawUnit of asArray(building.airToAirUnits)) {
      const unit = parseAtaUnit(rawUnit, info, warn);
      if (unit && !seen.has(unit.id)) {
        seen.add(unit.id);
        ataUnits.push(unit);
      }
    }
    atwUnitCount += asArray(building.airToWaterUnits).length;
  }
  return { ataUnits, atwUnitCount };
}
function buildAtaControlBody(request) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  return {
    power: (_a = request.power) != null ? _a : null,
    operationMode: (_b = request.operationMode) != null ? _b : null,
    setFanSpeed: (_c = request.setFanSpeed) != null ? _c : null,
    vaneHorizontalDirection: (_d = request.vaneHorizontalDirection) != null ? _d : null,
    vaneVerticalDirection: (_e = request.vaneVerticalDirection) != null ? _e : null,
    setTemperature: (_f = request.setTemperature) != null ? _f : null,
    temperatureIncrementOverride: (_g = request.temperatureIncrementOverride) != null ? _g : null,
    inStandbyMode: (_h = request.inStandbyMode) != null ? _h : null
  };
}
function parseApiTimestamp(value, timeZone = "UTC") {
  const text = parseString(value);
  if (!text) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    text.trim()
  );
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s = "0", frac = "0", offset] = match;
  const ms = Number(`0.${frac}`) * 1e3;
  const wallClock = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Math.floor(ms));
  if (Number.isNaN(wallClock)) {
    return null;
  }
  if (offset) {
    if (offset === "Z") {
      return wallClock;
    }
    const sign = offset.startsWith("-") ? -1 : 1;
    const digits = offset.replace(/[+:-]/g, "");
    const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
    return wallClock - sign * minutes * 6e4;
  }
  return wallClock - timeZoneOffsetMs(wallClock, timeZone);
}
function timeZoneOffsetMs(instant, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(new Date(instant));
    const get = (type) => {
      var _a;
      return Number((_a = parts.find((p) => p.type === type)) == null ? void 0 : _a.value);
    };
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - Math.floor(instant / 1e3) * 1e3;
  } catch {
    return 0;
  }
}
function telemetryPoints(raw) {
  const points = [];
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
function parseRssi(raw) {
  const points = telemetryPoints(raw);
  if (points.length === 0) {
    return null;
  }
  const newest = points.reduce((a, b) => b.time > a.time ? b : a);
  return { value: Math.round(newest.value), time: newest.time };
}
function parseHourlyEnergy(raw) {
  const result = /* @__PURE__ */ new Map();
  for (const point of telemetryPoints(raw)) {
    if (point.value >= 0) {
      result.set(point.time, point.value);
    }
  }
  return result;
}
function parseOutdoorTemperature(raw, timeZone) {
  const report = Array.isArray(raw) ? raw[0] : raw;
  if (!isObject(report)) {
    return null;
  }
  const dataset = asArray(report.datasets).find(
    (d) => isObject(d) && typeof d.label === "string" && d.label.includes("OUTDOOR_TEMPERATURE")
  );
  if (!isObject(dataset)) {
    return null;
  }
  let newest = null;
  for (const point of asArray(dataset.data)) {
    if (!isObject(point)) {
      continue;
    }
    const time = parseApiTimestamp(point.x, timeZone != null ? timeZone : "UTC");
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ACTUAL_FAN_SPEEDS,
  DEFAULT_ATA_CAPABILITIES,
  FAN_SPEEDS,
  OPERATION_MODES,
  VANE_HORIZONTAL_DIRECTIONS,
  VANE_VERTICAL_DIRECTIONS,
  buildAtaControlBody,
  parseApiTimestamp,
  parseAtaUnit,
  parseBool,
  parseCapabilities,
  parseHourlyEnergy,
  parseNumber,
  parseOutdoorTemperature,
  parseRssi,
  parseUserContext
});
//# sourceMappingURL=types.js.map
