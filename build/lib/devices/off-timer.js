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
var off_timer_exports = {};
__export(off_timer_exports, {
  EXPIRED_GRACE_MS: () => EXPIRED_GRACE_MS,
  MAX_OFF_TIMER_MINUTES: () => MAX_OFF_TIMER_MINUTES,
  OffTimers: () => OffTimers,
  TICK_MS: () => TICK_MS
});
module.exports = __toCommonJS(off_timer_exports);
const MAX_OFF_TIMER_MINUTES = 360;
const EXPIRED_GRACE_MS = 30 * 6e4;
const TICK_MS = 1e4;
class OffTimers {
  options;
  now;
  tickMs;
  nameOf;
  ends = /* @__PURE__ */ new Map();
  tick;
  stopped = false;
  /** @param options - Dependencies and callbacks */
  constructor(options) {
    var _a, _b, _c;
    this.options = options;
    this.now = (_a = options.now) != null ? _a : Date.now;
    this.tickMs = (_b = options.tickMs) != null ? _b : TICK_MS;
    this.nameOf = (_c = options.nameOf) != null ? _c : ((unitId) => unitId);
  }
  /**
   * Starts, restarts or (minutes = 0) cancels the timer of a unit.
   *
   * @param unitId - Unit UUID
   * @param minutes - Duration in minutes (0 cancels)
   * @returns The effective duration in minutes
   */
  async set(unitId, minutes) {
    const duration = Math.max(0, Math.min(MAX_OFF_TIMER_MINUTES, Math.round(minutes)));
    if (duration === 0) {
      await this.cancel(unitId);
      return 0;
    }
    const end = this.now() + duration * 6e4;
    this.ends.set(unitId, end);
    await this.options.onUpdate(unitId, duration * 60, end);
    this.ensureTick();
    return duration;
  }
  /**
   * Cancels the timer of a unit.
   *
   * @param unitId - Unit UUID
   */
  async cancel(unitId) {
    const had = this.ends.delete(unitId);
    if (had) {
      this.options.log.debug(`Off timer of ${this.nameOf(unitId)} cancelled`);
    }
    await this.options.onUpdate(unitId, 0, 0);
  }
  /**
   * Restores a persisted timer after a restart.
   *
   * @param unitId - Unit UUID
   * @param endTime - Persisted end time (epoch ms, 0 = none)
   */
  async restore(unitId, endTime) {
    if (!Number.isFinite(endTime) || endTime <= 0) {
      return;
    }
    const now = this.now();
    if (endTime > now) {
      this.ends.set(unitId, endTime);
      await this.options.onUpdate(unitId, Math.ceil((endTime - now) / 1e3), endTime);
      this.ensureTick();
      this.options.log.info(
        `Off timer of ${this.nameOf(unitId)} restored (${Math.ceil((endTime - now) / 6e4)} min left)`
      );
      return;
    }
    await this.options.onUpdate(unitId, 0, 0);
    if (now - endTime <= EXPIRED_GRACE_MS) {
      this.options.log.info(
        `Off timer of ${this.nameOf(unitId)} expired while the adapter was stopped - switching off now`
      );
      await this.options.onExpire(unitId);
    } else {
      this.options.log.info(
        `Off timer of ${this.nameOf(unitId)} expired long ago while the adapter was stopped - ignored`
      );
    }
  }
  /**
   * Remaining seconds of a unit's timer (0 if none).
   *
   * @param unitId - Unit UUID
   */
  remaining(unitId) {
    const end = this.ends.get(unitId);
    return end ? Math.max(0, Math.ceil((end - this.now()) / 1e3)) : 0;
  }
  /** Stops the tick; persisted end times stay untouched */
  stop() {
    this.stopped = true;
    if (this.tick !== void 0) {
      this.options.scheduler.clearTimeout(this.tick);
      this.tick = void 0;
    }
  }
  ensureTick() {
    if (this.tick !== void 0 || this.stopped || this.ends.size === 0) {
      return;
    }
    this.tick = this.options.scheduler.setTimeout(() => {
      this.tick = void 0;
      void this.onTick();
    }, this.tickMs);
  }
  async onTick() {
    const now = this.now();
    for (const [unitId, end] of [...this.ends]) {
      if (this.stopped) {
        return;
      }
      if (end <= now) {
        this.ends.delete(unitId);
        await this.options.onUpdate(unitId, 0, 0);
        this.options.log.info(`Off timer of ${this.nameOf(unitId)} elapsed - switching off`);
        await this.options.onExpire(unitId);
      } else {
        await this.options.onUpdate(unitId, Math.ceil((end - now) / 1e3), end);
      }
    }
    this.ensureTick();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXPIRED_GRACE_MS,
  MAX_OFF_TIMER_MINUTES,
  OffTimers,
  TICK_MS
});
//# sourceMappingURL=off-timer.js.map
