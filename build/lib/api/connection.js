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
var connection_exports = {};
__export(connection_exports, {
  BACKOFF: () => BACKOFF,
  ConnectionManager: () => ConnectionManager,
  DEFAULT_REFRESH_DELAY_MS: () => DEFAULT_REFRESH_DELAY_MS,
  START_JITTER_MS: () => START_JITTER_MS,
  classifyFailure: () => classifyFailure,
  formatDuration: () => formatDuration
});
module.exports = __toCommonJS(connection_exports);
var import_errors = require("./errors");
const SECOND = 1e3;
const MINUTE = 60 * SECOND;
const BACKOFF = Object.freeze({
  network: { initialMs: 30 * SECOND, maxMs: 5 * MINUTE },
  service: { initialMs: 120 * SECOND, maxMs: 15 * MINUTE },
  // HTTP 429: at least as long as Retry-After demands
  rateLimit: { initialMs: 120 * SECOND, maxMs: 30 * MINUTE },
  login: { initialMs: 60 * SECOND, maxMs: 15 * MINUTE },
  // slow on purpose: many failed logins could lock the account at Cognito
  credentials: { initialMs: 30 * MINUTE, maxMs: 30 * MINUTE },
  api: { initialMs: 120 * SECOND, maxMs: 15 * MINUTE }
});
const DEFAULT_REFRESH_DELAY_MS = 2e3;
const START_JITTER_MS = 3e4;
function classifyFailure(error) {
  if (error instanceof import_errors.CredentialsRejectedError) {
    return "credentials";
  }
  if (error instanceof import_errors.LoginFlowError || error instanceof import_errors.TokenRejectedError) {
    return "login";
  }
  if (error instanceof import_errors.NetworkError) {
    return "network";
  }
  if (error instanceof import_errors.ServiceUnavailableError) {
    return "service";
  }
  if (error instanceof import_errors.RateLimitedError) {
    return "rateLimit";
  }
  return "api";
}
function formatDuration(ms) {
  return ms >= MINUTE && ms % MINUTE === 0 ? `${ms / MINUTE} min` : `${Math.round(ms / SECOND)} s`;
}
class ConnectionManager {
  options;
  tolerance;
  connected;
  failures = 0;
  offlineAttempts = 0;
  lastFailureKind;
  timer;
  polling = false;
  refreshRequested = false;
  started = false;
  stopped = false;
  /** @param options - Dependencies and settings */
  constructor(options) {
    var _a;
    this.options = options;
    this.tolerance = (_a = options.failureTolerance) != null ? _a : 2;
  }
  /** Current connection state (undefined before the first attempt finished) */
  get isConnected() {
    return this.connected === true;
  }
  /** Starts polling after a short random delay (start jitter) */
  start() {
    var _a, _b;
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    const jitterMs = (_a = this.options.startJitterMs) != null ? _a : START_JITTER_MS;
    const random = (_b = this.options.random) != null ? _b : Math.random;
    this.schedule(Math.floor(random() * jitterMs));
  }
  /** Stops polling; a running request is left to the transport abort */
  stop() {
    this.stopped = true;
    this.clearTimer();
  }
  /**
   * Requests a /context refresh soon (after commands or WebSocket events). Calls within the
   * delay are merged. Ignored while the connection is down - the backoff stays in charge.
   *
   * @param delayMs - Debounce delay
   */
  requestRefresh(delayMs = DEFAULT_REFRESH_DELAY_MS) {
    if (!this.started || this.stopped || this.connected !== true) {
      return;
    }
    if (this.polling) {
      this.refreshRequested = true;
      return;
    }
    this.schedule(delayMs);
  }
  schedule(delayMs) {
    if (this.stopped) {
      return;
    }
    this.clearTimer();
    this.timer = this.options.scheduler.setTimeout(() => {
      this.timer = void 0;
      void this.poll();
    }, delayMs);
  }
  clearTimer() {
    if (this.timer !== void 0) {
      this.options.scheduler.clearTimeout(this.timer);
      this.timer = void 0;
    }
  }
  async poll() {
    if (this.stopped || this.polling) {
      return;
    }
    this.polling = true;
    this.refreshRequested = false;
    let nextDelay;
    try {
      const context = await this.options.source.getContext();
      if (this.stopped) {
        return;
      }
      await this.handleSuccess(context);
      nextDelay = this.refreshRequested ? DEFAULT_REFRESH_DELAY_MS : this.options.pollIntervalMs;
    } catch (error) {
      if (this.stopped || error instanceof import_errors.AbortedError) {
        return;
      }
      nextDelay = await this.handleFailure(error);
    } finally {
      this.polling = false;
    }
    this.schedule(nextDelay);
  }
  async handleSuccess(context) {
    const wasConnected = this.connected;
    this.failures = 0;
    this.offlineAttempts = 0;
    this.lastFailureKind = void 0;
    if (wasConnected !== true) {
      this.options.log.info(
        wasConnected === false ? "Connection to MELCloud Home restored" : `Connected to MELCloud Home (${context.ataUnits.length} air-to-air unit(s))`
      );
      await this.setConnected(true);
    }
    try {
      await this.options.onContext(context);
    } catch (error) {
      this.options.log.error(`Processing MELCloud Home data failed: ${(0, import_errors.describeError)(error)}`);
    }
  }
  /**
   * Updates counters, logs and returns the delay until the next attempt.
   *
   * @param error - Error of the failed poll
   */
  async handleFailure(error) {
    var _a;
    const { log, pollIntervalMs } = this.options;
    const kind = classifyFailure(error);
    const reason = (0, import_errors.describeError)(error);
    const kindChanged = kind !== this.lastFailureKind;
    this.lastFailureKind = kind;
    this.failures++;
    const retryAfterMs = error instanceof import_errors.RateLimitedError ? (_a = error.retryAfterMs) != null ? _a : 0 : 0;
    if (kind === "credentials") {
      const delay2 = BACKOFF.credentials.initialMs;
      if (kindChanged) {
        log.error(
          `MELCloud Home rejected the login - please check e-mail and password. Retrying every ${formatDuration(delay2)}`
        );
      } else {
        log.debug(`Login still rejected - retrying in ${formatDuration(delay2)}`);
      }
      await this.setConnected(false);
      return delay2;
    }
    if (this.connected === true && this.failures <= this.tolerance) {
      const delay2 = Math.max(pollIntervalMs, retryAfterMs);
      log.debug(
        `Update from MELCloud Home failed (${reason}) - attempt ${this.failures}/${this.tolerance + 1}, retrying in ${formatDuration(delay2)}`
      );
      return delay2;
    }
    const backoff = BACKOFF[kind];
    const delay = Math.max(Math.min(backoff.initialMs * 2 ** this.offlineAttempts, backoff.maxMs), retryAfterMs);
    this.offlineAttempts++;
    if (this.connected !== false || kindChanged) {
      const prefix = this.connected === true ? "Connection to MELCloud Home lost" : "Cannot connect to MELCloud Home";
      log.warn(`${prefix}: ${reason} - retrying in ${formatDuration(delay)}`);
    } else {
      log.debug(`Still no connection to MELCloud Home (${reason}) - retrying in ${formatDuration(delay)}`);
    }
    await this.setConnected(false);
    return delay;
  }
  async setConnected(connected) {
    if (this.connected === connected) {
      return;
    }
    this.connected = connected;
    try {
      await this.options.onConnectionChange(connected);
    } catch (error) {
      this.options.log.error(`Updating the connection state failed: ${(0, import_errors.describeError)(error)}`);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BACKOFF,
  ConnectionManager,
  DEFAULT_REFRESH_DELAY_MS,
  START_JITTER_MS,
  classifyFailure,
  formatDuration
});
//# sourceMappingURL=connection.js.map
