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
var errors_exports = {};
__export(errors_exports, {
  AbortedError: () => AbortedError,
  ApiError: () => ApiError,
  CredentialsRejectedError: () => CredentialsRejectedError,
  LoginFlowError: () => LoginFlowError,
  MelCloudHomeError: () => MelCloudHomeError,
  NetworkError: () => NetworkError,
  RateLimitedError: () => RateLimitedError,
  ServiceUnavailableError: () => ServiceUnavailableError,
  TokenRejectedError: () => TokenRejectedError,
  describeError: () => describeError,
  redact: () => redact,
  stripLineBreaks: () => stripLineBreaks
});
module.exports = __toCommonJS(errors_exports);
class MelCloudHomeError extends Error {
  /** @param message - Error message (secrets are redacted) */
  constructor(message) {
    super(redact(message));
    this.name = new.target.name;
  }
}
class NetworkError extends MelCloudHomeError {
}
class ServiceUnavailableError extends MelCloudHomeError {
  status;
  /** @param status - HTTP status */
  constructor(status) {
    super(`MELCloud Home service unavailable (HTTP ${status})`);
    this.status = status;
  }
}
class RateLimitedError extends MelCloudHomeError {
  /** Wait time requested by the server (Retry-After), if any */
  retryAfterMs;
  /** @param retryAfterMs - Wait time from the Retry-After header */
  constructor(retryAfterMs) {
    super(
      `MELCloud Home rate limit reached (HTTP 429)${retryAfterMs !== void 0 ? ` - retry after ${Math.ceil(retryAfterMs / 1e3)} s` : ""}`
    );
    this.retryAfterMs = retryAfterMs;
  }
}
class CredentialsRejectedError extends MelCloudHomeError {
  /** Fixed message */
  constructor() {
    super("MELCloud Home rejected the login credentials");
  }
}
class LoginFlowError extends MelCloudHomeError {
}
class TokenRejectedError extends MelCloudHomeError {
}
class ApiError extends MelCloudHomeError {
  status;
  /**
   * @param message - Error message
   * @param status - HTTP status, if any
   */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
class AbortedError extends MelCloudHomeError {
  /** Fixed message */
  constructor() {
    super("Request aborted");
  }
}
function redact(text) {
  return text.replace(
    /([?&#]|\b)(code|state|hash|request_uri|access_token|refresh_token|id_token|password|_csrf|code_verifier)=[^&\s"']*/gi,
    "$1$2=***"
  ).replace(/(Bearer\s+)[\w\-.~+/]+=*/gi, "$1***").replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "***@***");
}
const LINE_BREAKS = new RegExp(`\r
|[\r
${String.fromCharCode(133, 8232, 8233)}]`, "g");
function stripLineBreaks(value) {
  return String(value).replace(LINE_BREAKS, " ");
}
function describeError(error) {
  if (error instanceof MelCloudHomeError) {
    return error.message;
  }
  if (error instanceof Error) {
    return redact(stripLineBreaks(error.message));
  }
  return redact(stripLineBreaks(String(error)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AbortedError,
  ApiError,
  CredentialsRejectedError,
  LoginFlowError,
  MelCloudHomeError,
  NetworkError,
  RateLimitedError,
  ServiceUnavailableError,
  TokenRejectedError,
  describeError,
  redact,
  stripLineBreaks
});
//# sourceMappingURL=errors.js.map
