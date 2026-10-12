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
var constants_exports = {};
__export(constants_exports, {
  BROWSER_USER_AGENT: () => BROWSER_USER_AGENT,
  COGNITO_DOMAIN_SUFFIX: () => COGNITO_DOMAIN_SUFFIX,
  DEFAULT_ENDPOINTS: () => DEFAULT_ENDPOINTS,
  DEFAULT_TOKEN_LIFETIME_S: () => DEFAULT_TOKEN_LIFETIME_S,
  HTTP_TIMEOUT_MS: () => HTTP_TIMEOUT_MS,
  MAX_REDIRECTS: () => MAX_REDIRECTS,
  MIN_REQUEST_INTERVAL_MS: () => MIN_REQUEST_INTERVAL_MS,
  OAUTH_CLIENT_ID: () => OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI: () => OAUTH_REDIRECT_URI,
  OAUTH_SCOPES: () => OAUTH_SCOPES,
  PATH_ATA_CONTROL: () => PATH_ATA_CONTROL,
  PATH_CONTEXT: () => PATH_CONTEXT,
  PATH_TELEMETRY_ACTUAL: () => PATH_TELEMETRY_ACTUAL,
  PATH_TELEMETRY_ENERGY: () => PATH_TELEMETRY_ENERGY,
  PATH_TREND_SUMMARY: () => PATH_TREND_SUMMARY,
  TOKEN_REFRESH_MARGIN_MS: () => TOKEN_REFRESH_MARGIN_MS,
  USER_AGENT: () => USER_AGENT
});
module.exports = __toCommonJS(constants_exports);
const DEFAULT_ENDPOINTS = Object.freeze({
  auth: "https://auth.melcloudhome.com",
  api: "https://mobile.bff.melcloudhome.com",
  wsHash: "https://6x2dgdulg7omjsxalnhmo4ynba0dcgwk.lambda-url.eu-west-1.on.aws/",
  ws: "wss://ws.melcloudhome.com"
});
const USER_AGENT = "MonitorAndControl.App.Mobile/52 CFNetwork/3860.400.51 Darwin/25.3.0";
const BROWSER_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76";
const OAUTH_CLIENT_ID = "homemobile";
const OAUTH_REDIRECT_URI = "melcloudhome://";
const OAUTH_SCOPES = "openid profile email offline_access IdentityServerApi";
const COGNITO_DOMAIN_SUFFIX = ".amazoncognito.com";
const TOKEN_REFRESH_MARGIN_MS = 6e4;
const DEFAULT_TOKEN_LIFETIME_S = 3600;
const MIN_REQUEST_INTERVAL_MS = 500;
const HTTP_TIMEOUT_MS = 3e4;
const MAX_REDIRECTS = 10;
const PATH_CONTEXT = "/context";
const PATH_ATA_CONTROL = "/monitor/ataunit/";
const PATH_TELEMETRY_ENERGY = "/telemetry/telemetry/energy/";
const PATH_TELEMETRY_ACTUAL = "/telemetry/telemetry/actual/";
const PATH_TREND_SUMMARY = "/report/v1/trendsummary";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BROWSER_USER_AGENT,
  COGNITO_DOMAIN_SUFFIX,
  DEFAULT_ENDPOINTS,
  DEFAULT_TOKEN_LIFETIME_S,
  HTTP_TIMEOUT_MS,
  MAX_REDIRECTS,
  MIN_REQUEST_INTERVAL_MS,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPES,
  PATH_ATA_CONTROL,
  PATH_CONTEXT,
  PATH_TELEMETRY_ACTUAL,
  PATH_TELEMETRY_ENERGY,
  PATH_TREND_SUMMARY,
  TOKEN_REFRESH_MARGIN_MS,
  USER_AGENT
});
//# sourceMappingURL=constants.js.map
