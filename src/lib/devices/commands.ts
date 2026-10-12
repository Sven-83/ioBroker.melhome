/*
 * Command queue for air-to-air units (docs/api.md section 3.3):
 * - commands per unit are collected for a short debounce time and merged (later values win)
 * - power on is always sent together with the operation mode (multi-split mode conflict)
 * - the two vane axes are sent in separate requests, with a gap between requests to the same unit
 * - the target temperature is rounded and clamped to the limits of the effective mode
 */

import { describeError } from '../api/errors';
import type { Logger } from '../api/http';
import type { Scheduler } from '../api/connection';
import type { AtaControlRequest, AtaUnit } from '../api/types';
import { clampTemperature, temperatureLimits } from '../mapping';

/** Default debounce time for commands of one unit */
export const COMMAND_DEBOUNCE_MS = 800;
/** Gap between two requests to the same unit (the unit may ignore back-to-back requests) */
export const REQUEST_GAP_MS = 1500;

/** Dependencies and settings of the command queue */
export interface CommandQueueOptions {
    /** Sends one control request */
    send: (unitId: string, request: AtaControlRequest) => Promise<void>;
    /** Current state of a unit from the last /context */
    getUnit: (unitId: string) => AtaUnit | undefined;
    /** Called for every request the cloud accepted */
    onAccepted: (unitId: string, request: AtaControlRequest) => void | Promise<void>;
    /** Called for every request that failed */
    onFailed: (unitId: string, request: AtaControlRequest, error: unknown) => void | Promise<void>;
    /** Called once after a batch of a unit was processed */
    onBatchDone: (unitId: string) => void;
    /** Timer functions of the adapter */
    scheduler: Scheduler;
    /** Abortable sleep */
    sleep: (ms: number) => Promise<void>;
    /** Adapter logger */
    log: Logger;
    /** Debounce time in ms */
    debounceMs?: number;
    /** Gap between requests to one unit in ms */
    gapMs?: number;
}

/**
 * Splits a merged command into the requests the cloud accepts.
 *
 * @param command - Merged command of one unit
 * @param unit - Current unit state (needed for power on and temperature limits)
 * @returns Requests in sending order
 */
export function planRequests(command: AtaControlRequest, unit: AtaUnit | undefined): AtaControlRequest[] {
    const { vaneVerticalDirection, vaneHorizontalDirection, ...main } = command;

    if (main.power === true && main.operationMode === undefined) {
        const mode = unit?.operationMode;
        if (!mode) {
            throw new RangeError('Cannot switch on: the current operation mode is unknown');
        }
        main.operationMode = mode;
    }
    if (main.setTemperature !== undefined) {
        if (!unit) {
            throw new RangeError('Cannot set the temperature: unit state unknown');
        }
        const mode = main.operationMode ?? unit.operationMode;
        main.setTemperature = clampTemperature(main.setTemperature, temperatureLimits(unit.capabilities, mode));
    }

    const requests: AtaControlRequest[] = [];
    if (Object.values(main).some(value => value !== undefined)) {
        requests.push(main);
    }
    if (vaneVerticalDirection !== undefined) {
        requests.push({ vaneVerticalDirection });
    }
    if (vaneHorizontalDirection !== undefined) {
        requests.push({ vaneHorizontalDirection });
    }
    return requests;
}

/**
 * Debounces, merges and sends commands per unit.
 */
export class CommandQueue {
    private readonly options: CommandQueueOptions;
    private readonly debounceMs: number;
    private readonly gapMs: number;
    private readonly pending = new Map<string, AtaControlRequest>();
    private readonly timers = new Map<string, unknown>();
    private readonly busy = new Set<string>();
    private stopped = false;

    /** @param options - Dependencies and settings */
    public constructor(options: CommandQueueOptions) {
        this.options = options;
        this.debounceMs = options.debounceMs ?? COMMAND_DEBOUNCE_MS;
        this.gapMs = options.gapMs ?? REQUEST_GAP_MS;
    }

    /**
     * Adds fields to the pending command of a unit and (re)starts its debounce timer.
     *
     * @param unitId - Unit UUID
     * @param fields - Fields to change
     */
    public enqueue(unitId: string, fields: AtaControlRequest): void {
        if (this.stopped) {
            return;
        }
        this.pending.set(unitId, { ...this.pending.get(unitId), ...fields });
        this.schedule(unitId, this.debounceMs);
    }

    /**
     * True if commands for this unit are waiting or being sent
     *
     * @param unitId - Unit UUID
     */
    public isPending(unitId: string): boolean {
        return this.pending.has(unitId) || this.busy.has(unitId);
    }

    /** Drops pending commands and timers (adapter unload) */
    public stop(): void {
        this.stopped = true;
        for (const timer of this.timers.values()) {
            this.options.scheduler.clearTimeout(timer);
        }
        this.timers.clear();
        this.pending.clear();
    }

    private schedule(unitId: string, delayMs: number): void {
        const existing = this.timers.get(unitId);
        if (existing !== undefined) {
            this.options.scheduler.clearTimeout(existing);
        }
        this.timers.set(
            unitId,
            this.options.scheduler.setTimeout(() => {
                this.timers.delete(unitId);
                void this.flush(unitId);
            }, delayMs),
        );
    }

    private async flush(unitId: string): Promise<void> {
        if (this.stopped) {
            return;
        }
        if (this.busy.has(unitId)) {
            // a batch is still being sent - try again once it is done
            this.schedule(unitId, this.debounceMs);
            return;
        }
        const command = this.pending.get(unitId);
        this.pending.delete(unitId);
        if (!command) {
            return;
        }
        const { log, send, getUnit, onAccepted, onFailed, onBatchDone, sleep } = this.options;

        let requests: AtaControlRequest[];
        try {
            requests = planRequests(command, getUnit(unitId));
        } catch (error) {
            log.warn(`Command for unit ${unitId} not sent: ${describeError(error)}`);
            await onFailed(unitId, command, error);
            onBatchDone(unitId);
            return;
        }

        this.busy.add(unitId);
        try {
            for (const [index, request] of requests.entries()) {
                if (this.stopped) {
                    return;
                }
                if (index > 0) {
                    await sleep(this.gapMs);
                }
                try {
                    await send(unitId, request);
                    log.debug(`Command for unit ${unitId} accepted: ${JSON.stringify(request)}`);
                    await onAccepted(unitId, request);
                } catch (error) {
                    if (this.stopped) {
                        return;
                    }
                    log.warn(`Command for unit ${unitId} failed: ${describeError(error)}`);
                    await onFailed(unitId, request, error);
                }
            }
        } finally {
            this.busy.delete(unitId);
        }
        if (!this.stopped) {
            onBatchDone(unitId);
        }
    }
}
