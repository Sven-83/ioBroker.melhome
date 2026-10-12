/*
 * Read-only probe against the real MELCloud Home cloud (developer tool, not part of the adapter).
 *
 *   npm run probe
 *
 * - asks for e-mail and password on the terminal (hidden input), stores them nowhere
 * - sends GET requests only - never a control command
 * - writes anonymised responses and a summary to .probe/ (git-ignored)
 *
 * Optional: PROBE_WS_SECONDS=120 npm run probe  -> listens to the WebSocket for 120 s
 * (change something in the official app meanwhile to capture push messages).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { AuthClient } from '../src/lib/api/auth';
import { formatReportTime, formatTelemetryTime } from '../src/lib/api/client';
import {
    DEFAULT_ENDPOINTS,
    PATH_CONTEXT,
    PATH_TELEMETRY_ACTUAL,
    PATH_TELEMETRY_ENERGY,
    PATH_TREND_SUMMARY,
    USER_AGENT,
} from '../src/lib/api/constants';
import { describeError } from '../src/lib/api/errors';
import { HttpTransport } from '../src/lib/api/http';
import { parseUserContext } from '../src/lib/api/types';

const OUT_DIR = join(__dirname, '..', '.probe');

// ---------------------------------------------------------------- anonymisation

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAC = /\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** Keys whose values are personal and replaced completely */
const PERSONAL_KEYS =
    /^(email|firstname|lastname|phone.*|mobile.*|address.*|street|city|postcode|zip.*|latitude|longitude|serial.*|macAddress|connectedInterfaceIdentifier|ssid|ipAddress)$/i;
/** Keys holding names chosen by the user */
const NAME_KEYS = /^(givenDisplayName|name)$/;

/**
 * Replaces personal data with stable placeholders, keeps structure and value formats.
 */
export class Anonymiser {
    private readonly uuids = new Map<string, string>();
    private readonly names = new Map<string, string>();

    /** @param value - Any JSON value */
    public apply(value: unknown): unknown {
        return this.walk(value, '');
    }

    private uuid(original: string): string {
        const key = original.toLowerCase();
        let mapped = this.uuids.get(key);
        if (!mapped) {
            mapped = `00000000-0000-4000-8000-${String(this.uuids.size + 1).padStart(12, '0')}`;
            this.uuids.set(key, mapped);
        }
        return mapped;
    }

    private name(original: string, key: string): string {
        let mapped = this.names.get(original);
        if (!mapped) {
            mapped = `${key === 'givenDisplayName' ? 'Room' : 'Name'} ${this.names.size + 1}`;
            this.names.set(original, mapped);
        }
        return mapped;
    }

    private text(value: string): string {
        return value
            .replace(UUID, match => this.uuid(match))
            .replace(MAC, '00:00:00:00:00:00')
            .replace(EMAIL, 'user@example.invalid');
    }

    private walk(value: unknown, key: string, parent?: Record<string, unknown>): unknown {
        if (Array.isArray(value)) {
            return value.map(item => this.walk(item, key));
        }
        if (value && typeof value === 'object') {
            const object = value as Record<string, unknown>;
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(object)) {
                result[k] = this.walk(v, k, object);
            }
            return result;
        }
        if (PERSONAL_KEYS.test(key) && value !== null && value !== '') {
            return key.toLowerCase() === 'email' ? 'user@example.invalid' : 'REDACTED';
        }
        if (typeof value !== 'string') {
            return value;
        }
        // "name" inside settings ([{name: "Power", value: ...}]) is a field name, not personal data
        const isSettingName = key === 'name' && parent !== undefined && 'value' in parent;
        if (NAME_KEYS.test(key) && !isSettingName && value !== '') {
            return this.name(value, key);
        }
        return this.text(value);
    }
}

// ---------------------------------------------------------------- terminal input

function ask(question: string, hidden = false): Promise<string> {
    return new Promise(resolve => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            // suppress echo of the typed characters
            (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string): void => {
                if (s.startsWith(question)) {
                    process.stdout.write(question);
                }
            };
        }
        rl.question(question, answer => {
            rl.close();
            if (hidden) {
                process.stdout.write('\n');
            }
            resolve(answer.trim());
        });
    });
}

// ---------------------------------------------------------------- probe

interface Summary {
    tokenLifetimeSeconds?: number;
    steps: { step: string; result: string }[];
    units: Record<string, unknown>[];
    webSocket?: WebSocketResult;
}

