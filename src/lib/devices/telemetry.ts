/*
 * Slow telemetry polling (docs/api.md sections 3.4-3.6): energy, Wi-Fi signal and outdoor temperature
 * every 30 minutes. Failures here never affect the connection state - the values simply stay as they are.
 */

import type { Scheduler } from '../api/connection';
import { AbortedError, describeError } from '../api/errors';
import type { Logger } from '../api/http';
import type { AtaUnit, HourlyEnergy, Reading } from '../api/types';

/** Telemetry interval (rate limit: energy at most every 30 min) */
export const TELEMETRY_INTERVAL_MS = 30 * 60_000;
/** Delay of the first run after the first /context */
export const TELEMETRY_FIRST_DELAY_MS = 15_000;

/** What the poller needs from the REST client */
export interface TelemetrySource {
    /** Hourly energy in Wh */
    getHourlyEnergy(unitId: string): Promise<HourlyEnergy>;
    /** Newest Wi-Fi signal reading */
    getWifiSignal(unitId: string): Promise<Reading | null>;
    /** Newest genuine outdoor temperature */
    getOutdoorTemperature(unitId: string, timeZone: string | null): Promise<Reading | null>;
}

/** Receiver of the results */
export interface TelemetrySink {
    /** New energy values */
    onEnergy(unitId: string, hourly: HourlyEnergy): void | Promise<void>;
    /** New Wi-Fi signal reading */
    onWifiSignal(unitId: string, reading: Reading): void | Promise<void>;
    /** New outdoor temperature reading */
    onOutdoorTemperature(unitId: string, reading: Reading): void | Promise<void>;
}

/** Dependencies and settings of the telemetry poller */
export interface TelemetryOptions {
    /** REST client */
    source: TelemetrySource;
    /** Receiver of the readings */
    sink: TelemetrySink;
    /** Timer functions of the adapter */
    scheduler: Scheduler;
    /** Adapter logger */
    log: Logger;
    /** Polling interval in ms */
    intervalMs?: number;
    /** Delay of the first run in ms */
    firstDelayMs?: number;
}

/**
 * Polls slow telemetry for all known units.
 */
export class TelemetryPoller {
    private readonly options: TelemetryOptions;
    private units: AtaUnit[] = [];
    private timer: unknown;
    private running = false;
    private stopped = false;
    private readonly failing = new Set<string>();

    /** @param options - Dependencies and settings */
    public constructor(options: TelemetryOptions) {
        this.options = options;
    }

    /**
     * Updates the unit list; the first call starts the polling.
     *
     * @param units - Units from the latest /context
     */
    public setUnits(units: AtaUnit[]): void {
        this.units = units;
        if (this.timer === undefined && !this.running && !this.stopped) {
            this.schedule(this.options.firstDelayMs ?? TELEMETRY_FIRST_DELAY_MS);
        }
    }

    /** Stops polling */
    public stop(): void {
        this.stopped = true;
        if (this.timer !== undefined) {
            this.options.scheduler.clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private schedule(delayMs: number): void {
        this.timer = this.options.scheduler.setTimeout(() => {
            this.timer = undefined;
            void this.run();
        }, delayMs);
    }

    private async run(): Promise<void> {
        if (this.stopped) {
            return;
        }
        this.running = true;
        try {
            for (const unit of this.units) {
                if (this.stopped) {
                    return;
                }
                if (unit.capabilities.hasEnergyConsumedMeter) {
                    await this.attempt(unit, 'energy', async () => {
                        await this.options.sink.onEnergy(unit.id, await this.options.source.getHourlyEnergy(unit.id));
                    });
                }
                await this.attempt(unit, 'wifi signal', async () => {
                    const reading = await this.options.source.getWifiSignal(unit.id);
                    if (reading) {
                        await this.options.sink.onWifiSignal(unit.id, reading);
                    }
                });
                await this.attempt(unit, 'outdoor temperature', async () => {
                    const reading = await this.options.source.getOutdoorTemperature(unit.id, unit.timeZone);
                    if (reading) {
                        await this.options.sink.onOutdoorTemperature(unit.id, reading);
                    }
                });
            }
        } finally {
            this.running = false;
        }
        if (!this.stopped) {
            this.schedule(this.options.intervalMs ?? TELEMETRY_INTERVAL_MS);
        }
    }

    /**
     * Runs one request; logs the first failure of a kind as info, repetitions as debug.
     *
     * @param unit - Unit
     * @param what - Description for the log
     * @param task - Request and processing
     */
    private async attempt(unit: AtaUnit, what: string, task: () => Promise<void>): Promise<void> {
        const key = `${unit.id}:${what}`;
        try {
            await task();
            if (this.failing.delete(key)) {
                this.options.log.info(`Reading ${what} of ${unit.name} works again`);
            }
        } catch (error) {
            if (error instanceof AbortedError || this.stopped) {
                return;
            }
            const message = `Reading ${what} of ${unit.name} failed: ${describeError(error)}`;
            if (this.failing.has(key)) {
                this.options.log.debug(message);
            } else {
                this.failing.add(key);
                this.options.log.info(`${message} - keeping the last value`);
            }
        }
    }
}
