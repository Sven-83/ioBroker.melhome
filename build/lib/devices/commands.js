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
var commands_exports = {};
__export(commands_exports, {
  COMMAND_DEBOUNCE_MS: () => COMMAND_DEBOUNCE_MS,
  CommandQueue: () => CommandQueue,
  REQUEST_GAP_MS: () => REQUEST_GAP_MS,
  planRequests: () => planRequests
});
module.exports = __toCommonJS(commands_exports);
var import_errors = require("../api/errors");
var import_mapping = require("../mapping");
const COMMAND_DEBOUNCE_MS = 800;
const REQUEST_GAP_MS = 1500;
function planRequests(command, unit) {
  var _a;
  const { vaneVerticalDirection, vaneHorizontalDirection, ...main } = command;
  if (main.power === true && main.operationMode === void 0) {
    const mode = unit == null ? void 0 : unit.operationMode;
    if (!mode) {
      throw new RangeError("Cannot switch on: the current operation mode is unknown");
    }
    main.operationMode = mode;
  }
  if (main.setTemperature !== void 0) {
    if (!unit) {
      throw new RangeError("Cannot set the temperature: unit state unknown");
    }
    const mode = (_a = main.operationMode) != null ? _a : unit.operationMode;
    main.setTemperature = (0, import_mapping.clampTemperature)(main.setTemperature, (0, import_mapping.temperatureLimits)(unit.capabilities, mode));
  }
  const requests = [];
  if (Object.values(main).some((value) => value !== void 0)) {
    requests.push(main);
  }
  if (vaneVerticalDirection !== void 0) {
    requests.push({ vaneVerticalDirection });
  }
  if (vaneHorizontalDirection !== void 0) {
    requests.push({ vaneHorizontalDirection });
  }
  return requests;
}
class CommandQueue {
  options;
  debounceMs;
  gapMs;
  pending = /* @__PURE__ */ new Map();
  timers = /* @__PURE__ */ new Map();
  busy = /* @__PURE__ */ new Set();
  stopped = false;
  /** @param options - Dependencies and settings */
  constructor(options) {
    var _a, _b;
    this.options = options;
    this.debounceMs = (_a = options.debounceMs) != null ? _a : COMMAND_DEBOUNCE_MS;
    this.gapMs = (_b = options.gapMs) != null ? _b : REQUEST_GAP_MS;
  }
  /**
   * Adds fields to the pending command of a unit and (re)starts its debounce timer.
   *
   * @param unitId - Unit UUID
   * @param fields - Fields to change
   */
  enqueue(unitId, fields) {
    if (this.stopped) {
      return;
    }
    this.pending.set(unitId, { ...this.pending.get(unitId), ...fields });
    this.schedule(unitId, this.debounceMs);
  }
  /**
   * True if commands for this unit are waiting or being sent
   *
   * @param unitId - Unit UUID
   */
  isPending(unitId) {
    return this.pending.has(unitId) || this.busy.has(unitId);
  }
  /** Drops pending commands and timers (adapter unload) */
  stop() {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      this.options.scheduler.clearTimeout(timer);
    }
    this.timers.clear();
    this.pending.clear();
  }
  schedule(unitId, delayMs) {
    const existing = this.timers.get(unitId);
    if (existing !== void 0) {
      this.options.scheduler.clearTimeout(existing);
    }
    this.timers.set(
      unitId,
      this.options.scheduler.setTimeout(() => {
        this.timers.delete(unitId);
        void this.flush(unitId);
      }, delayMs)
    );
  }
  async flush(unitId) {
    if (this.stopped) {
      return;
    }
    if (this.busy.has(unitId)) {
      this.schedule(unitId, this.debounceMs);
      return;
    }
    const command = this.pending.get(unitId);
    this.pending.delete(unitId);
    if (!command) {
      return;
    }
    const { log, send, getUnit, onAccepted, onFailed, onBatchDone, sleep } = this.options;
    let requests;
    try {
      requests = planRequests(command, getUnit(unitId));
    } catch (error) {
      log.warn(`Command for unit ${unitId} not sent: ${(0, import_errors.describeError)(error)}`);
      await onFailed(unitId, command, error);
      onBatchDone(unitId);
      return;
    }
    this.busy.add(unitId);
    try {
      for (const [index, request] of requests.entries()) {
        if (this.stopped) {
          return;
        }
        if (index > 0) {
          await sleep(this.gapMs);
        }
        try {
          await send(unitId, request);
          log.debug(`Command for unit ${unitId} accepted: ${JSON.stringify(request)}`);
          await onAccepted(unitId, request);
        } catch (error) {
          if (this.stopped) {
            return;
          }
          log.warn(`Command for unit ${unitId} failed: ${(0, import_errors.describeError)(error)}`);
          await onFailed(unitId, request, error);
        }
      }
    } finally {
      this.busy.delete(unitId);
    }
    if (!this.stopped) {
      onBatchDone(unitId);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COMMAND_DEBOUNCE_MS,
  CommandQueue,
  REQUEST_GAP_MS,
  planRequests
});
//# sourceMappingURL=commands.js.map
