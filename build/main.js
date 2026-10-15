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
var import_errors = require("./lib/api/errors");
var import_http = require("./lib/api/http");
var import_websocket = require("./lib/api/websocket");
var import_ata = require("./lib/devices/ata");
var import_telemetry = require("./lib/devices/telemetry");
const MIN_POLL_INTERVAL_S = 60;
const MAX_POLL_INTERVAL_S = 3600;
class Melcloudhome extends utils.Adapter {
  http;
  connection;
  devices;
  telemetry;
  realtime;
  knownUnitCount;
  constructor(options = {}) {
    super({
      ...options,
      name: "melcloudhome"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("message", this.onMessage.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    var _a, _b;
    await this.setState("info.connection", false, true);
    await this.setState("info.realtime", false, true);
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
    const scheduler = {
      setTimeout: (callback, ms) => this.setTimeout(callback, ms),
      clearTimeout: (handle) => this.clearTimeout(handle)
    };
    const http = new import_http.HttpTransport({ scheduler });
    this.http = http;
    const tokens = new import_auth.TokenManager(new import_auth.AuthClient(http), { email, password }, this.log);
    const client = new import_client.MelCloudHomeClient({ http, tokens, log: this.log });
    await this.extendObjectAsync("devices", {
      type: "folder",
      common: { name: { en: "Devices", de: "Ger\xE4te" } },
      native: {}
    });
    this.devices = new import_ata.AtaDevices({
      port: this.createPort(),
      client,
      log: this.log,
      scheduler,
      sleep: (ms) => http.abortableSleep(ms),
      requestRefresh: () => {
        var _a2;
        return (_a2 = this.connection) == null ? void 0 : _a2.requestRefresh();
      },
      roomIcons: Object.fromEntries(
        (Array.isArray(this.config.roomIcons) ? this.config.roomIcons : []).filter((entry) => entry && typeof entry.unit === "string").map((entry) => [entry.unit, entry.icon])
      )
    });
    await this.devices.restoreTimers();
    this.telemetry = new import_telemetry.TelemetryPoller({ source: client, sink: this.devices, scheduler, log: this.log });
    this.connection = new import_connection.ConnectionManager({
      source: client,
      log: this.log,
      pollIntervalMs: pollInterval * 1e3,
      scheduler,
      onConnectionChange: async (connected) => {
        var _a2, _b2;
        await this.setState("info.connection", connected, true);
        if (connected) {
          (_a2 = this.realtime) == null ? void 0 : _a2.start();
        } else {
          (_b2 = this.realtime) == null ? void 0 : _b2.stop();
        }
      },
      onContext: (context) => this.onContext(context)
    });
    if (this.config.realtime) {
      this.realtime = new import_websocket.RealtimeConnection({
        getHash: () => client.getWebSocketHash(),
        scheduler,
        log: this.log,
        onUnitEvent: () => {
          var _a2;
          return (_a2 = this.connection) == null ? void 0 : _a2.requestRefresh();
        },
        onConnectionChange: async (connected) => {
          var _a2;
          await this.setState("info.realtime", connected, true);
          if (connected) {
            (_a2 = this.connection) == null ? void 0 : _a2.requestRefresh();
          }
        }
      });
    }
    this.subscribeStates("devices.*.control.*");
    this.log.info(
      `Starting (polling every ${pollInterval} s, real-time ${this.config.realtime ? "enabled" : "disabled"})`
    );
    this.connection.start();
  }
  /** Adapter functions used by the device layer */
  createPort() {
    return {
      namespace: this.namespace,
      extendObject: async (id, obj) => {
        await this.extendObjectAsync(id, obj);
      },
      getObject: (id) => this.getObjectAsync(id),
      setState: async (id, val, ack) => {
        await this.setStateAsync(id, val, ack);
      },
      getState: (id) => this.getStateAsync(id),
      getStates: async (pattern) => {
        var _a;
        return (_a = await this.getStatesAsync(pattern)) != null ? _a : {};
      },
      sanitizeId: (id) => id.replace(this.FORBIDDEN_CHARS, "_")
    };
  }
  /**
   * Receives every successfully fetched /context.
   *
   * @param context - Parsed user context
   */
  async onContext(context) {
    var _a, _b;
    if (context.ataUnits.length !== this.knownUnitCount) {
      this.knownUnitCount = context.ataUnits.length;
      this.log.info(`Found ${context.ataUnits.length} air-to-air unit(s)`);
      if (context.atwUnitCount > 0) {
        this.log.info(`Ignoring ${context.atwUnitCount} air-to-water unit(s) - not supported yet`);
      }
    }
    await ((_a = this.devices) == null ? void 0 : _a.update(context));
    (_b = this.telemetry) == null ? void 0 : _b.setUnits(context.ataUnits);
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    var _a, _b, _c, _d, _e;
    try {
      (_a = this.realtime) == null ? void 0 : _a.stop();
      (_b = this.connection) == null ? void 0 : _b.stop();
      (_c = this.telemetry) == null ? void 0 : _c.stop();
      (_d = this.devices) == null ? void 0 : _d.stop();
      (_e = this.http) == null ? void 0 : _e.abort();
      void this.setState("info.connection", false, true);
      void this.setState("info.realtime", false, true);
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }
  /**
   * Answers requests of the instance settings.
   *
   * @param obj - Message from admin
   */
  onMessage(obj) {
    var _a, _b;
    if ((obj == null ? void 0 : obj.command) === "getUnits" && obj.callback) {
      const units = (_b = (_a = this.devices) == null ? void 0 : _a.listUnits()) != null ? _b : [];
      this.sendTo(
        obj.from,
        obj.command,
        units.map((unit) => ({ value: unit.id, label: unit.name })),
        obj.callback
      );
    }
  }
  /**
   * Is called if a subscribed state changes
   *
   * @param id - State ID
   * @param state - State object
   */
  onStateChange(id, state) {
    if (!state || state.ack || !this.devices) {
      return;
    }
    this.devices.handleCommand(id, state).catch((error) => {
      this.log.error(`Handling command ${id} failed: ${(0, import_errors.describeError)(error)}`);
    });
  }
}
if (require.main !== module) {
  module.exports = (options) => new Melcloudhome(options);
} else {
  (() => new Melcloudhome())();
}
//# sourceMappingURL=main.js.map