async function main(): Promise<void> {
    console.log('MELCloud Home read-only probe - no commands are sent to your devices.\n');
    const email = await ask('MELCloud Home e-mail: ');
    const password = await ask('MELCloud Home password (hidden): ', true);
    if (!email || !password) {
        console.log('Aborted - e-mail and password are required.');
        return;
    }

    mkdirSync(OUT_DIR, { recursive: true });
    const anonymiser = new Anonymiser();
    const summary: Summary = { steps: [], units: [] };
    const save = (file: string, data: unknown): void => {
        writeFileSync(join(OUT_DIR, file), `${JSON.stringify(anonymiser.apply(data), null, 4)}\n`);
    };
    const step = (name: string, result: string): void => {
        summary.steps.push({ step: name, result });
        console.log(`  ${name}: ${result}`);
    };

    const http = new HttpTransport();
    const auth = new AuthClient(http);

    // 1. login
    const loginStarted = Date.now();
    let accessToken: string;
    try {
        const tokens = await auth.login({ email, password });
        accessToken = tokens.accessToken;
        summary.tokenLifetimeSeconds = Math.round((tokens.expiresAt - loginStarted) / 1000);
        step('login', `ok, access token valid for ~${summary.tokenLifetimeSeconds} s`);
    } catch (error) {
        step('login', `FAILED: ${describeError(error)}`);
        save('summary.json', summary);
        return;
    }

    const get = async (url: string): Promise<{ status: number; data: unknown }> => {
        const { response, body } = await http.request(url, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        });
        let data: unknown = body;
        try {
            data = body ? JSON.parse(body) : null;
        } catch {
            // keep text
        }
        return { status: response.status, data };
    };

    // 2. context
    const context = await get(`${DEFAULT_ENDPOINTS.api}${PATH_CONTEXT}`);
    step('GET /context', `HTTP ${context.status}`);
    save('context.json', context.data);
    const warnings: string[] = [];
    const parsed = parseUserContext(context.data, (_key, message) => warnings.push(message));
    if (!parsed) {
        save('summary.json', summary);
        return;
    }
    if (warnings.length > 0) {
        step('parser warnings', String(anonymiser.apply(warnings.join(' | '))));
    }

    // raw value formats per unit (answers docs/api.md section 9)
    const rawUnits = new Map<string, Record<string, unknown>>();
    const raw = context.data as { buildings?: unknown[]; guestBuildings?: unknown[] };
    for (const building of [...(raw.buildings ?? []), ...(raw.guestBuildings ?? [])] as {
        airToAirUnits?: Record<string, unknown>[];
    }[]) {
        for (const unit of building.airToAirUnits ?? []) {
            rawUnits.set(String(unit.id), unit);
        }
    }

    const now = Date.now();
    for (const [index, unit] of parsed.ataUnits.entries()) {
        const id = unit.id;
        const n = index + 1;
        const settings = Object.fromEntries(
            ((rawUnits.get(id)?.settings as { name: string; value: unknown }[]) ?? []).map(s => [s.name, s.value]),
        );

        // 3. telemetry (read only)
        const hourMs = 3_600_000;
        const energyQuery = new URLSearchParams({
            from: formatTelemetryTime(Math.floor((now - 23 * hourMs) / hourMs) * hourMs),
            to: formatTelemetryTime(now),
            interval: 'Hour',
            measure: 'cumulative_energy_consumed_since_last_upload',
        });
        const energy = await get(
            `${DEFAULT_ENDPOINTS.api}${PATH_TELEMETRY_ENERGY}${encodeURIComponent(id)}?${energyQuery.toString()}`,
        );
        save(`unit${n}-energy.json`, energy.data);

        const rssiQuery = new URLSearchParams({
            from: formatTelemetryTime(now - hourMs),
            to: formatTelemetryTime(now),
            measure: 'rssi',
        });
        const rssi = await get(
            `${DEFAULT_ENDPOINTS.api}${PATH_TELEMETRY_ACTUAL}${encodeURIComponent(id)}?${rssiQuery.toString()}`,
        );
        save(`unit${n}-rssi.json`, rssi.data);

        const to = Math.floor(now / 60_000) * 60_000;
        const trendQuery = new URLSearchParams({
            unitId: id,
            period: 'Hourly',
            from: formatReportTime(to - 48 * hourMs),
            to: formatReportTime(to),
        });
        const trend = await get(`${DEFAULT_ENDPOINTS.api}${PATH_TREND_SUMMARY}?${trendQuery.toString()}`);
        save(`unit${n}-trendsummary.json`, trend.data);

        const energyValues = (
            (energy.data as { measureData?: { values?: unknown[] }[] } | null)?.measureData ?? []
        ).reduce((sum, m) => sum + (m.values?.length ?? 0), 0);

        summary.units.push({
            unit: `unit${n}`,
            isConnected: unit.isConnected,
            capabilities: unit.capabilities,
            rawSetFanSpeed: settings.SetFanSpeed,
            rawVaneVerticalDirection: settings.VaneVerticalDirection,
            rawVaneHorizontalDirection: settings.VaneHorizontalDirection,
            rawOperationMode: settings.OperationMode,
            settingNames: Object.keys(settings),
            energy: `HTTP ${energy.status}, ${energyValues} hourly value(s)`,
            rssi: `HTTP ${rssi.status}`,
            trendsummary: `HTTP ${trend.status}`,
        });
        step(
            `unit${n}`,
            `online=${unit.isConnected}, energy HTTP ${energy.status} (${energyValues} values), rssi HTTP ${rssi.status}, trend HTTP ${trend.status}`,
        );
    }

    // 4. WebSocket (optional, listen only)
    const wsSeconds = Number(process.env.PROBE_WS_SECONDS ?? 0);
    if (wsSeconds > 0) {
        summary.webSocket = await listenWebSocket(get, wsSeconds, frames => save('websocket-frames.json', frames));
        step(
            'WebSocket',
            `connected=${summary.webSocket.connected}, ${summary.webSocket.messages} message(s): ${summary.webSocket.messageTypes.join(', ') || '-'}, close code ${summary.webSocket.closeCode ?? '-'}`,
        );
        // state after the changes made in the app, to compare with the push messages
        const after = await get(`${DEFAULT_ENDPOINTS.api}${PATH_CONTEXT}`);
        save('context-after.json', after.data);
        step('GET /context after listening', `HTTP ${after.status}`);
    }

    save('summary.json', summary);
    console.log(`\nDone. Anonymised results in ${OUT_DIR}`);
    console.log('Please check the files before sharing them - nothing has been uploaded anywhere.');
}

