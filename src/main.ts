/*
 * ioBroker.melcloudhome
 * Adapter lifecycle only - API details live in lib/api, device logic in lib/devices.
 */

import * as utils from '@iobroker/adapter-core';
import { AuthClient, TokenManager } from './lib/api/auth';
import { MelCloudHomeClient } from './lib/api/client';
import { ConnectionManager } from './lib/api/connection';
import { HttpTransport } from './lib/api/http';
import type { UserContext } from './lib/api/types';

/** Minimum REST polling interval in seconds (rate limit protection) */
const MIN_POLL_INTERVAL_S = 60;
/** Maximum REST polling interval in seconds */
const MAX_POLL_INTERVAL_S = 3600;

class Melcloudhome extends utils.Adapter {
    private http: HttpTransport | undefined;
    private client: MelCloudHomeClient | undefined;
    private connection: ConnectionManager | undefined;
    private knownUnitCount: number | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'melcloudhome',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);

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

        this.http = new HttpTransport();
        const tokens = new TokenManager(new AuthClient(this.http), { email, password }, this.log);
        this.client = new MelCloudHomeClient({ http: this.http, tokens, log: this.log });
        this.connection = new ConnectionManager({
            source: this.client,
            log: this.log,
            pollIntervalMs: pollInterval * 1000,
            scheduler: {
                setTimeout: (callback, ms) => this.setTimeout(callback, ms),
                clearTimeout: handle => this.clearTimeout(handle as ioBroker.Timeout | undefined),
            },
            onConnectionChange: async connected => {
                await this.setState('info.connection', connected, true);
            },
            onContext: context => this.onContext(context),
        });

        this.log.info(
            `Starting (polling every ${pollInterval} s, real-time ${this.config.realtime ? 'enabled' : 'disabled'})`,
        );
        this.connection.start();
    }

    /**
     * Receives every successfully fetched /context.
     *
     * @param context - Parsed user context
     */
    private onContext(context: UserContext): void {
        if (context.ataUnits.length !== this.knownUnitCount) {
            this.knownUnitCount = context.ataUnits.length;
            this.log.info(`Found ${context.ataUnits.length} air-to-air unit(s)`);
            if (context.atwUnitCount > 0) {
                this.log.info(`Ignoring ${context.atwUnitCount} air-to-water unit(s) - not supported yet`);
            }
        }
        // TODO Phase 3: create/update the object tree from context.ataUnits
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            this.connection?.stop();
            this.http?.abort();
            void this.setState('info.connection', false, true);
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param id - State ID
     * @param state - State object
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            return;
        }
        // TODO Phase 3: route control commands to the command queue
        this.log.debug(`Command for ${id} ignored - control not implemented yet`);
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Melcloudhome(options);
} else {
    // otherwise start the instance directly
    (() => new Melcloudhome())();
}
