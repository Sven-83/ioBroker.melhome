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
var auth_exports = {};
__export(auth_exports, {
  AuthClient: () => AuthClient,
  TokenManager: () => TokenManager,
  extractAuthCode: () => extractAuthCode,
  extractCallbackQuery: () => extractCallbackQuery,
  extractCsrfToken: () => extractCsrfToken,
  generatePkce: () => generatePkce
});
module.exports = __toCommonJS(auth_exports);
var import_node_crypto = require("node:crypto");
var import_tough_cookie = require("tough-cookie");
var import_constants = require("./constants");
var import_errors = require("./errors");
const REDIRECT_STATUS = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
function generatePkce() {
  const verifier = (0, import_node_crypto.randomBytes)(32).toString("base64url");
  const challenge = (0, import_node_crypto.createHash)("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
function extractCsrfToken(html) {
  const patterns = [
    /<input[^>]+name="_csrf"[^>]+value="([^"]+)"/i,
    /<input[^>]+value="([^"]+)"[^>]+name="_csrf"/i,
    /name="_csrf"\s+value="([^"]+)"/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      return match[1];
    }
  }
  return void 0;
}
function extractAuthCode(text) {
  const match = /[?&]code=([^&"'\s<>]+)/.exec(text.replace(/&amp;/g, "&"));
  return match ? safeDecode(match[1]) : void 0;
}
function extractCallbackQuery(html) {
  const match = /\/connect\/authorize\/callback\?([^"'\s<>]+)/.exec(html);
  return match ? match[1].replace(/&amp;/g, "&") : void 0;
}
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function isCognitoHost(url) {
  try {
    return new URL(url).hostname.endsWith(import_constants.COGNITO_DOMAIN_SUFFIX);
  } catch {
    return false;
  }
}
class AuthClient {
  http;
  endpoints;
  now;
  /** Kept between logins: an existing IdentityServer session shortens the next login */
  jar = new import_tough_cookie.CookieJar();
  /**
   * @param http - Shared transport
   * @param options - Endpoint and clock overrides (tests)
   * @param options.endpoints - Service URLs
   * @param options.now - Clock
   */
  constructor(http, options = {}) {
    var _a, _b;
    this.http = http;
    this.endpoints = (_a = options.endpoints) != null ? _a : import_constants.DEFAULT_ENDPOINTS;
    this.now = (_b = options.now) != null ? _b : Date.now;
  }
  /**
   * Full login with e-mail and password.
   *
   * @param credentials - MELCloud Home account
   */
  async login(credentials) {
    var _a;
    const pkce = generatePkce();
    const state = (0, import_node_crypto.randomBytes)(16).toString("base64url");
    const par = await this.send(`${this.endpoints.auth}/connect/par`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        response_type: "code",
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        client_id: import_constants.OAUTH_CLIENT_ID,
        scope: import_constants.OAUTH_SCOPES,
        redirect_uri: import_constants.OAUTH_REDIRECT_URI
      }).toString()
    });
    this.throwOnServerError(par);
    if (par.status !== 201) {
      throw new import_errors.LoginFlowError(`Login step PAR failed (HTTP ${par.status})`);
    }
    const requestUri = (_a = parseJsonObject(par.body)) == null ? void 0 : _a.request_uri;
    if (typeof requestUri !== "string" || !requestUri) {
      throw new import_errors.LoginFlowError("Login step PAR returned no request_uri");
    }
    const authorizeUrl = `${this.endpoints.auth}/connect/authorize?${new URLSearchParams({
      client_id: import_constants.OAUTH_CLIENT_ID,
      request_uri: requestUri
    }).toString()}`;
    const authorize = await this.follow(authorizeUrl, { method: "GET" });
    this.throwOnServerError(authorize);
    let code = await this.codeFromShortcut(authorize);
    if (!code) {
      code = await this.submitCredentials(authorize, credentials);
    }
    return this.requestToken(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: import_constants.OAUTH_REDIRECT_URI,
        code_verifier: pkce.verifier,
        client_id: import_constants.OAUTH_CLIENT_ID
      },
      false
    );
  }
  /**
   * Exchanges a refresh token for new tokens. The refresh token rotates and is single-use.
   *
   * @param refreshToken - Current refresh token
   */
  async refresh(refreshToken) {
    return this.requestToken(
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: import_constants.OAUTH_CLIENT_ID
      },
      true,
      refreshToken
    );
  }
  /** Forgets the IdentityServer session cookies */
  async clearSession() {
    await this.jar.removeAllCookies();
  }
  /**
   * Handles the shortcut when the IdentityServer still has a session and skips Cognito.
   *
   * @param authorize - Result of the authorize request
   */
  async codeFromShortcut(authorize) {
    var _a;
    if (authorize.appRedirect) {
      const code2 = extractAuthCode(authorize.appRedirect);
      if (!code2) {
        throw new import_errors.LoginFlowError("Login redirect to the app contained no code");
      }
      return code2;
    }
    if (isCognitoHost(authorize.url)) {
      return void 0;
    }
    const code = (_a = extractAuthCode(authorize.url)) != null ? _a : extractAuthCode(authorize.body);
    if (code) {
      return code;
    }
    const callback = extractCallbackQuery(authorize.body);
    if (callback) {
      return this.followCallback(callback);
    }
    throw new import_errors.LoginFlowError(`Login step authorize ended unexpectedly (HTTP ${authorize.status})`);
  }
  /**
   * Steps 3 + 4: posts the credentials to Cognito and resolves the authorization code.
   *
   * @param loginPage - Cognito login page
   * @param credentials - MELCloud Home account
   */
  async submitCredentials(loginPage, credentials) {
    var _a;
    if (!new URL(loginPage.url).pathname.includes("/login")) {
      throw new import_errors.LoginFlowError("Login step authorize did not reach the login page");
    }
    const csrf = extractCsrfToken(loginPage.body);
    if (!csrf) {
      throw new import_errors.LoginFlowError("Login page has no CSRF token - the MELCloud Home login page may have changed");
    }
    const origin = new URL(loginPage.url).origin;
    const result = await this.follow(loginPage.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": import_constants.BROWSER_USER_AGENT,
        Origin: origin,
        Referer: loginPage.url
      },
      body: new URLSearchParams({
        _csrf: csrf,
        username: credentials.email,
        password: credentials.password,
        cognitoAsfData: ""
      }).toString()
    });
    this.throwOnServerError(result);
    if (result.appRedirect) {
      const code2 = extractAuthCode(result.appRedirect);
      if (code2) {
        return code2;
      }
      throw new import_errors.LoginFlowError("Login redirect to the app contained no code");
    }
    if (isCognitoHost(result.url)) {
      throw new import_errors.CredentialsRejectedError();
    }
    const callback = extractCallbackQuery(result.body);
    if (callback) {
      return this.followCallback(callback);
    }
    const code = (_a = extractAuthCode(result.url)) != null ? _a : extractAuthCode(result.body);
    if (code) {
      return code;
    }
    throw new import_errors.LoginFlowError(`Login step credentials ended unexpectedly (HTTP ${result.status})`);
  }
  /**
   * Follows the IdentityServer callback until the redirect to melcloudhome:// reveals the code.
   *
   * @param query - Query string of the callback URL
   */
  async followCallback(query) {
    var _a;
    let url = `${this.endpoints.auth}/connect/authorize/callback?${query}`;
    for (let hop = 0; hop < 2; hop++) {
      const result = await this.send(url, { method: "GET" });
      this.throwOnServerError(result);
      const location = (_a = result.headers.get("location")) != null ? _a : "";
      if (location.startsWith(import_constants.OAUTH_REDIRECT_URI)) {
        const code = extractAuthCode(location);
        if (code) {
          return code;
        }
        break;
      }
      if (!location || location === "/") {
        break;
      }
      url = new URL(location, url).href;
    }
    throw new import_errors.LoginFlowError("Login callback did not return an authorization code");
  }
  async requestToken(form, isRefresh, previousRefreshToken) {
    const result = await this.send(`${this.endpoints.auth}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString()
    });
    this.throwOnServerError(result);
    if (result.status !== 200) {
      if (isRefresh) {
        throw new import_errors.TokenRejectedError(`Refresh token rejected (HTTP ${result.status})`);
      }
      throw new import_errors.LoginFlowError(`Token exchange failed (HTTP ${result.status})`);
    }
    const data = parseJsonObject(result.body);
    const accessToken = data == null ? void 0 : data.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      const message = "Token response contains no access token";
      throw isRefresh ? new import_errors.TokenRejectedError(message) : new import_errors.LoginFlowError(message);
    }
    const expiresIn = typeof (data == null ? void 0 : data.expires_in) === "number" && data.expires_in > 0 ? data.expires_in : import_constants.DEFAULT_TOKEN_LIFETIME_S;
    const refreshToken = typeof (data == null ? void 0 : data.refresh_token) === "string" ? data.refresh_token : previousRefreshToken;
    return { accessToken, refreshToken, expiresAt: this.now() + expiresIn * 1e3 };
  }
  throwOnServerError(result) {
    if (result.status >= 500) {
      throw new import_errors.ServiceUnavailableError(result.status);
    }
  }
  /**
   * Follows redirects manually: fetch cannot follow to melcloudhome:// and must keep cookies.
   *
   * @param url - Start URL
   * @param init - Request options of the first request
   */
  async follow(url, init) {
    let currentUrl = url;
    let currentInit = init;
    for (let hop = 0; hop <= import_constants.MAX_REDIRECTS; hop++) {
      const result = await this.send(currentUrl, currentInit);
      const location = result.headers.get("location");
      if (!REDIRECT_STATUS.has(result.status) || !location) {
        return result;
      }
      if (location.startsWith(import_constants.OAUTH_REDIRECT_URI)) {
        return { ...result, appRedirect: location };
      }
      const nextUrl = new URL(location, currentUrl).href;
      const keepMethod = result.status === 307 || result.status === 308;
      currentInit = keepMethod ? currentInit : { method: "GET", headers: withoutContentType(currentInit.headers) };
      currentUrl = nextUrl;
    }
    throw new import_errors.LoginFlowError("Too many redirects during login");
  }
  /**
   * One request with cookie handling, without following redirects.
   *
   * @param url - Absolute URL
   * @param init - Request options
   */
  async send(url, init) {
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", import_constants.USER_AGENT);
    }
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json, text/html;q=0.9, */*;q=0.8");
    }
    const cookies = await this.jar.getCookieString(url);
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    const { response, body } = await this.http.request(url, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      try {
        await this.jar.setCookie(cookie, url, { ignoreError: true });
      } catch {
      }
    }
    return { url, status: response.status, headers: response.headers, body };
  }
}
function withoutContentType(headers) {
  const result = new Headers(headers);
  result.delete("Content-Type");
  return result;
}
function parseJsonObject(text) {
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : void 0;
  } catch {
    return void 0;
  }
}
class TokenManager {
  auth;
  credentials;
  log;
  now;
  tokens;
  pending;
  /**
   * @param auth - Login/refresh implementation
   * @param credentials - MELCloud Home account
   * @param log - Adapter logger
   * @param now - Clock
   */
  constructor(auth, credentials, log, now = Date.now) {
    this.auth = auth;
    this.credentials = credentials;
    this.log = log;
    this.now = now;
  }
  /** Returns a valid access token, renewing it if necessary */
  async getAccessToken() {
    if (this.tokens && this.now() < this.tokens.expiresAt - import_constants.TOKEN_REFRESH_MARGIN_MS) {
      return this.tokens.accessToken;
    }
    if (!this.pending) {
      this.pending = this.renew().finally(() => {
        this.pending = void 0;
      });
    }
    return this.pending;
  }
  /** Marks the access token as expired (after HTTP 401) - the next call refreshes */
  invalidateAccessToken() {
    if (this.tokens) {
      this.tokens = { ...this.tokens, expiresAt: 0 };
    }
  }
  /** Drops all tokens - the next call performs a full login */
  forceLogin() {
    this.tokens = void 0;
  }
  async renew() {
    var _a;
    const refreshToken = (_a = this.tokens) == null ? void 0 : _a.refreshToken;
    if (refreshToken) {
      try {
        this.tokens = await this.auth.refresh(refreshToken);
        this.log.debug("Access token refreshed");
        return this.tokens.accessToken;
      } catch (error) {
        if (!(error instanceof import_errors.TokenRejectedError)) {
          throw error;
        }
        this.tokens = void 0;
        this.log.info("MELCloud Home session expired - logging in again");
      }
    }
    try {
      this.tokens = await this.auth.login(this.credentials);
    } catch (error) {
      if (error instanceof import_errors.CredentialsRejectedError || error instanceof import_errors.LoginFlowError) {
        await this.auth.clearSession().catch(() => void 0);
      }
      throw error;
    }
    this.log.debug("Logged in to MELCloud Home");
    return this.tokens.accessToken;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthClient,
  TokenManager,
  extractAuthCode,
  extractCallbackQuery,
  extractCsrfToken,
  generatePkce
});
//# sourceMappingURL=auth.js.map
