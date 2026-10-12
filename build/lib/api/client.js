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
var client_exports = {};
__export(client_exports, {
  MelCloudHomeClient: () => MelCloudHomeClient,
  formatReportTime: () => formatReportTime,
  formatTelemetryTime: () => formatTelemetryTime
});
module.exports = __toCommonJS(client_exports);
var import_constants = require("./constants");
var import_errors = require("./errors");
var import_types = require("./types");
const MAX_REMEMBERED_WARNINGS = 200;
const pad = (n) => String(n).padStart(2, "0");
function formatTelemetryTime(time) {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes()
  )}`;
}
function formatReportTime(time) {
  const d = new Date(time);
  return `${formatTelemetryTime(time).replace(" ", "T")}:${pad(d.getUTCSeconds())}.0000000Z`;
}
class MelCloudHomeClient {
  http;
  tokens;
  log;
  endpoints;
  retryDelayMs;
  sleep;
  now;
  warned = /* @__PURE__ */ new Set();
  /** @param options - Dependencies and settings */
  constructor(options) {
    var _a, _b, _c, _d;
    this.http = options.http;
    this.tokens = options.tokens;
    this.log = options.log;
    this.endpoints = (_a = options.endpoints) != null ? _a : import_constants.DEFAULT_ENDPOINTS;
    this.retryDelayMs = (_b = options.retryDelayMs) != null ? _b : 5e3;
    this.sleep = (_c = options.sleep) != null ? _c : ((ms) => this.http.abortableSleep(ms));
    this.now = (_d = options.now) != null ? _d : Date.now;
  }
  /** All buildings and units with their current state */
  async getContext() {
    const data = await this.request(import_constants.PATH_CONTEXT, { method: "GET", retry: true });
    const context = (0, import_types.parseUserContext)(data, (key, message) => this.warnOnce(key, message));
    if (!context) {
      throw new import_errors.ApiError("Unexpected /context response");
    }
    return context;
  }
  /**
   * Sends one control request. HTTP 200 only means "accepted", not "applied".
   *
   * @param unitId - Unit UUID
   * @param request - Fields to change
   */
  async controlAta(unitId, request) {
    if (request.vaneHorizontalDirection !== void 0 && request.vaneVerticalDirection !== void 0) {
      throw new RangeError("Both vane axes must not be sent in one request");
    }
    if (request.power === true && request.operationMode === void 0) {
      throw new RangeError("Power on must be sent together with the operation mode");
    }
    await this.request(`${import_constants.PATH_ATA_CONTROL}${encodeURIComponent(unitId)}`, {
      method: "PUT",
      body: (0, import_types.buildAtaControlBody)(request),
      retry: false
    });
  }
  /**
   * Hourly energy consumption (Wh per hour) - only for units with hasEnergyConsumedMeter.
   *
   * @param unitId - Unit UUID
   * @param hours - Window size, default 23 h like the reference
   */
  async getHourlyEnergy(unitId, hours = 23) {
    const now = this.now();
    const hourMs = 36e5;
    const from = Math.floor((now - hours * hourMs) / hourMs) * hourMs;
    const query = new URLSearchParams({
      from: formatTelemetryTime(from),
      to: formatTelemetryTime(now),
      interval: "Hour",
      measure: "cumulative_energy_consumed_since_last_upload"
    });
    const data = await this.request(`${import_constants.PATH_TELEMETRY_ENERGY}${encodeURIComponent(unitId)}?${query.toString()}`, {
      method: "GET",
      retry: true
    });
    return (0, import_types.parseHourlyEnergy)(data);
  }
  /**
   * Newest Wi-Fi signal reading (dBm). The window must be exactly one hour.
   *
   * @param unitId - Unit UUID
   */
  async getWifiSignal(unitId) {
    const now = this.now();
    const query = new URLSearchParams({
      from: formatTelemetryTime(now - 36e5),
      to: formatTelemetryTime(now),
      measure: "rssi"
    });
    const data = await this.request(`${import_constants.PATH_TELEMETRY_ACTUAL}${encodeURIComponent(unitId)}?${query.toString()}`, {
      method: "GET",
      retry: true
    });
    return (0, import_types.parseRssi)(data);
  }
  /**
   * Newest genuine outdoor temperature from the 48 h trend report.
   *
   * @param unitId - Unit UUID
   * @param timeZone - IANA zone of the unit (report timestamps are local)
   */
  async getOutdoorTemperature(unitId, timeZone) {
    const to = Math.floor(this.now() / 6e4) * 6e4;
    const query = new URLSearchParams({
      unitId,
      period: "Hourly",
      from: formatReportTime(to - 48 * 36e5),
      to: formatReportTime(to)
    });
    const data = await this.request(`${import_constants.PATH_TREND_SUMMARY}?${query.toString()}`, { method: "GET", retry: true });
    return (0, import_types.parseOutdoorTemperature)(data, timeZone);
  }
  /** Credential ("hash") for the WebSocket - never log it */
  async getWebSocketHash() {
    const data = await this.request(this.endpoints.wsHash, { method: "GET", retry: true });
    const hash = data && typeof data === "object" ? data.hash : void 0;
    if (typeof hash !== "string" || !hash) {
      throw new import_errors.ApiError("WebSocket credential response contains no hash");
    }
    return hash;
  }
  /**
   * Authorised request with 401 cascade and optional single retry.
   *
   * @param pathOrUrl - Path below the API host or absolute URL
   * @param options - Request options
   * @returns Parsed JSON, or null for an empty body / HTTP 304
   */
  async request(pathOrUrl, options) {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.endpoints.api}${pathOrUrl}`;
    const label = `${options.method} ${pathOrUrl.split("?")[0].replace(/^https?:\/\/[^/]+/, "<ws-credential>")}`;
    let unauthorized = 0;
    let retried = false;
    for (; ; ) {
      try {
        const token = await this.tokens.getAccessToken();
        const headers = {
          "User-Agent": import_constants.USER_AGENT,
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        };
        if (options.body !== void 0) {
          headers["Content-Type"] = "application/json; charset=utf-8";
        }
        const { response, body } = await this.http.request(url, {
          method: options.method,
          headers,
          body: options.body !== void 0 ? JSON.stringify(options.body) : void 0
        });
        this.log.debug(`${label} -> HTTP ${response.status}`);
        if (response.status === 401 || response.status === 403) {
          unauthorized++;
          if (unauthorized === 1) {
            this.tokens.invalidateAccessToken();
            continue;
          }
          if (unauthorized === 2) {
            this.tokens.forceLogin();
            continue;
          }
          throw new import_errors.TokenRejectedError(`${label} still unauthorised after a new login`);
        }
        if (response.status === 304) {
          return null;
        }
        if (response.status >= 500) {
          throw new import_errors.ServiceUnavailableError(response.status);
        }
        if (response.status >= 400) {
          throw new import_errors.ApiError(`${label} failed (HTTP ${response.status})`, response.status);
        }
        if (body.trim() === "") {
          return null;
        }
        try {
          return JSON.parse(body);
        } catch {
          throw new import_errors.ApiError(`${label} returned invalid JSON`, response.status);
        }
      } catch (error) {
        const transient = error instanceof import_errors.NetworkError || error instanceof import_errors.ServiceUnavailableError;
        if (!options.retry || retried || !transient || this.http.aborted) {
          throw error;
        }
        retried = true;
        this.log.debug(`${label} failed (${error.message}) - retrying once`);
        await this.sleep(this.retryDelayMs);
        if (this.http.aborted) {
          throw new import_errors.AbortedError();
        }
      }
    }
  }
  warnOnce(key, message) {
    if (this.warned.has(key)) {
      return;
    }
    if (this.warned.size >= MAX_REMEMBERED_WARNINGS) {
      const oldest = this.warned.values().next().value;
      if (oldest !== void 0) {
        this.warned.delete(oldest);
      }
    }
    this.warned.add(key);
    this.log.warn(message);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MelCloudHomeClient,
  formatReportTime,
  formatTelemetryTime
});
//# sourceMappingURL=client.js.map
