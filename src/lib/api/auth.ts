/*
 * MELCloud Home authentication (docs/api.md section 2):
 * OAuth 2.0 Authorization Code + PKCE via IdentityServer, credentials posted to the AWS Cognito login form.
 * Ported from https://github.com/andrew-blake/melcloudhome (MIT).
 *
 * Tokens live in memory only. Nothing in here may log tokens, codes, cookies, the e-mail or the password.
 */

import { createHash, randomBytes } from 'node:crypto';
import { CookieJar } from 'tough-cookie';
import {
    BROWSER_USER_AGENT,
    COGNITO_DOMAIN_SUFFIX,
    DEFAULT_ENDPOINTS,
    DEFAULT_TOKEN_LIFETIME_S,
    MAX_REDIRECTS,
    OAUTH_CLIENT_ID,
    OAUTH_REDIRECT_URI,
    OAUTH_SCOPES,
    TOKEN_REFRESH_MARGIN_MS,
    USER_AGENT,
    type Endpoints,
} from './constants';
import {
    CredentialsRejectedError,
    LoginFlowError,
    RateLimitedError,
    ServiceUnavailableError,
    TokenRejectedError,
} from './errors';
import { parseRetryAfter, type HttpTransport, type Logger } from './http';

/** OAuth tokens kept in memory */
export interface TokenSet {
    /** Bearer token for the REST API */
    accessToken: string;
    /** Rotating, single-use refresh token */
    refreshToken: string | undefined;
    /** Expiry as epoch ms */
    expiresAt: number;
}

/** MELCloud Home account */
export interface Credentials {
    /** Login e-mail */
    email: string;
    /** Login password */
    password: string;
}

interface HttpResult {
    url: string;
    status: number;
    headers: Headers;
    body: string;
    /** Set when a redirect pointed to the app scheme (melcloudhome://) */
    appRedirect?: string;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Generates a PKCE verifier/challenge pair (S256).
 */
export function generatePkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

/**
 * Extracts the CSRF token from the Cognito login page (attribute order varies).
 *
 * @param html - Login page
 */
export function extractCsrfToken(html: string): string | undefined {
    const patterns = [
        /<input[^>]+name="_csrf"[^>]+value="([^"]+)"/i,
        /<input[^>]+value="([^"]+)"[^>]+name="_csrf"/i,
        /name="_csrf"\s+value="([^"]+)"/i,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(html);
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

/**
 * Extracts an authorization code from a URL or page.
 *
 * @param text - URL or HTML
 */
