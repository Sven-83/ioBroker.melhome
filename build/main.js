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
const MIN_POLL_INTERVAL_S = 60;
class Melcloudhome extends utils.Adapter {
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
    await this.setState("info.connection", false, true);
    if (!this.config.email || !this.config.password) {
      this.log.warn("No MELCloud Home credentials configured - please enter e-mail and password in the instance settings");
      return;
    }
    const pollInterval = Number(this.config.pollInterval);
    if (!Number.isFinite(pollInterval) || pollInterval < MIN_POLL_INTERVAL_S) {
      this.log.warn(`Polling interval ${this.config.pollInterval} s is invalid or too low - using ${MIN_POLL_INTERVAL_S} s`);
      this.config.pollInterval = MIN_POLL_INTERVAL_S;
    }
    this.log.info(
      `Starting (polling every ${this.config.pollInterval} s, real-time ${this.config.realtime ? "enabled" : "disabled"})`
    );
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
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
