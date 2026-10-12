/*
 * MELCloud Home endpoints and protocol constants (see docs/api.md sections 1-3).
 * Based on the reverse-engineering work of https://github.com/andrew-blake/melcloudhome (MIT).
 */

/** Base URLs of the MELCloud Home services */
export interface Endpoints {
    /** IdentityServer (OAuth) */
    auth: string;
    /** Mobile BFF REST API */
    api: string;
    /** Lambda that issues the WebSocket credential */
    wsHash: string;
    /** WebSocket host */
    ws: string;
}

export const DEFAULT_ENDPOINTS: Readonly<Endpoints> = Object.freeze({
    auth: 'https://auth.melcloudhome.com',
    api: 'https://mobile.bff.melcloudhome.com',
    wsHash: 'https://6x2dgdulg7omjsxalnhmo4ynba0dcgwk.lambda-url.eu-west-1.on.aws/',
    ws: 'wss://ws.melcloudhome.com',
});

/** User agent of the official mobile app */
export const USER_AGENT = 'MonitorAndControl.App.Mobile/52 CFNetwork/3860.400.51 Darwin/25.3.0';

/** Browser-like user agent for the Cognito login form */
export const BROWSER_USER_AGENT =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76';

export const OAUTH_CLIENT_ID = 'homemobile';
export const OAUTH_REDIRECT_URI = 'melcloudhome://';
export const OAUTH_SCOPES = 'openid profile email offline_access IdentityServerApi';

/** Host suffix of the AWS Cognito login UI */
export const COGNITO_DOMAIN_SUFFIX = '.amazoncognito.com';

/** Access tokens are renewed this long before they expire */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** Fallback if the token response has no expires_in */
export const DEFAULT_TOKEN_LIFETIME_S = 3600;

/** Minimum spacing between two requests to the cloud (all hosts) */
export const MIN_REQUEST_INTERVAL_MS = 500;
/** HTTP timeout per request */
export const HTTP_TIMEOUT_MS = 30_000;
/** Maximum redirect hops during login */
export const MAX_REDIRECTS = 10;

export const PATH_CONTEXT = '/context';
export const PATH_ATA_CONTROL = '/monitor/ataunit/';
export const PATH_TELEMETRY_ENERGY = '/telemetry/telemetry/energy/';
export const PATH_TELEMETRY_ACTUAL = '/telemetry/telemetry/actual/';
export const PATH_TREND_SUMMARY = '/report/v1/trendsummary';
