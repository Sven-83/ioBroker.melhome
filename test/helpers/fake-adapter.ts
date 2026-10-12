/*
 * In-memory replacement of the adapter functions used by the device layer.
 */

import type { AdapterPort } from '../../src/lib/devices/ata';

/** Fake object/state database */
export class FakePort implements AdapterPort {
    public readonly namespace = 'melcloudhome.0';
    public readonly objects = new Map<string, ioBroker.PartialObject>();
    public readonly states = new Map<string, ioBroker.State>();
    /** Every state write in order */
    public readonly writes: { id: string; val: ioBroker.StateValue; ack: boolean }[] = [];

    private full(id: string): string {
        return id.startsWith(`${this.namespace}.`) ? id : `${this.namespace}.${id}`;
    }

    /**
     * @param id - Relative id
     * @param obj - Object parts
     */
    public extendObject(id: string, obj: ioBroker.PartialObject): Promise<void> {
        const key = this.full(id);
        // plain records on purpose: spreading the ioBroker object union makes tsc extremely slow
        type Plain = Record<string, unknown> & { common?: Record<string, unknown>; native?: Record<string, unknown> };
        const existing = (this.objects.get(key) ?? {}) as Plain;
        const update = obj as unknown as Plain;
        const merged: Plain = {
            ...existing,
            ...update,
            common: { ...existing.common, ...update.common },
            native: { ...existing.native, ...update.native },
        };
        this.objects.set(key, merged);
        return Promise.resolve();
    }

    /** @param id - Relative id */
    public getObject(id: string): Promise<ioBroker.Object | null | undefined> {
        return Promise.resolve(this.objects.get(this.full(id)) as ioBroker.Object | undefined);
    }

    /**
     * @param id - Relative id
     * @param val - Value
     * @param ack - Acknowledged
     */
    public setState(id: string, val: ioBroker.StateValue, ack: boolean): Promise<void> {
        this.writes.push({ id, val, ack });
        this.states.set(this.full(id), {
            val,
            ack,
            ts: Date.now(),
            lc: Date.now(),
            from: 'test',
            q: 0,
        });
        return Promise.resolve();
    }

    /** @param id - Relative id */
    public getState(id: string): Promise<ioBroker.State | null | undefined> {
        return Promise.resolve(this.states.get(this.full(id)));
    }

    /** @param pattern - Pattern with */
    public getStates(pattern: string): Promise<Record<string, ioBroker.State | null | undefined>> {
        const regex = new RegExp(`^${this.full(pattern).replace(/[.]/g, '\\.').replace(/\*/g, '[^.]*')}$`);
        const result: Record<string, ioBroker.State> = {};
        for (const [id, state] of this.states) {
            if (regex.test(id)) {
                result[id] = state;
            }
        }
        return Promise.resolve(result);
    }

    /** @param id - Raw id */
    public sanitizeId(id: string): string {
        return id.replace(/[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu, '_');
    }

    /**
     * Current value of a state.
     *
     * @param id - Relative id
     */
    public val(id: string): ioBroker.StateValue | undefined {
        return this.states.get(this.full(id))?.val;
    }

    /**
     * Current ack flag of a state.
     *
     * @param id - Relative id
     */
    public ack(id: string): boolean | undefined {
        return this.states.get(this.full(id))?.ack;
    }

    /**
     * Simulates a user write (ack=false) and returns the full id and state for handleCommand.
     *
     * @param id - Relative id
     * @param val - Value
     */
    public userWrite(id: string, val: ioBroker.StateValue): [string, ioBroker.State] {
        const state = { val, ack: false, ts: Date.now(), lc: Date.now(), from: 'user', q: 0 } as ioBroker.State;
        this.states.set(this.full(id), state);
        return [this.full(id), state];
    }
}
