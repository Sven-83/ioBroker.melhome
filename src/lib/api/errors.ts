/*
 * Error classes of the API layer and helpers to keep secrets out of logs.
 *
 * The connection manager decides its retry strategy from the error class,
 * so every failure leaving the API layer must be one of these.
 */

/** Base class for all MELCloud Home errors */
export class MelCloudHomeError extends Error {
    /** @param message - Error message (secrets are redacted) */
    public constructor(message: string) {
        super(redact(message));
        this.name = new.target.name;
    }
}

/** Network problem: DNS, connection refused/reset, timeout */
export class NetworkError extends MelCloudHomeError {}

/** The cloud answered with HTTP 5xx */
export class ServiceUnavailableError extends MelCloudHomeError {
    public readonly status: number;

    /** @param status - HTTP status */
    public constructor(status: number) {
        super(`MELCloud Home service unavailable (HTTP ${status})`);
        this.status = status;
    }
}

/** MELCloud Home rejected e-mail or password */
export class CredentialsRejectedError extends MelCloudHomeError {
    /** Fixed message */
    public constructor() {
        super('MELCloud Home rejected the login credentials');
    }
}

/** The login flow behaved unexpectedly (page layout changed, unexpected status, ...) */
export class LoginFlowError extends MelCloudHomeError {}

/** The refresh token was rejected - a full login is required */
export class TokenRejectedError extends MelCloudHomeError {}

/** Any other unexpected API answer (HTTP 4xx, invalid JSON, ...) */
export class ApiError extends MelCloudHomeError {
    public readonly status: number | undefined;

    /**
     * @param message - Error message
     * @param status - HTTP status, if any
     */
    public constructor(message: string, status?: number) {
        super(message);
        this.status = status;
    }
}

/** The adapter is shutting down - not an error condition */
export class AbortedError extends MelCloudHomeError {
    /** Fixed message */
    public constructor() {
        super('Request aborted');
    }
}

/**
 * Removes credentials from a text before it reaches a log: OAuth codes, state,
 * WebSocket hash, tokens, passwords, CSRF values and e-mail addresses.
 *
 * @param text - Text that may contain secrets
 */
export function redact(text: string): string {
    return text
        .replace(
            /([?&#]|\b)(code|state|hash|request_uri|access_token|refresh_token|id_token|password|_csrf|code_verifier)=[^&\s"']*/gi,
            '$1$2=***',
        )
        .replace(/(Bearer\s+)[\w\-.~+/]+=*/gi, '$1***')
        .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '***@***');
}

/** CR/LF plus the other separators log viewers split on (NEL, LS, PS) */
const LINE_BREAKS = new RegExp(`\r\n|[\r\n${String.fromCharCode(0x85, 0x2028, 0x2029)}]`, 'g');

/**
 * Flattens line breaks of server-supplied strings (device names etc.) so they
 * cannot forge log lines (CWE-117).
 *
 * @param value - Value from the cloud
 */
export function stripLineBreaks(value: unknown): string {
    return String(value).replace(LINE_BREAKS, ' ');
}

/**
 * Short, log-safe description of any thrown value.
 *
 * @param error - Caught value
 */
export function describeError(error: unknown): string {
    if (error instanceof MelCloudHomeError) {
        return error.message;
    }
    if (error instanceof Error) {
        return redact(stripLineBreaks(error.message));
    }
    return redact(stripLineBreaks(String(error)));
}
