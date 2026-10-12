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
var telemetry_exports = {};
__export(telemetry_exports, {
  TELEMETRY_FIRST_DELAY_MS: () => TELEMETRY_FIRST_DELAY_MS,
  TELEMETRY_INTERVAL_MS: () => TELEMETRY_INTERVAL_MS,
  TelemetryPoller: () => TelemetryPoller
});
module.exports = __toCommonJS(telemetry_exports);
var import_errors = require("../api/errors");
const TELEMETRY_INTERVAL_MS = 30 * 6e4;
const TELEMETRY_FIRST_DELAY_MS = 15e3;
class TelemetryPoller {
  options;
  units = [];
  timer;
  running = false;
  stopped = false;
  failing = /* @__PURE__ */ new Set();
  /** @param options - Dependencies and settings */
  constructor(options) {
    this.options = options;
  }
  /**
   * Updates the unit list; the first call starts the polling.
   *
   * @param units - Units from the latest /context
   */
  setUnits(units) {
    var _a;
    this.units = units;
    if (this.timer === void 0 && !this.running && !this.stopped) {
      this.schedule((_a = this.options.firstDelayMs) != null ? _a : TELEMETRY_FIRST_DELAY_MS);
    }
  }
  /** Stops polling */
  stop() {
    this.stopped = true;
    if (this.timer !== void 0) {
      this.options.scheduler.clearTimeout(this.timer);
      this.timer = void 0;
    }
  }
  schedule(delayMs) {
    this.timer = this.options.scheduler.setTimeout(() => {
      this.timer = void 0;
      void this.run();
    }, delayMs);
  }
  async run() {
    var _a;
    if (this.stopped) {
      return;
    }
    this.running = true;
    try {
      for (const unit of this.units) {
        if (this.stopped) {
          return;
        }
        if (unit.capabilities.hasEnergyConsumedMeter) {
          await this.attempt(unit, "energy", async () => {
            await this.options.sink.onEnergy(unit.id, await this.options.source.getHourlyEnergy(unit.id));
          });
        }
        await this.attempt(unit, "wifi signal", async () => {
          const reading = await this.options.source.getWifiSignal(unit.id);
          if (reading) {
            await this.options.sink.onWifiSignal(unit.id, reading);
          }
        });
        await this.attempt(unit, "outdoor temperature", async () => {
          const reading = await this.options.source.getOutdoorTemperature(unit.id, unit.timeZone);
          if (reading) {
            await this.options.sink.onOutdoorTemperature(unit.id, reading);
          }
        });
      }
    } finally {
      this.running = false;
    }
    if (!this.stopped) {
      this.schedule((_a = this.options.intervalMs) != null ? _a : TELEMETRY_INTERVAL_MS);
    }
  }
  /**
   * Runs one request; logs the first failure of a kind as info, repetitions as debug.
   *
   * @param unit - Unit
   * @param what - Description for the log
   * @param task - Request and processing
   */
  async attempt(unit, what, task) {
    const key = `${unit.id}:${what}`;
    try {
      await task();
      if (this.failing.delete(key)) {
        this.options.log.info(`Reading ${what} of ${unit.name} works again`);
      }
    } catch (error) {
      if (error instanceof import_errors.AbortedError || this.stopped) {
        return;
      }
      const message = `Reading ${what} of ${unit.name} failed: ${(0, import_errors.describeError)(error)}`;
      if (this.failing.has(key)) {
        this.options.log.debug(message);
      } else {
        this.failing.add(key);
        this.options.log.info(`${message} - keeping the last value`);
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TELEMETRY_FIRST_DELAY_MS,
  TELEMETRY_INTERVAL_MS,
  TelemetryPoller
});
//# sourceMappingURL=telemetry.js.map
