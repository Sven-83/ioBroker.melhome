/*
 * ioBroker.melcloudhome
 * Adapter lifecycle only - API details live in lib/api, device logic in lib/devices.
 */

import * as utils from '@iobroker/adapter-core';

/** Minimum REST polling interval in seconds (rate limit protection) */
const MIN_POLL_INTERVAL_S = 60;

class Melcloudhome extends utils.Adapter {
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

        if (!this.config.email || !this.config.password) {
            this.log.warn(
                'No MELCloud Home credentials configured - please enter e-mail and password in the instance settings',
            );
            return;
        }

        const pollInterval = Number(this.config.pollInterval);
        if (!Number.isFinite(pollInterval) || pollInterval < MIN_POLL_INTERVAL_S) {
            this.log.warn(
                `Polling interval ${this.config.pollInterval} s is invalid or too low - using ${MIN_POLL_INTERVAL_S} s`,
            );
            this.config.pollInterval = MIN_POLL_INTERVAL_S;
        }

        this.log.info(
            `Starting (polling every ${this.config.pollInterval} s, real-time ${this.config.realtime ? 'enabled' : 'disabled'})`,
        );

        // TODO Phase 2-4: login, device discovery, object tree, WebSocket + polling
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            // TODO: stop timers, WebSocket and pending requests once implemented
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
