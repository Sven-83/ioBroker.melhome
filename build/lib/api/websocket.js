"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var websocket_exports = {};
__export(websocket_exports, {
  PING_INTERVAL_MS: () => PING_INTERVAL_MS,
  PONG_TIMEOUT_MS: () => PONG_TIMEOUT_MS,
  QUICK_RECONNECT_MS: () => QUICK_RECONNECT_MS,
  RECONNECT_INITIAL_MS: () => RECONNECT_INITIAL_MS,
  RECONNECT_MAX_MS: () => RECONNECT_MAX_MS,
  RealtimeConnection: () => RealtimeConnection,
  STABLE_SESSION_MS: () => STABLE_SESSION_MS,
  parseFrame: () => parseFrame
});
module.exports = __toCommonJS(websocket_exports);
var import_ws = __toESM(require("ws"));
var import_constants = require("./constants");
var import_errors = require("./errors");
const SECOND = 1e3;
const PING_INTERVAL_MS = 30 * SECOND;
const PONG_TIMEOUT_MS = 10 * SECOND;
const RECONNECT_INITIAL_MS = 5 * SECOND;
const RECONNECT_MAX_MS = 300 * SECOND;
const STABLE_SESSION_MS = 60 * SECOND;
const QUICK_RECONNECT_MS = 1 * SECOND;
const HANDSHAKE_TIMEOUT_MS = 15 * SECOND;
const JITTER = 0.2;
const UNIT_EVENTS = /* @__PURE__ */ new Set(["unitStateChanged", "unitCommunicationLost", "unitCommunicationRestored"]);
function defaultSocket(url) {
  return new import_ws.default(url, {
    headers: { "User-Agent": import_constants.USER_AGENT },
    handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
    perMessageDeflate: true
  });
}
function parseFrame(text, onUnknown) {
  var _a;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    onUnknown == null ? void 0 : onUnknown("<invalid JSON>");
    return [];
  }
  const events = [];
  for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message;
    const type = typeof record.messageType === "string" ? record.messageType : "";
    if (!UNIT_EVENTS.has(type)) {
      onUnknown == null ? void 0 : onUnknown(type || "<no messageType>");
      continue;
    }
    const data = (_a = record.Data) != null ? _a : record.data;
    const unitId = data && typeof data === "object" ? data.id : void 0;
    if (typeof unitId === "string" && unitId) {
      events.push({ unitId, type });
    }
  }
  return events;
}
class RealtimeConnection {
  options;
  wsUrl;
  createSocket;
  now;
  random;
  unknownLogged = /* @__PURE__ */ new Set();
  running = false;
  /** Increases with every start/stop, so late callbacks of an old run are ignored */
  generation = 0;
  socket;
  connected = false;
  openedAt = 0;
  attempt = 0;
  reconnectTimer;
  pingTimer;
  pongTimer;
  everConnected = false;
  lossLogged = false;
  /** @param options - Dependencies and callbacks */
  constructor(options) {
    var _a, _b, _c, _d;
    this.options = options;
    this.wsUrl = (_a = options.wsUrl) != null ? _a : import_constants.DEFAULT_ENDPOINTS.ws;
    this.createSocket = (_b = options.createSocket) != null ? _b : defaultSocket;
    this.now = (_c = options.now) != null ? _c : Date.now;
    this.random = (_d = options.random) != null ? _d : Math.random;
  }
  /** True while the socket is open */
  get isConnected() {
    return this.connected;
  }
  /** Opens the connection (no-op if already started) */
  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.generation++;
    this.attempt = 0;
    void this.connect(this.generation);
  }
  /** Closes the connection and cancels all timers; start() may be called again later */
  stop() {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.generation++;
    this.clearTimer("reconnectTimer");
    this.dropSocket();
  }
  async connect(generation) {
    let hash;
    try {
      hash = await this.options.getHash();
    } catch (error) {
      if (generation !== this.generation || error instanceof import_errors.AbortedError) {
        return;
      }
      this.options.log.debug(`Real-time credential not available: ${(0, import_errors.describeError)(error)}`);
      this.scheduleReconnect(false);
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    let socket;
    try {
      socket = this.createSocket(`${this.wsUrl}/?hash=${encodeURIComponent(hash)}`);
    } catch (error) {
      this.options.log.debug(`Real-time connection could not be created: ${(0, import_errors.describeError)(error)}`);
      this.scheduleReconnect(false);
      return;
    }
    this.socket = socket;
    socket.on("open", () => {
      if (this.socket !== socket) {
        return;
      }
      this.openedAt = this.now();
      this.setConnected(true);
      if (!this.everConnected) {
        this.everConnected = true;
        this.options.log.info("Real-time connection established");
      } else if (this.lossLogged) {
        this.options.log.info("Real-time connection restored");
      } else {
        this.options.log.debug("Real-time connection reopened");
      }
      this.lossLogged = false;
      this.schedulePing();
    });
    socket.on("message", (data) => {
      if (this.socket === socket) {
        this.onMessage(data);
      }
    });
    socket.on("pong", () => {
      if (this.socket === socket) {
        this.clearTimer("pongTimer");
      }
    });
    socket.on("error", (error) => {
      this.options.log.debug(`Real-time connection error: ${(0, import_errors.describeError)(error)}`);
    });
    socket.on("close", (code) => {
      if (this.socket !== socket) {
        return;
      }
      const stable = this.connected && this.now() - this.openedAt >= STABLE_SESSION_MS;
      this.dropSocket();
      this.options.log.debug(`Real-time connection closed (code ${code})`);
      if (this.running) {
        this.scheduleReconnect(stable);
      }
    });
  }
  onMessage(data) {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const events = parseFrame(text, (type) => {
      if (!this.unknownLogged.has(type) && this.unknownLogged.size < 50) {
        this.unknownLogged.add(type);
        this.options.log.debug(`Real-time message of type ${type} ignored`);
      }
    });
    for (const event of events) {
      this.options.log.debug(`Real-time event ${event.type} for unit ${event.unitId}`);
      this.options.onUnitEvent(event);
    }
  }
  schedulePing() {
    this.pingTimer = this.options.scheduler.setTimeout(() => {
      this.pingTimer = void 0;
      const socket = this.socket;
      if (!socket || !this.connected) {
        return;
      }
      try {
        socket.ping();
      } catch (error) {
        this.options.log.debug(`Real-time ping failed: ${(0, import_errors.describeError)(error)}`);
      }
      this.pongTimer = this.options.scheduler.setTimeout(() => {
        this.pongTimer = void 0;
        if (this.socket === socket) {
          this.options.log.debug("Real-time connection silent - reconnecting");
          socket.terminate();
        }
      }, PONG_TIMEOUT_MS);
      this.schedulePing();
    }, PING_INTERVAL_MS);
  }
  /**
   * @param afterStableSession - The closed session lasted long enough to count as normal operation
   */
  scheduleReconnect(afterStableSession) {
    if (!this.running) {
      return;
    }
    let delay;
    if (afterStableSession) {
      this.attempt = 0;
      delay = QUICK_RECONNECT_MS;
    } else {
      const base = Math.min(RECONNECT_INITIAL_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
      delay = Math.round(base * (1 - JITTER + 2 * JITTER * this.random()));
      this.attempt++;
      if (this.everConnected && !this.lossLogged) {
        this.lossLogged = true;
        this.options.log.info("Real-time connection lost - retrying in the background, polling continues");
      }
    }
    const generation = this.generation;
    this.clearTimer("reconnectTimer");
    this.reconnectTimer = this.options.scheduler.setTimeout(() => {
      this.reconnectTimer = void 0;
      if (generation === this.generation) {
        void this.connect(generation);
      }
    }, delay);
  }
  dropSocket() {
    this.clearTimer("pingTimer");
    this.clearTimer("pongTimer");
    const socket = this.socket;
    this.socket = void 0;
    if (socket) {
      socket.removeAllListeners();
      socket.on("error", () => void 0);
      try {
        socket.terminate();
      } catch {
      }
    }
    this.setConnected(false);
  }
  setConnected(connected) {
    if (this.connected === connected) {
      return;
    }
    this.connected = connected;
    Promise.resolve(this.options.onConnectionChange(connected)).catch((error) => {
      this.options.log.debug(`Real-time status update failed: ${(0, import_errors.describeError)(error)}`);
    });
  }
  clearTimer(name) {
    if (this[name] !== void 0) {
      this.options.scheduler.clearTimeout(this[name]);
      this[name] = void 0;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  QUICK_RECONNECT_MS,
  RECONNECT_INITIAL_MS,
  RECONNECT_MAX_MS,
  RealtimeConnection,
  STABLE_SESSION_MS,
  parseFrame
});
//# sourceMappingURL=websocket.js.map
