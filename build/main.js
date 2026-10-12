"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_auth = require("./lib/api/auth");
var import_client = require("./lib/api/client");
var import_connection = require("./lib/api/connection");
var import_http = require("./lib/api/http");
const MIN_POLL_INTERVAL_S = 60;
const MAX_POLL_INTERVAL_S = 3600;
class Melcloudhome extends utils.Adapter {
  http;
  client;
  connection;
  knownUnitCount;
  constructor(options = {}) {
    super({
      ...options,
      name: "melcloudhome"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    var _a, _b;
    await this.setState("info.connection", false, true);
    const email = ((_a = this.config.email) != null ? _a : "").trim();
    const password = (_b = this.config.password) != null ? _b : "";
    if (!email || !password) {
      this.log.warn(
        "No MELCloud Home credentials configured - please enter e-mail and password in the instance settings"
      );
      return;
    }
    let pollInterval = Number(this.config.pollInterval);
    if (!Number.isFinite(pollInterval) || pollInterval < MIN_POLL_INTERVAL_S) {
      this.log.warn(
        `Polling interval ${this.config.pollInterval} s is invalid or too low - using ${MIN_POLL_INTERVAL_S} s`
      );
      pollInterval = MIN_POLL_INTERVAL_S;
    }
    pollInterval = Math.min(Math.round(pollInterval), MAX_POLL_INTERVAL_S);
    this.http = new import_http.HttpTransport();
    const tokens = new import_auth.TokenManager(new import_auth.AuthClient(this.http), { email, password }, this.log);
    this.client = new import_client.MelCloudHomeClient({ http: this.http, tokens, log: this.log });
    this.connection = new import_connection.ConnectionManager({
      source: this.client,
      log: this.log,
      pollIntervalMs: pollInterval * 1e3,
      scheduler: {
        setTimeout: (callback, ms) => this.setTimeout(callback, ms),
        clearTimeout: (handle) => this.clearTimeout(handle)
      },
      onConnectionChange: async (connected) => {
        await this.setState("info.connection", connected, true);
      },
      onContext: (context) => this.onContext(context)
    });
    this.log.info(
      `Starting (polling every ${pollInterval} s, real-time ${this.config.realtime ? "enabled" : "disabled"})`
    );
    this.connection.start();
  }
  /**
   * Receives every successfully fetched /context.
   *
   * @param context - Parsed user context
   */
  onContext(context) {
    if (context.ataUnits.length !== this.knownUnitCount) {
      this.knownUnitCount = context.ataUnits.length;
      this.log.info(`Found ${context.ataUnits.length} air-to-air unit(s)`);
      if (context.atwUnitCount > 0) {
        this.log.info(`Ignoring ${context.atwUnitCount} air-to-water unit(s) - not supported yet`);
      }
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    var _a, _b;
    try {
      (_a = this.connection) == null ? void 0 : _a.stop();
      (_b = this.http) == null ? void 0 : _b.abort();
      void this.setState("info.connection", false, true);
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }
  /**
   * Is called if a subscribed state changes
   *
   * @param id - State ID
   * @param state - State object
   */
  onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    this.log.debug(`Command for ${id} ignored - control not implemented yet`);
  }
}
if (require.main !== module) {
  module.exports = (options) => new Melcloudhome(options);
} else {
  (() => new Melcloudhome())();
}
//# sourceMappingURL=main.js.map
