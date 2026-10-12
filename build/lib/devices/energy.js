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
var energy_exports = {};
__export(energy_exports, {
  MAX_WH_PER_HOUR: () => MAX_WH_PER_HOUR,
  applyEnergy: () => applyEnergy,
  newEnergyTrackerData: () => newEnergyTrackerData,
  restoreEnergyTrackerData: () => restoreEnergyTrackerData,
  startOfLocalDay: () => startOfLocalDay
});
module.exports = __toCommonJS(energy_exports);
const MAX_WH_PER_HOUR = 1e5;
const RETENTION_MS = 48 * 36e5;
function newEnergyTrackerData(totalKwh = 0) {
  return { totalWh: Math.max(0, totalKwh * 1e3), seen: {}, initialised: false };
}
function restoreEnergyTrackerData(raw, totalKwh) {
  if (!raw || typeof raw !== "object") {
    return newEnergyTrackerData(totalKwh);
  }
  const data = raw;
  const seen = {};
  if (data.seen && typeof data.seen === "object") {
    for (const [hour, value] of Object.entries(data.seen)) {
      if (Number.isFinite(Number(hour)) && typeof value === "number" && Number.isFinite(value)) {
        seen[hour] = value;
      }
    }
  }
  const totalWh = typeof data.totalWh === "number" && Number.isFinite(data.totalWh) ? data.totalWh : totalKwh * 1e3;
  return { totalWh: Math.max(0, totalWh), seen, initialised: data.initialised === true };
}
const round3 = (value) => Math.round(value * 1e3) / 1e3;
function applyEnergy(data, hourly, now, startOfToday) {
  var _a;
  for (const [hour, wh] of hourly) {
    if (wh < 0 || wh > MAX_WH_PER_HOUR) {
      continue;
    }
    const key = String(hour);
    const previous = (_a = data.seen[key]) != null ? _a : 0;
    if (data.initialised && wh > previous) {
      data.totalWh += wh - previous;
    }
    data.seen[key] = Math.max(previous, wh);
  }
  data.initialised = true;
  for (const key of Object.keys(data.seen)) {
    if (Number(key) < now - RETENTION_MS) {
      delete data.seen[key];
    }
  }
  const seenHours = Object.keys(data.seen).map(Number);
  const newest = seenHours.length > 0 ? Math.max(...seenHours) : void 0;
  const todayWh = Object.entries(data.seen).filter(([hour]) => Number(hour) >= startOfToday).reduce((sum, [, wh]) => sum + wh, 0);
  return {
    totalKwh: round3(data.totalWh / 1e3),
    lastHourKwh: newest !== void 0 ? round3(data.seen[String(newest)] / 1e3) : null,
    todayKwh: round3(todayWh / 1e3)
  };
}
function startOfLocalDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_WH_PER_HOUR,
  applyEnergy,
  newEnergyTrackerData,
  restoreEnergyTrackerData,
  startOfLocalDay
});
//# sourceMappingURL=energy.js.map
