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
var mapping_exports = {};
__export(mapping_exports, {
  ACTUAL_FAN_SPEED_CODES: () => ACTUAL_FAN_SPEED_CODES,
  FAN_SPEED_CODES: () => FAN_SPEED_CODES,
  MODE_CODES: () => MODE_CODES,
  VANE_HORIZONTAL_CODES: () => VANE_HORIZONTAL_CODES,
  VANE_VERTICAL_CODES: () => VANE_VERTICAL_CODES,
  actualFanSpeedStates: () => actualFanSpeedStates,
  clampTemperature: () => clampTemperature,
  fanSpeedStates: () => fanSpeedStates,
  fromCode: () => fromCode,
  isAllowedCode: () => isAllowedCode,
  modeStates: () => modeStates,
  overallTemperatureLimits: () => overallTemperatureLimits,
  temperatureLimits: () => temperatureLimits,
  toCode: () => toCode,
  vaneStates: () => vaneStates
});
module.exports = __toCommonJS(mapping_exports);
const MODE_CODES = { 8: "Automatic", 1: "Heat", 3: "Cool", 2: "Dry", 7: "Fan" };
const FAN_SPEED_CODES = { 0: "Auto", 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five" };
const ACTUAL_FAN_SPEED_CODES = {
  0: "Off",
  1: "One",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five"
};
const VANE_VERTICAL_CODES = {
  0: "Auto",
  1: "One",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  7: "Swing"
};
const VANE_HORIZONTAL_CODES = {
  0: "Auto",
  1: "Left",
  2: "LeftCentre",
  3: "Centre",
  4: "RightCentre",
  5: "Right",
  12: "Swing"
};
const MODE_LABELS = { 8: "Auto", 1: "Heat", 3: "Cool", 2: "Dry", 7: "Fan" };
const POSITION_LABELS = {
  Auto: "Auto",
  Swing: "Swing",
  One: "Position 1",
  Two: "Position 2",
  Three: "Position 3",
  Four: "Position 4",
  Five: "Position 5",
  Left: "Position 1 (left)",
  LeftCentre: "Position 2",
  Centre: "Position 3 (centre)",
  RightCentre: "Position 4",
  Right: "Position 5 (right)"
};
function toCode(map, value) {
  if (value === null || value === void 0) {
    return null;
  }
  for (const [code, apiValue] of Object.entries(map)) {
    if (apiValue === value) {
      return Number(code);
    }
  }
  return null;
}
function fromCode(map, code) {
  const number = typeof code === "string" && code.trim() !== "" ? Number(code) : code;
  if (typeof number !== "number" || !Number.isInteger(number)) {
    return void 0;
  }
  return Object.prototype.hasOwnProperty.call(map, number) ? map[number] : void 0;
}
function modeStates(caps) {
  const available = {
    Automatic: caps.hasAutoOperationMode,
    Heat: caps.hasHeatOperationMode,
    Cool: caps.hasCoolOperationMode,
    Dry: caps.hasDryOperationMode,
    Fan: true
  };
  const states = {};
  for (const [code, mode] of Object.entries(MODE_CODES)) {
    if (available[mode]) {
      states[code] = MODE_LABELS[Number(code)];
    }
  }
  return states;
}
function fanSpeedStates(caps) {
  const states = {};
  if (caps.hasAutomaticFanSpeed) {
    states[0] = "Auto";
  }
  const speeds = Math.max(1, Math.min(5, Math.round(caps.numberOfFanSpeeds)));
  for (let speed = 1; speed <= speeds; speed++) {
    states[speed] = `Speed ${speed}`;
  }
  return states;
}
function actualFanSpeedStates() {
  return { 0: "Off", 1: "Speed 1", 2: "Speed 2", 3: "Speed 3", 4: "Speed 4", 5: "Speed 5" };
}
function vaneStates(map, caps) {
  var _a;
  const states = {};
  for (const [code, value] of Object.entries(map)) {
    if (value === "Swing" && !caps.hasSwing) {
      continue;
    }
    states[code] = (_a = POSITION_LABELS[value]) != null ? _a : value;
  }
  return states;
}
function isAllowedCode(states, code) {
  const number = typeof code === "string" && code.trim() !== "" ? Number(code) : code;
  return typeof number === "number" && Number.isInteger(number) && String(number) in states;
}
function temperatureLimits(caps, mode) {
  const step = caps.hasHalfDegreeIncrements ? 0.5 : 1;
  switch (mode) {
    case "Heat":
      return { min: caps.minTempHeat, max: caps.maxTempHeat, step };
    case "Cool":
    case "Dry":
      return { min: caps.minTempCoolDry, max: caps.maxTempCoolDry, step };
    case "Automatic":
      return { min: caps.minTempAutomatic, max: caps.maxTempAutomatic, step };
    default:
      return overallTemperatureLimits(caps);
  }
}
function overallTemperatureLimits(caps) {
  return {
    min: Math.min(caps.minTempHeat, caps.minTempCoolDry, caps.minTempAutomatic),
    max: Math.max(caps.maxTempHeat, caps.maxTempCoolDry, caps.maxTempAutomatic),
    step: caps.hasHalfDegreeIncrements ? 0.5 : 1
  };
}
function clampTemperature(value, limits) {
  const rounded = Math.round(value / limits.step) * limits.step;
  return Math.min(limits.max, Math.max(limits.min, Number(rounded.toFixed(1))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ACTUAL_FAN_SPEED_CODES,
  FAN_SPEED_CODES,
  MODE_CODES,
  VANE_HORIZONTAL_CODES,
  VANE_VERTICAL_CODES,
  actualFanSpeedStates,
  clampTemperature,
  fanSpeedStates,
  fromCode,
  isAllowedCode,
  modeStates,
  overallTemperatureLimits,
  temperatureLimits,
  toCode,
  vaneStates
});
//# sourceMappingURL=mapping.js.map
