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
var http_exports = {};
__export(http_exports, {
  HttpTransport: () => HttpTransport,
  MAX_RETRY_AFTER_MS: () => MAX_RETRY_AFTER_MS,
  parseRetryAfter: () => parseRetryAfter,
  systemScheduler: () => systemScheduler
});
module.exports = __toCommonJS(http_exports);
var import_constants = require("./constants");
var import_errors = require("./errors");
const MAX_RETRY_AFTER_MS = 36e5;
function parseRetryAfter(header, now) {
  const value = header == null ? void 0 : header.trim();
  if (!value) {
    return void 0;
  }
  const ms = /^\d+$/.test(value) ? Number(value) * 1e3 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : void 0;
}
const systemScheduler = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle)
};
class HttpTransport {
  fetchFn;
  scheduler;
  minIntervalMs;
  timeoutMs;
  now;
  sleep;
  shutdown = new AbortController();
  queue = Promise.resolve();
  lastRequestAt = 0;
  /** @param options - Settings, mainly for tests */
  constructor(options = {}) {
    var _a, _b, _c, _d, _e, _f;
    this.fetchFn = (_a = options.fetch) != null ? _a : ((input, init) => fetch(input, init));
    this.scheduler = (_b = options.scheduler) != null ? _b : systemScheduler;
    this.minIntervalMs = (_c = options.minIntervalMs) != null ? _c : import_constants.MIN_REQUEST_INTERVAL_MS;
    this.timeoutMs = (_d = options.timeoutMs) != null ? _d : import_constants.HTTP_TIMEOUT_MS;
    this.now = (_e = options.now) != null ? _e : Date.now;
    this.sleep = (_f = options.sleep) != null ? _f : ((ms) => this.abortableSleep(ms));
  }
  /**
   * Waits, but returns early when the transport is aborted (no timer survives unload).
   *
   * @param ms - Wait time
   */
  abortableSleep(ms) {
    return new Promise((resolve) => {
      if (this.aborted) {
        resolve();
        return;
      }
      let timer = void 0;
      const done = () => {
        this.scheduler.clearTimeout(timer);
        this.shutdown.signal.removeEventListener("abort", done);
        resolve();
      };
      timer = this.scheduler.setTimeout(done, ms);
      if (timer === void 0) {
        resolve();
        return;
      }
      this.shutdown.signal.addEventListener("abort", done);
    });
  }
  /** True after {@link abort} was called */
  get aborted() {
    return this.shutdown.signal.aborted;
  }
  /** Aborts running and all future requests (adapter unload) */
  abort() {
    this.shutdown.abort();
  }
  /**
   * Performs one request. The response body is read completely before the
   * next queued request may start.
   *
   * @param url - Absolute URL
   * @param init - fetch options (signal is managed here)
   */
  async request(url, init = {}) {
    const run = this.queue.then(() => this.execute(url, init));
    this.queue = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  async execute(url, init) {
    if (this.aborted) {
      throw new import_errors.AbortedError();
    }
    const spacingMs = this.lastRequestAt + this.minIntervalMs - this.now();
    if (spacingMs > 0) {
      await this.sleep(spacingMs);
      if (this.aborted) {
        throw new import_errors.AbortedError();
      }
    }
    this.lastRequestAt = this.now();
    const controller = new AbortController();
    const onShutdown = () => controller.abort();
    this.shutdown.signal.addEventListener("abort", onShutdown);
    let timedOut = false;
    const timer = this.scheduler.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchFn(url, { ...init, signal: controller.signal });
      const body = await response.text();
      return { response, body };
    } catch (error) {
      if (this.aborted) {
        throw new import_errors.AbortedError();
      }
      if (timedOut) {
        throw new import_errors.NetworkError(`Request timed out after ${Math.round(this.timeoutMs / 1e3)} s`);
      }
      throw new import_errors.NetworkError(`Network error: ${describeNetworkError(error)}`);
    } finally {
      this.scheduler.clearTimeout(timer);
      this.shutdown.signal.removeEventListener("abort", onShutdown);
    }
  }
}
function describeNetworkError(error) {
  var _a, _b;
  if (error instanceof Error && error.cause) {
    const cause = error.cause;
    return (0, import_errors.describeError)((_b = (_a = cause.code) != null ? _a : cause.message) != null ? _b : error.message);
  }
  return (0, import_errors.describeError)(error);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HttpTransport,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  systemScheduler
});
//# sourceMappingURL=http.js.map
