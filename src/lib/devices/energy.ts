/*
 * Energy counter built from hourly values (docs/api.md section 3.4).
 *
 * The cloud reports Wh per hour, values of an hour grow later (2-4 updates, final ~10 min after the
 * hour) and empty hours are missing. The tracker remembers the last seen value per hour and only adds
 * positive deltas. On the very first run all existing hours are only marked as seen, otherwise the
 * counter would jump by the history.
 */

import type { HourlyEnergy } from '../api/types';

/** Values above this are implausible for one indoor unit and ignored */
export const MAX_WH_PER_HOUR = 100_000;
/** Hours older than this are forgotten */
const RETENTION_MS = 48 * 3_600_000;

/** Persisted state of the tracker */
export interface EnergyTrackerData {
    /** Counter in Wh */
    totalWh: number;
    /** Hour start (epoch ms, as string key) -> last seen Wh */
    seen: Record<string, number>;
    /** False until the first response was processed */
    initialised: boolean;
}

/** Values derived from one update */
export interface EnergyValues {
    /** Counter in kWh */
    totalKwh: number;
    /** Newest hourly value in kWh, null if none */
    lastHourKwh: number | null;
    /** Sum of the hours since local midnight in kWh */
    todayKwh: number;
}

/**
 * Creates an empty tracker state, optionally continuing an existing counter.
 *
 * @param totalKwh - Counter value to continue from
 */
export function newEnergyTrackerData(totalKwh = 0): EnergyTrackerData {
    return { totalWh: Math.max(0, totalKwh * 1000), seen: {}, initialised: false };
}

/**
 * Validates persisted data and falls back to a fresh state.
 *
 * @param raw - Data read from the object's native part
 * @param totalKwh - Current counter state as fallback
 */
export function restoreEnergyTrackerData(raw: unknown, totalKwh: number): EnergyTrackerData {
    if (!raw || typeof raw !== 'object') {
        return newEnergyTrackerData(totalKwh);
    }
    const data = raw as Partial<EnergyTrackerData>;
    const seen: Record<string, number> = {};
    if (data.seen && typeof data.seen === 'object') {
        for (const [hour, value] of Object.entries(data.seen)) {
            if (Number.isFinite(Number(hour)) && typeof value === 'number' && Number.isFinite(value)) {
                seen[hour] = value;
            }
        }
    }
    const totalWh = typeof data.totalWh === 'number' && Number.isFinite(data.totalWh) ? data.totalWh : totalKwh * 1000;
    return { totalWh: Math.max(0, totalWh), seen, initialised: data.initialised === true };
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Applies one energy response. Mutates and returns the tracker data.
 *
 * @param data - Tracker state
 * @param hourly - Hour start -> Wh
 * @param now - Current time (epoch ms)
 * @param startOfToday - Local midnight (epoch ms)
 */
export function applyEnergy(
    data: EnergyTrackerData,
    hourly: HourlyEnergy,
    now: number,
    startOfToday: number,
): EnergyValues {
    for (const [hour, wh] of hourly) {
        if (wh < 0 || wh > MAX_WH_PER_HOUR) {
            continue;
        }
        const key = String(hour);
        const previous = data.seen[key] ?? 0;
        if (data.initialised && wh > previous) {
            data.totalWh += wh - previous;
        }
        data.seen[key] = Math.max(previous, wh);
    }
    data.initialised = true;
    for (const key of Object.keys(data.seen)) {
        if (Number(key) < now - RETENTION_MS) {
            delete data.seen[key];
        }
    }

    // newest hour ever seen, so an empty response does not clear the value
    const seenHours = Object.keys(data.seen).map(Number);
    const newest = seenHours.length > 0 ? Math.max(...seenHours) : undefined;
    const todayWh = Object.entries(data.seen)
        .filter(([hour]) => Number(hour) >= startOfToday)
        .reduce((sum, [, wh]) => sum + wh, 0);

    return {
        totalKwh: round3(data.totalWh / 1000),
        lastHourKwh: newest !== undefined ? round3(data.seen[String(newest)] / 1000) : null,
        todayKwh: round3(todayWh / 1000),
    };
}

/**
 * Local midnight of the given instant.
 *
 * @param now - Epoch ms
 */
export function startOfLocalDay(now: number): number {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}
