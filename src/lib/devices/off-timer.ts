/*
 * Off timers run inside the adapter (MELCloud Home has no such timer).
 * The end time is persisted by the caller (state control.offTimerEnd) so a timer survives a restart.
 */

import type { Scheduler } from '../api/connection';
import type { Logger } from '../api/http';

/** Maximum timer duration in minutes */
export const MAX_OFF_TIMER_MINUTES = 360;
/** A timer that expired while the adapter was stopped is still executed within this grace time */
export const EXPIRED_GRACE_MS = 30 * 60_000;
/** Update interval of the remaining time */
export const TICK_MS = 10_000;

/** Dependencies and callbacks of the off timers */
export interface OffTimerOptions {
    /** Timer functions of the adapter */
    scheduler: Scheduler;
    /** Adapter logger */
    log: Logger;
    /** Clock (tests) */
    now?: () => number;
    /** Display name of a unit for log messages (defaults to the UUID) */
    nameOf?: (unitId: string) => string;
    /** Timer elapsed - switch the unit off */
    onExpire: (unitId: string) => void | Promise<void>;
    /**
     * Timer state changed or ticked.
     *
     * @param unitId - Unit UUID
     * @param remainingSeconds - Remaining time, 0 if no timer
     * @param endTime - End time as epoch ms, 0 if no timer
     */
    onUpdate: (unitId: string, remainingSeconds: number, endTime: number) => void | Promise<void>;
    /** Update interval in ms */
    tickMs?: number;
}

/**
 * Manages one optional off timer per unit with a single shared tick.
 */
export class OffTimers {
    private readonly options: OffTimerOptions;
    private readonly now: () => number;
    private readonly tickMs: number;
    private readonly nameOf: (unitId: string) => string;
    private readonly ends = new Map<string, number>();
    private tick: unknown;
    private stopped = false;

    /** @param options - Dependencies and callbacks */
    public constructor(options: OffTimerOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.tickMs = options.tickMs ?? TICK_MS;
        this.nameOf = options.nameOf ?? (unitId => unitId);
    }

    /**
     * Starts, restarts or (minutes = 0) cancels the timer of a unit.
     *
     * @param unitId - Unit UUID
     * @param minutes - Duration in minutes (0 cancels)
     * @returns The effective duration in minutes
     */
    public async set(unitId: string, minutes: number): Promise<number> {
        const duration = Math.max(0, Math.min(MAX_OFF_TIMER_MINUTES, Math.round(minutes)));
        if (duration === 0) {
            await this.cancel(unitId);
            return 0;
        }
        const end = this.now() + duration * 60_000;
        this.ends.set(unitId, end);
        await this.options.onUpdate(unitId, duration * 60, end);
        this.ensureTick();
        return duration;
    }

    /**
     * Cancels the timer of a unit.
     *
     * @param unitId - Unit UUID
     */
    public async cancel(unitId: string): Promise<void> {
        const had = this.ends.delete(unitId);
        if (had) {
            this.options.log.debug(`Off timer of ${this.nameOf(unitId)} cancelled`);
        }
        await this.options.onUpdate(unitId, 0, 0);
    }

    /**
     * Restores a persisted timer after a restart.
     *
     * @param unitId - Unit UUID
     * @param endTime - Persisted end time (epoch ms, 0 = none)
     */
    public async restore(unitId: string, endTime: number): Promise<void> {
        if (!Number.isFinite(endTime) || endTime <= 0) {
            return;
        }
        const now = this.now();
        if (endTime > now) {
            this.ends.set(unitId, endTime);
            await this.options.onUpdate(unitId, Math.ceil((endTime - now) / 1000), endTime);
            this.ensureTick();
            this.options.log.info(
                `Off timer of ${this.nameOf(unitId)} restored (${Math.ceil((endTime - now) / 60_000)} min left)`,
            );
            return;
        }
        await this.options.onUpdate(unitId, 0, 0);
        if (now - endTime <= EXPIRED_GRACE_MS) {
            this.options.log.info(
                `Off timer of ${this.nameOf(unitId)} expired while the adapter was stopped - switching off now`,
            );
            await this.options.onExpire(unitId);
        } else {
            this.options.log.info(
                `Off timer of ${this.nameOf(unitId)} expired long ago while the adapter was stopped - ignored`,
            );
        }
    }

    /**
     * Remaining seconds of a unit's timer (0 if none).
     *
     * @param unitId - Unit UUID
     */
    public remaining(unitId: string): number {
        const end = this.ends.get(unitId);
        return end ? Math.max(0, Math.ceil((end - this.now()) / 1000)) : 0;
    }

    /** Stops the tick; persisted end times stay untouched */
    public stop(): void {
        this.stopped = true;
        if (this.tick !== undefined) {
            this.options.scheduler.clearTimeout(this.tick);
            this.tick = undefined;
        }
    }

    private ensureTick(): void {
        if (this.tick !== undefined || this.stopped || this.ends.size === 0) {
            return;
        }
        this.tick = this.options.scheduler.setTimeout(() => {
            this.tick = undefined;
            void this.onTick();
        }, this.tickMs);
    }

    private async onTick(): Promise<void> {
        const now = this.now();
        for (const [unitId, end] of [...this.ends]) {
            if (this.stopped) {
                return;
            }
            if (end <= now) {
                this.ends.delete(unitId);
                await this.options.onUpdate(unitId, 0, 0);
                this.options.log.info(`Off timer of ${this.nameOf(unitId)} elapsed - switching off`);
                await this.options.onExpire(unitId);
            } else {
                await this.options.onUpdate(unitId, Math.ceil((end - now) / 1000), end);
            }
        }
        this.ensureTick();
    }
}
