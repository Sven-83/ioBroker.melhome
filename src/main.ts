/*
 * ioBroker.melcloudhome
 * Adapter lifecycle only - API details live in lib/api, device logic in lib/devices.
 */

import * as utils from '@iobroker/adapter-core';
import { AuthClient, TokenManager } from './lib/api/auth';
import { MelCloudHomeClient } from './lib/api/client';
import { ConnectionManager, type Scheduler } from './lib/api/connection';
import { describeError } from './lib/api/errors';
import { HttpTransport } from './lib/api/http';
import type { UserContext } from './lib/api/types';
import { RealtimeConnection } from './lib/api/websocket';
import { AtaDevices, type AdapterPort } from './lib/devices/ata';
import { TelemetryPoller } from './lib/devices/telemetry';

/** Minimum REST polling interval in seconds (rate limit protection) */
const MIN_POLL_INTERVAL_S = 60;
/** Maximum REST polling interval in seconds */
const MAX_POLL_INTERVAL_S = 3600;

class Melcloudhome extends utils.Adapter {
    private http: HttpTransport | undefined;
    private connection: ConnectionManager | undefined;
    private devices: AtaDevices | undefined;
    private telemetry: TelemetryPoller | undefined;
    private realtime: RealtimeConnection | undefined;
    private knownUnitCount: number | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'melcloudhome',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('message', this.onMessage.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);
        await this.setState('info.realtime', false, true);

        const email = (this.config.email ?? '').trim();
        const password = this.config.password ?? '';
        if (!email || !password) {
            this.log.warn(
                'No MELCloud Home credentials configured - please enter e-mail and password in the instance settings',
            );
            return;
        }

        let pollInterval = Number(this.config.pollInterval);
        if (!Number.isFinite(pollInterval) || pollInterval < MIN_POLL_INTERVAL_S) {
            this.log.warn(
                `Polling interval ${this.config.pollInterval} s is invalid or too low - using ${MIN_POLL_INTERVAL_S} s`,
            );
            pollInterval = MIN_POLL_INTERVAL_S;
        }
        pollInterval = Math.min(Math.round(pollInterval), MAX_POLL_INTERVAL_S);

        const scheduler: Scheduler = {
            setTimeout: (callback, ms) => this.setTimeout(callback, ms),
            clearTimeout: handle => this.clearTimeout(handle as ioBroker.Timeout | undefined),
        };
        const http = new HttpTransport();
        this.http = http;
        const tokens = new TokenManager(new AuthClient(http), { email, password }, this.log);
        const client = new MelCloudHomeClient({ http, tokens, log: this.log });

        await this.extendObjectAsync('devices', {
            type: 'folder',
            common: { name: { en: 'Devices', de: 'Geräte' } },
            native: {},
        });
        this.devices = new AtaDevices({
            port: this.createPort(),
            client,
            log: this.log,
            scheduler,
            sleep: ms => http.abortableSleep(ms),
            requestRefresh: () => this.connection?.requestRefresh(),
            roomIcons: Object.fromEntries(
                (Array.isArray(this.config.roomIcons) ? this.config.roomIcons : [])
                    .filter(entry => entry && typeof entry.unit === 'string')
                    .map(entry => [entry.unit, entry.icon]),
            ),
        });
        await this.devices.restoreTimers();

        this.telemetry = new TelemetryPoller({ source: client, sink: this.devices, scheduler, log: this.log });

        this.connection = new ConnectionManager({
            source: client,
            log: this.log,
            pollIntervalMs: pollInterval * 1000,
            scheduler,
            onConnectionChange: async connected => {
                await this.setState('info.connection', connected, true);
                // the WebSocket follows REST: no own login attempts while the cloud is unreachable
                if (connected) {
                    this.realtime?.start();
                } else {
                    this.realtime?.stop();
                }
            },
            onContext: context => this.onContext(context),
        });

        if (this.config.realtime) {
            this.realtime = new RealtimeConnection({
                getHash: () => client.getWebSocketHash(),
                scheduler,
                log: this.log,
                onUnitEvent: () => this.connection?.requestRefresh(),
                onConnectionChange: async connected => {
                    await this.setState('info.realtime', connected, true);
                    if (connected) {
                        // events may have been missed while the socket was closed
                        this.connection?.requestRefresh();
                    }
                },
            });
        }

        this.subscribeStates('devices.*.control.*');
        this.log.info(
            `Starting (polling every ${pollInterval} s, real-time ${this.config.realtime ? 'enabled' : 'disabled'})`,
        );
        this.connection.start();
    }

    /** Adapter functions used by the device layer */
    private createPort(): AdapterPort {
        return {
            namespace: this.namespace,
            extendObject: async (id, obj) => {
                await this.extendObjectAsync(id, obj);
            },
            getObject: id => this.getObjectAsync(id),
            setState: async (id, val, ack) => {
                await this.setStateAsync(id, val, ack);
            },
            getState: id => this.getStateAsync(id),
            getStates: async pattern => (await this.getStatesAsync(pattern)) ?? {},
            sanitizeId: id => id.replace(this.FORBIDDEN_CHARS, '_'),
        };
    }

    /**
     * Receives every successfully fetched /context.
     *
     * @param context - Parsed user context
     */
    private async onContext(context: UserContext): Promise<void> {
        if (context.ataUnits.length !== this.knownUnitCount) {
            this.knownUnitCount = context.ataUnits.length;
            this.log.info(`Found ${context.ataUnits.length} air-to-air unit(s)`);
            if (context.atwUnitCount > 0) {
                this.log.info(`Ignoring ${context.atwUnitCount} air-to-water unit(s) - not supported yet`);
            }
        }
        await this.devices?.update(context);
        this.telemetry?.setUnits(context.ataUnits);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            this.realtime?.stop();
            this.connection?.stop();
            this.telemetry?.stop();
            this.devices?.stop();
            this.http?.abort();
            void this.setState('info.connection', false, true);
            void this.setState('info.realtime', false, true);
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }

    /**
     * Answers requests of the instance settings.
     *
     * @param obj - Message from admin
     */
    private onMessage(obj: ioBroker.Message): void {
        if (obj?.command === 'getUnits' && obj.callback) {
            const units = this.devices?.listUnits() ?? [];
            this.sendTo(
                obj.from,
                obj.command,
                units.map(unit => ({ value: unit.id, label: unit.name })),
                obj.callback,
            );
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param id - State ID
     * @param state - State object
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack || !this.devices) {
            return;
        }
        this.devices.handleCommand(id, state).catch(error => {
            this.log.error(`Handling command ${id} failed: ${describeError(error)}`);
        });
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Melcloudhome(options);
} else {
    // otherwise start the instance directly
    (() => new Melcloudhome())();
}