export function extractAuthCode(text: string): string | undefined {
    const match = /[?&]code=([^&"'\s<>]+)/.exec(text.replace(/&amp;/g, '&'));
    return match ? safeDecode(match[1]) : undefined;
}

/**
 * Extracts the query string of the IdentityServer callback link from a page.
 *
 * @param html - Page returned after the credential post
 */
export function extractCallbackQuery(html: string): string | undefined {
    const match = /\/connect\/authorize\/callback\?([^"'\s<>]+)/.exec(html);
    return match ? match[1].replace(/&amp;/g, '&') : undefined;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function isCognitoHost(url: string): boolean {
    try {
        return new URL(url).hostname.endsWith(COGNITO_DOMAIN_SUFFIX);
    } catch {
        return false;
    }
}

/**
 * Performs login and token refresh against the MELCloud Home identity provider.
 */
export class AuthClient {
    private readonly http: HttpTransport;
    private readonly endpoints: Endpoints;
    private readonly now: () => number;
    /** Kept between logins: an existing IdentityServer session shortens the next login */
    private readonly jar = new CookieJar();

    /**
     * @param http - Shared transport
     * @param options - Endpoint and clock overrides (tests)
     * @param options.endpoints - Service URLs
     * @param options.now - Clock
     */
    public constructor(http: HttpTransport, options: { endpoints?: Endpoints; now?: () => number } = {}) {
        this.http = http;
        this.endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;
        this.now = options.now ?? Date.now;
    }

    /**
     * Full login with e-mail and password.
     *
     * @param credentials - MELCloud Home account
     */
    public async login(credentials: Credentials): Promise<TokenSet> {
        const pkce = generatePkce();
        const state = randomBytes(16).toString('base64url');

        // Step 1: Pushed Authorization Request
        const par = await this.send(`${this.endpoints.auth}/connect/par`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                response_type: 'code',
                state,
                code_challenge: pkce.challenge,
                code_challenge_method: 'S256',
                client_id: OAUTH_CLIENT_ID,
                scope: OAUTH_SCOPES,
                redirect_uri: OAUTH_REDIRECT_URI,
            }).toString(),
        });
        this.throwOnServerError(par);
        if (par.status !== 201) {
            throw new LoginFlowError(`Login step PAR failed (HTTP ${par.status})`);
        }
        const requestUri = parseJsonObject(par.body)?.request_uri;
        if (typeof requestUri !== 'string' || !requestUri) {
            throw new LoginFlowError('Login step PAR returned no request_uri');
        }

        // Step 2: authorize -> Cognito login page, or directly a code if a session still exists
        const authorizeUrl = `${this.endpoints.auth}/connect/authorize?${new URLSearchParams({
            client_id: OAUTH_CLIENT_ID,
            request_uri: requestUri,
        }).toString()}`;
        const authorize = await this.follow(authorizeUrl, { method: 'GET' });
        this.throwOnServerError(authorize);

        let code = await this.codeFromShortcut(authorize);
        if (!code) {
            code = await this.submitCredentials(authorize, credentials);
        }

        // Step 5: token exchange
        return this.requestToken(
            {
                grant_type: 'authorization_code',
                code,
                redirect_uri: OAUTH_REDIRECT_URI,
                code_verifier: pkce.verifier,
                client_id: OAUTH_CLIENT_ID,
            },
            false,
        );
    }

    /**
     * Exchanges a refresh token for new tokens. The refresh token rotates and is single-use.
     *
     * @param refreshToken - Current refresh token
     */
    public async refresh(refreshToken: string): Promise<TokenSet> {
        return this.requestToken(
            {
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: OAUTH_CLIENT_ID,
            },
            true,
            refreshToken,
        );
    }

    /** Forgets the IdentityServer session cookies */
    public async clearSession(): Promise<void> {
        await this.jar.removeAllCookies();
    }

    /**
     * Handles the shortcut when the IdentityServer still has a session and skips Cognito.
     *
     * @param authorize - Result of the authorize request
     */
    private async codeFromShortcut(authorize: HttpResult): Promise<string | undefined> {
        if (authorize.appRedirect) {
            const code = extractAuthCode(authorize.appRedirect);
            if (!code) {
                throw new LoginFlowError('Login redirect to the app contained no code');
            }
            return code;
        }
        if (isCognitoHost(authorize.url)) {
            return undefined;
        }
        const code = extractAuthCode(authorize.url) ?? extractAuthCode(authorize.body);
        if (code) {
            return code;
        }
        const callback = extractCallbackQuery(authorize.body);
        if (callback) {
            return this.followCallback(callback);
        }
        throw new LoginFlowError(`Login step authorize ended unexpectedly (HTTP ${authorize.status})`);
    }

    /**
     * Steps 3 + 4: posts the credentials to Cognito and resolves the authorization code.
     *
     * @param loginPage - Cognito login page
     * @param credentials - MELCloud Home account
     */
    private async submitCredentials(loginPage: HttpResult, credentials: Credentials): Promise<string> {
        if (!new URL(loginPage.url).pathname.includes('/login')) {
            throw new LoginFlowError('Login step authorize did not reach the login page');
        }
        const csrf = extractCsrfToken(loginPage.body);
        if (!csrf) {
            throw new LoginFlowError('Login page has no CSRF token - the MELCloud Home login page may have changed');
        }
        const origin = new URL(loginPage.url).origin;
        const result = await this.follow(loginPage.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': BROWSER_USER_AGENT,
                Origin: origin,
                Referer: loginPage.url,
            },
            body: new URLSearchParams({
                _csrf: csrf,
                username: credentials.email,
                password: credentials.password,
                cognitoAsfData: '',
            }).toString(),
        });
        this.throwOnServerError(result);

        if (result.appRedirect) {
            const code = extractAuthCode(result.appRedirect);
            if (code) {
                return code;
            }
            throw new LoginFlowError('Login redirect to the app contained no code');
        }
        if (isCognitoHost(result.url)) {
            // Cognito shows the login form again
            throw new CredentialsRejectedError();
        }
        const callback = extractCallbackQuery(result.body);
        if (callback) {
            return this.followCallback(callback);
        }
        const code = extractAuthCode(result.url) ?? extractAuthCode(result.body);
        if (code) {
            return code;
        }
        throw new LoginFlowError(`Login step credentials ended unexpectedly (HTTP ${result.status})`);
    }

    /**
     * Follows the IdentityServer callback until the redirect to melcloudhome:// reveals the code.
     *
     * @param query - Query string of the callback URL
     */
    private async followCallback(query: string): Promise<string> {
        let url = `${this.endpoints.auth}/connect/authorize/callback?${query}`;
        for (let hop = 0; hop < 2; hop++) {
            const result = await this.send(url, { method: 'GET' });
            this.throwOnServerError(result);
            const location = result.headers.get('location') ?? '';
            if (location.startsWith(OAUTH_REDIRECT_URI)) {
                const code = extractAuthCode(location);
                if (code) {
                    return code;
                }
                break;
            }
            if (!location || location === '/') {
                break;
            }
            url = new URL(location, url).href;
        }
        throw new LoginFlowError('Login callback did not return an authorization code');
    }

    private async requestToken(
        form: Record<string, string>,
        isRefresh: boolean,
        previousRefreshToken?: string,
    ): Promise<TokenSet> {
        const result = await this.send(`${this.endpoints.auth}/connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(form).toString(),
        });
        this.throwOnServerError(result);
        if (result.status !== 200) {
            if (isRefresh) {
                throw new TokenRejectedError(`Refresh token rejected (HTTP ${result.status})`);
            }
            throw new LoginFlowError(`Token exchange failed (HTTP ${result.status})`);
        }
        const data = parseJsonObject(result.body);
        const accessToken = data?.access_token;
        if (typeof accessToken !== 'string' || !accessToken) {
            const message = 'Token response contains no access token';
            throw isRefresh ? new TokenRejectedError(message) : new LoginFlowError(message);
        }
        const expiresIn =
            typeof data?.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : DEFAULT_TOKEN_LIFETIME_S;
        const refreshToken = typeof data?.refresh_token === 'string' ? data.refresh_token : previousRefreshToken;
        return { accessToken, refreshToken, expiresAt: this.now() + expiresIn * 1000 };
    }

    private throwOnServerError(result: HttpResult): void {
        if (result.status === 429) {
            throw new RateLimitedError(parseRetryAfter(result.headers.get('retry-after'), this.now()));
        }
        if (result.status >= 500) {
            throw new ServiceUnavailableError(result.status);
        }
    }

    /**
     * Follows redirects manually: fetch cannot follow to melcloudhome:// and must keep cookies.
     *
     * @param url - Start URL
     * @param init - Request options of the first request
     */
    private async follow(url: string, init: RequestInit): Promise<HttpResult> {
        let currentUrl = url;
        let currentInit = init;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const result = await this.send(currentUrl, currentInit);
            const location = result.headers.get('location');
            if (!REDIRECT_STATUS.has(result.status) || !location) {
                return result;
            }
            if (location.startsWith(OAUTH_REDIRECT_URI)) {
                return { ...result, appRedirect: location };
            }
            const nextUrl = new URL(location, currentUrl).href;
            const keepMethod = result.status === 307 || result.status === 308;
            currentInit = keepMethod
                ? currentInit
                : { method: 'GET', headers: withoutContentType(currentInit.headers) };
            currentUrl = nextUrl;
        }
        throw new LoginFlowError('Too many redirects during login');
    }

    /**
     * One request with cookie handling, without following redirects.
     *
     * @param url - Absolute URL
     * @param init - Request options
     */
    private async send(url: string, init: RequestInit): Promise<HttpResult> {
        const headers = new Headers(init.headers);
        if (!headers.has('User-Agent')) {
            headers.set('User-Agent', USER_AGENT);
        }
        if (!headers.has('Accept')) {
            headers.set('Accept', 'application/json, text/html;q=0.9, */*;q=0.8');
        }
        const cookies = await this.jar.getCookieString(url);
        if (cookies) {
            headers.set('Cookie', cookies);
        }
        const { response, body } = await this.http.request(url, { ...init, headers, redirect: 'manual' });
        for (const cookie of response.headers.getSetCookie()) {
            try {
                await this.jar.setCookie(cookie, url, { ignoreError: true });
            } catch {
                // invalid cookies are irrelevant for the flow
            }
        }
        return { url, status: response.status, headers: response.headers, body };
    }
}

function withoutContentType(headers: RequestInit['headers']): Headers {
    const result = new Headers(headers);
    result.delete('Content-Type');
    return result;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
    try {
        const data: unknown = JSON.parse(text);
        return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Keeps the tokens and renews them on demand: refresh first, full login only if the
 * refresh token is rejected (docs/api.md section 2.2). Renewals never run in parallel.
 */
export class TokenManager {
    private readonly auth: AuthClient;
    private readonly credentials: Credentials;
    private readonly log: Logger;
    private readonly now: () => number;
    private tokens: TokenSet | undefined;
    private pending: Promise<string> | undefined;

    /**
     * @param auth - Login/refresh implementation
     * @param credentials - MELCloud Home account
     * @param log - Adapter logger
     * @param now - Clock
     */
    public constructor(auth: AuthClient, credentials: Credentials, log: Logger, now: () => number = Date.now) {
        this.auth = auth;
        this.credentials = credentials;
        this.log = log;
        this.now = now;
    }

    /** Returns a valid access token, renewing it if necessary */
    public async getAccessToken(): Promise<string> {
        if (this.tokens && this.now() < this.tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
            return this.tokens.accessToken;
        }
        if (!this.pending) {
            this.pending = this.renew().finally(() => {
                this.pending = undefined;
            });
        }
        return this.pending;
    }

    /** Marks the access token as expired (after HTTP 401) - the next call refreshes */
    public invalidateAccessToken(): void {
        if (this.tokens) {
            this.tokens = { ...this.tokens, expiresAt: 0 };
        }
    }

    /** Drops all tokens - the next call performs a full login */
    public forceLogin(): void {
        this.tokens = undefined;
    }

    private async renew(): Promise<string> {
        const refreshToken = this.tokens?.refreshToken;
        if (refreshToken) {
            try {
                this.tokens = await this.auth.refresh(refreshToken);
                this.log.debug('Access token refreshed');
                return this.tokens.accessToken;
            } catch (error) {
                if (!(error instanceof TokenRejectedError)) {
                    // outage or network problem: keep the refresh token and try again later
                    throw error;
                }
                this.tokens = undefined;
                this.log.info('MELCloud Home session expired - logging in again');
            }
        }
        try {
            this.tokens = await this.auth.login(this.credentials);
        } catch (error) {
            if (error instanceof CredentialsRejectedError || error instanceof LoginFlowError) {
                // start the next attempt without a possibly broken IdentityServer session
                await this.auth.clearSession().catch(() => undefined);
            }
            throw error;
        }
        this.log.debug('Logged in to MELCloud Home');
        return this.tokens.accessToken;
    }
}