interface WebSocketResult {
    connected: boolean;
    messages: number;
    messageTypes: string[];
    closeCode?: number;
    closeReason?: string;
}

async function listenWebSocket(
    get: (url: string) => Promise<{ status: number; data: unknown }>,
    seconds: number,
    store: (frames: unknown[]) => void,
): Promise<WebSocketResult> {
    const WebSocketImpl = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket;
    const result: WebSocketResult = { connected: false, messages: 0, messageTypes: [] };
    if (!WebSocketImpl) {
        console.log('  WebSocket: not available in this Node.js version (needs >= 22)');
        return result;
    }
    const credential = await get(DEFAULT_ENDPOINTS.wsHash);
    const hash = (credential.data as { hash?: string } | null)?.hash;
    if (!hash) {
        console.log(`  WebSocket: no credential (HTTP ${credential.status})`);
        return result;
    }
    console.log(`  WebSocket: listening for ${seconds} s - change something in the official app now if you like`);
    const frames: unknown[] = [];
    await new Promise<void>(resolve => {
        const socket = new WebSocketImpl(`${DEFAULT_ENDPOINTS.ws}/?hash=${encodeURIComponent(hash)}`);
        const timer = setTimeout(() => socket.close(), seconds * 1000);
        socket.addEventListener('open', () => {
            result.connected = true;
        });
        socket.addEventListener('message', event => {
            result.messages++;
            let data: unknown = String(event.data);
            try {
                data = JSON.parse(String(event.data));
            } catch {
                // keep text
            }
            frames.push({ receivedAt: new Date().toISOString(), data });
            for (const message of Array.isArray(data) ? data : [data]) {
                const type = (message as { messageType?: string } | null)?.messageType;
                if (type && !result.messageTypes.includes(type)) {
                    result.messageTypes.push(type);
                }
            }
        });
        socket.addEventListener('error', () => undefined);
        socket.addEventListener('close', event => {
            result.closeCode = event.code;
            result.closeReason = event.reason.replace(/hash=[^&s]*/gi, 'hash=***');
            clearTimeout(timer);
            resolve();
        });
    });
    store(frames);
    return result;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Probe failed: ${describeError(error)}`);
        process.exitCode = 1;
    });
}
