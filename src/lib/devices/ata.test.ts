import { expect } from 'chai';
import { FakePort } from '../../../test/helpers/fake-adapter';
import { CaptureLog, ManualScheduler, fixture } from '../../../test/helpers/fake-cloud';
import { parseUserContext, type AtaControlRequest, type UserContext } from '../api/types';
import { AtaDevices, OPTIMISTIC_GUARD_MS, SWING_RETRY_MAX, SWING_RETRY_WINDOW_MS } from './ata';

const LIVING = '00000000-0000-4000-8000-000000000006';
const SECOND = '00000000-0000-4000-8000-000000000008';
const L = `devices.${LIVING}`;
const S = `devices.${SECOND}`;

/**
 * common of a state object.
 *
 * @param port - Fake port
 * @param id - Relative id
 */
function stateCommon(port: FakePort, id: string): Partial<ioBroker.StateCommon> | undefined {
    return port.objects.get(`melhome.0.${id}`)?.common as Partial<ioBroker.StateCommon> | undefined;
}

function liveContext(): UserContext {
    return parseUserContext(JSON.parse(fixture('live/context.json')), () => undefined)!;
}

/**
 * Context with changed settings of the living room unit.
 *
 * @param changes - Fields to override
 */
function withLiving(changes: Partial<UserContext['ataUnits'][number]>): UserContext {
    const context = liveContext();
    context.ataUnits[0] = { ...context.ataUnits[0], ...changes };
    return context;
}

function setup(roomIcons?: Record<string, string>): {
    devices: AtaDevices;
    port: FakePort;
    scheduler: ManualScheduler;
    log: CaptureLog;
    sent: { unitId: string; request: AtaControlRequest }[];
    refreshes: number;
    advance: (ms: number) => void;
    failNext: () => void;
} {
    let clock = Date.UTC(2026, 9, 12, 20);
    let fail = false;
    const port = new FakePort();
    const scheduler = new ManualScheduler();
    const log = new CaptureLog();
    const env = {
        sent: [] as { unitId: string; request: AtaControlRequest }[],
        refreshes: 0,
    };
    const devices = new AtaDevices({
        port,
        log,
        scheduler,
        sleep: () => Promise.resolve(),
        now: () => clock,
        roomIcons,
        requestRefresh: () => {
            env.refreshes++;
        },
        client: {
            controlAta: (unitId, request) => {
                env.sent.push({ unitId, request });
                if (fail) {
                    fail = false;
                    return Promise.reject(new Error('HTTP 503'));
                }
                return Promise.resolve();
            },
        },
    });
    return {
        devices,
        port,
        scheduler,
        log,
        get sent() {
            return env.sent;
        },
        get refreshes() {
            return env.refreshes;
        },
        advance: ms => {
            clock += ms;
        },
        failNext: () => {
            fail = true;
        },
    };
}

describe('devices/ata', () => {
    describe('object tree', () => {
        it('writes the configured room icon, unknown or missing ones as auto', async () => {
            const { devices, port } = setup({ [LIVING]: 'bed' });
            await devices.update(liveContext());
            expect(port.val(`${L}.info.icon`)).to.equal('bed');
            expect(devices.listUnits().find(u => u.id === LIVING)?.name).to.equal('Living room');

            const other = setup({ [LIVING]: '<script>' });
            await other.devices.update(liveContext());
            expect(other.port.val(`${L}.info.icon`)).to.equal('auto');
        });

        it('creates device, channels and states keyed by the unit UUID', async () => {
            const { devices, port } = setup();
            await devices.update(liveContext());
            const device = port.objects.get(`melhome.0.${L}`)!;
            expect(device.type).to.equal('device');
            expect(device.common?.name).to.equal('Living room');
            expect((device.common as ioBroker.DeviceCommon).statusStates?.onlineId).to.equal(
                `melhome.0.${L}.info.deviceOnline`,
            );
            for (const id of ['info', 'control', 'energy', 'capabilities']) {
                expect(port.objects.get(`melhome.0.${L}.${id}`)?.type).to.equal('channel');
            }
            expect(port.objects.get(`melhome.0.${L}.control.power`)?.common?.role).to.equal('switch.power');
            expect(port.objects.get(`melhome.0.${L}.control.targetTemp`)?.common).to.include({
                role: 'level.temperature',
                min: 10,
                max: 31,
                step: 0.5,
                unit: '°C',
                write: true,
            });
            expect(stateCommon(port, `${L}.control.mode`)?.states).to.deep.equal({
                1: 'Heat',
                2: 'Dry',
                3: 'Cool',
                7: 'Fan',
                8: 'Auto',
            });
        });

        it('makes the horizontal vane writable only if the unit supports it', async () => {
            const { devices, port } = setup();
            await devices.update(liveContext());
            expect(stateCommon(port, `${L}.control.vaneHorizontalDirection`)?.write).to.equal(true);
            expect(stateCommon(port, `${S}.control.vaneHorizontalDirection`)?.write).to.equal(false);
            expect(port.objects.has(`melhome.0.${L}.control.standby`)).to.equal(true);
        });

        it('writes the state values as dashboard codes with ack', async () => {
            const { devices, port } = setup();
            await devices.update(liveContext());
            expect(port.val(`${L}.control.power`)).to.equal(false);
            expect(port.val(`${L}.control.mode`)).to.equal(3);
            expect(port.val(`${L}.control.targetTemp`)).to.equal(17);
            expect(port.val(`${L}.control.fanSpeed`)).to.equal(3);
            expect(port.val(`${L}.control.vaneVerticalDirection`)).to.equal(7);
            expect(port.val(`${L}.control.vaneHorizontalDirection`)).to.equal(12);
            expect(port.val(`${S}.control.mode`)).to.equal(8);
            expect(port.val(`${S}.control.vaneHorizontalDirection`)).to.equal(3);
            expect(port.val(`${L}.info.roomTemp`)).to.equal(22.5);
            expect(port.val(`${L}.info.actualFanSpeed`)).to.equal(0);
            expect(port.val(`${L}.info.deviceOnline`)).to.equal(true);
            expect(port.val(`${L}.capabilities.modes`)).to.equal('[1,2,3,7,8]');
            expect(port.ack(`${L}.control.mode`)).to.equal(true);
        });

        it('writes unchanged values only once', async () => {
            const { devices, port, advance } = setup();
            await devices.update(liveContext());
            const count = port.writes.length;
            advance(60_000);
            await devices.update(liveContext());
            // only info.lastUpdate of both units changes
            expect(port.writes.slice(count).map(w => w.id)).to.deep.equal([
                `${L}.info.lastUpdate`,
                `${S}.info.lastUpdate`,
            ]);
        });

        it('marks units that disappeared from the account as offline', async () => {
            const { devices, port, log } = setup();
            await devices.update(liveContext());
            const context = liveContext();
            context.ataUnits.splice(1, 1);
            await devices.update(context);
            expect(port.val(`${S}.info.deviceOnline`)).to.equal(false);
            expect(log.at('info').some(m => m.includes('no longer part'))).to.equal(true);
        });
    });

    describe('commands', () => {
        it('sends a debounced command, acknowledges it and refreshes', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.targetTemp`, 21));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.targetTemp`, 21.5));
            expect(env.sent).to.deep.equal([]);
            await env.scheduler.run(800);
            expect(env.sent).to.deep.equal([{ unitId: LIVING, request: { setTemperature: 21.5 } }]);
            expect(env.port.val(`${L}.control.targetTemp`)).to.equal(21.5);
            expect(env.port.ack(`${L}.control.targetTemp`)).to.equal(true);
            expect(env.refreshes).to.equal(1);
        });

        it('does not acknowledge a value from /context while the command is still queued', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.fanSpeed`, 5));
            await env.devices.update(liveContext());
            expect(env.port.val(`${L}.control.fanSpeed`)).to.equal(5);
            expect(env.port.ack(`${L}.control.fanSpeed`)).to.equal(false);
        });

        it('keeps the optimistic value until the cloud confirms it or the guard expires', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.mode`, 1));
            await env.scheduler.run(800);
            expect(env.sent[0].request).to.deep.equal({ operationMode: 'Heat' });

            // the unit has not reported yet
            await env.devices.update(liveContext());
            expect(env.port.val(`${L}.control.mode`)).to.equal(1);

            // confirmed
            await env.devices.update(withLiving({ operationMode: 'Heat' }));
            expect(env.port.val(`${L}.control.mode`)).to.equal(1);

            // changed in the official app later on - no guard any more
            await env.devices.update(withLiving({ operationMode: 'Dry' }));
            expect(env.port.val(`${L}.control.mode`)).to.equal(2);
        });

        it('shows the reported value again once the guard expired', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.fanSpeed`, 1));
            await env.scheduler.run(800);
            env.advance(OPTIMISTIC_GUARD_MS);
            await env.devices.update(liveContext());
            expect(env.port.val(`${L}.control.fanSpeed`)).to.equal(3);
        });

        it('switches on together with the current mode', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.power`, true));
            await env.scheduler.run(800);
            expect(env.sent[0].request).to.deep.equal({ power: true, operationMode: 'Cool' });
            expect(env.port.val(`${L}.control.power`)).to.equal(true);
        });

        it('restores the reported value if the cloud rejects the command', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            env.failNext();
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.fanSpeed`, 1));
            await env.scheduler.run(800);
            expect(env.port.val(`${L}.control.fanSpeed`)).to.equal(3);
            expect(env.port.ack(`${L}.control.fanSpeed`)).to.equal(true);
            expect(env.log.at('warn').some(m => m.includes('failed'))).to.equal(true);
        });

        it('rejects invalid and unsupported values without sending', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.mode`, 4));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneHorizontalDirection`, 8));
            await env.devices.handleCommand(...env.port.userWrite(`${S}.control.vaneHorizontalDirection`, 1));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.power`, 'yes'));
            expect(env.scheduler.pending).to.have.length(0);
            expect(env.sent).to.deep.equal([]);
            expect(env.port.val(`${L}.control.mode`)).to.equal(3);
            expect(env.port.val(`${S}.control.vaneHorizontalDirection`)).to.equal(3);
            expect(env.port.ack(`${L}.control.power`)).to.equal(true);
            expect(env.log.at('warn')).to.have.length(4);
        });

        it('ignores acknowledged writes and foreign ids', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(`melhome.0.${L}.control.power`, {
                val: true,
                ack: true,
            } as ioBroker.State);
            await env.devices.handleCommand('other.0.devices.x.control.power', {
                val: true,
                ack: false,
            } as ioBroker.State);
            await env.devices.handleCommand(`melhome.0.${L}.info.roomTemp`, {
                val: 1,
                ack: false,
            } as ioBroker.State);
            expect(env.scheduler.pending).to.have.length(0);
        });
    });

    describe('horizontal swing workaround', () => {
        const SWING = { unitId: LIVING, request: { vaneHorizontalDirection: 'Swing' } };

        /**
         * Sends queued commands, if any.
         *
         * @param env - Test environment
         */
        async function flush(env: ReturnType<typeof setup>): Promise<void> {
            if (env.scheduler.has(800)) {
                await env.scheduler.run(800);
            }
        }

        /** Unit at position 4, user requests swing, the cloud stores it */
        async function swingRequested(): Promise<ReturnType<typeof setup>> {
            const env = setup();
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneHorizontalDirection`, 12));
            await flush(env);
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Swing' }));
            return env;
        }

        it('repeats a vertical swing the same way, independent of the horizontal vane', async () => {
            const env = setup();
            await env.devices.update(withLiving({ vaneVerticalDirection: 'Five' }));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneVerticalDirection`, 7));
            await flush(env);
            await env.devices.update(withLiving({ vaneVerticalDirection: 'Swing' }));
            const VSWING = { unitId: LIVING, request: { vaneVerticalDirection: 'Swing' } };
            expect(env.sent).to.deep.equal([VSWING]);

            await env.devices.update(withLiving({ vaneVerticalDirection: 'Five' }));
            await flush(env);
            expect(env.sent).to.deep.equal([VSWING, VSWING]);
            expect(env.port.val(`${L}.control.vaneVerticalDirection`)).to.equal(7);
            expect(
                env.log.at('info').some(m => m.includes('vertical vane position Five - sending swing again (1/3)')),
            ).to.equal(true);
        });

        it('repeats a vane auto the same way', async () => {
            const env = setup();
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Left' }));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneHorizontalDirection`, 0));
            await flush(env);
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Auto' }));
            const AUTO = { unitId: LIVING, request: { vaneHorizontalDirection: 'Auto' } };
            expect(env.sent).to.deep.equal([AUTO]);

            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Left' }));
            await flush(env);
            expect(env.sent).to.deep.equal([AUTO, AUTO]);
            expect(env.port.val(`${L}.control.vaneHorizontalDirection`)).to.equal(0);
            expect(env.log.at('info').some(m => m.includes('vane position Left - sending auto again (1/3)'))).to.equal(
                true,
            );
        });

        it('sends swing again when the unit reports its old position', async () => {
            const env = await swingRequested();
            expect(env.sent).to.deep.equal([SWING]);

            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            await flush(env);
            expect(env.sent).to.deep.equal([SWING, SWING]);
            expect(env.port.val(`${L}.control.vaneHorizontalDirection`)).to.equal(12);
            expect(
                env.log.at('info').some(m => m.includes('position RightCentre - sending swing again (1/3)')),
            ).to.equal(true);
        });

        it('does not repeat before the cloud has stored the swing', async () => {
            const env = setup();
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneHorizontalDirection`, 12));
            await flush(env);
            // stale /context right after the command
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            await flush(env);
            expect(env.sent).to.deep.equal([SWING]);
        });

        it('leaves a different position alone (changed in the official app)', async () => {
            const env = await swingRequested();
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Left' }));
            await flush(env);
            expect(env.sent).to.deep.equal([SWING]);
        });

        it('repeats from a stale swing on any fixed position', async () => {
            // the cloud already shows swing, the unit stands somewhere else
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneHorizontalDirection`, 12));
            await flush(env);
            await env.devices.update(liveContext());
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Left' }));
            await flush(env);
            expect(env.sent).to.deep.equal([SWING, SWING]);
        });

        it('gives up after the maximum number of repetitions', async () => {
            const env = await swingRequested();
            for (let i = 0; i < 4; i++) {
                await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
                await flush(env);
                await env.devices.update(withLiving({ vaneHorizontalDirection: 'Swing' }));
            }
            expect(env.sent).to.have.length(1 + SWING_RETRY_MAX);
            expect(env.log.at('info').some(m => m.includes('giving up'))).to.equal(true);
        });

        it('stops after the retry window', async () => {
            const env = await swingRequested();
            env.advance(SWING_RETRY_WINDOW_MS);
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            await flush(env);
            expect(env.sent).to.deep.equal([SWING]);
        });

        it('is cancelled by another horizontal command', async () => {
            const env = await swingRequested();
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneHorizontalDirection`, 4));
            await flush(env);
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Swing' }));
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            await flush(env);
            expect(env.sent).to.deep.equal([
                SWING,
                { unitId: LIVING, request: { vaneHorizontalDirection: 'RightCentre' } },
            ]);
        });

        it('forgets the request if the command fails', async () => {
            const env = setup();
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            env.failNext();
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.vaneHorizontalDirection`, 12));
            await flush(env);
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'Swing' }));
            await env.devices.update(withLiving({ vaneHorizontalDirection: 'RightCentre' }));
            await flush(env);
            expect(env.sent).to.deep.equal([SWING]);
        });
    });

    describe('off timer', () => {
        it('switches the unit off when the timer elapses', async () => {
            const env = setup();
            await env.devices.update(withLiving({ power: true }));
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.offTimer`, 1));
            expect(env.port.val(`${L}.control.offTimer`)).to.equal(1);
            expect(env.port.ack(`${L}.control.offTimer`)).to.equal(true);
            expect(env.port.val(`${L}.control.offTimerRemaining`)).to.equal(60);
            env.advance(60_000);
            await env.scheduler.run(10_000);
            expect(env.port.val(`${L}.control.offTimer`)).to.equal(0);
            expect(env.port.val(`${L}.control.offTimerEnd`)).to.equal(0);
            expect(env.log.at('info')).to.include('Off timer of Living room elapsed - switching off');
            await env.scheduler.run(800);
            expect(env.sent).to.deep.equal([{ unitId: LIVING, request: { power: false } }]);
        });

        it('survives a restart through the persisted end time', async () => {
            const first = setup();
            await first.devices.update(liveContext());
            await first.devices.handleCommand(...first.port.userWrite(`${L}.control.offTimer`, 30));
            const end = first.port.val(`${L}.control.offTimerEnd`) as number;

            const second = setup();
            for (const [id, state] of first.port.states) {
                second.port.states.set(id, state);
            }
            for (const [id, obj] of first.port.objects) {
                second.port.objects.set(id, obj);
            }
            await second.devices.restoreTimers();
            expect(second.port.val(`${L}.control.offTimerEnd`)).to.equal(end);
            expect(second.port.val(`${L}.control.offTimerRemaining`)).to.equal(30 * 60);
        });

        it('rejects negative values', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.handleCommand(...env.port.userWrite(`${L}.control.offTimer`, -5));
            expect(env.port.val(`${L}.control.offTimer`)).to.equal(0);
            expect(env.port.ack(`${L}.control.offTimer`)).to.equal(true);
        });
    });

    describe('telemetry', () => {
        it('writes energy counters and persists the tracker', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            const hour = Date.UTC(2026, 9, 12, 19);
            await env.devices.onEnergy(LIVING, new Map([[hour, 300]]));
            expect(env.port.val(`${L}.energy.total`)).to.equal(0);
            await env.devices.onEnergy(LIVING, new Map([[hour, 500]]));
            expect(env.port.val(`${L}.energy.total`)).to.equal(0.2);
            expect(env.port.val(`${L}.energy.lastHour`)).to.equal(0.5);
            const native = env.port.objects.get(`melhome.0.${L}`)?.native as {
                energyTracker: { totalWh: number };
            };
            expect(native.energyTracker.totalWh).to.equal(200);
            expect(native).to.have.property('unitId', LIVING);
        });

        it('writes wifi signal and outdoor temperature', async () => {
            const env = setup();
            await env.devices.update(liveContext());
            await env.devices.onWifiSignal(LIVING, { value: -44, time: 1 });
            await env.devices.onOutdoorTemperature(LIVING, { value: 12, time: 2 });
            expect(env.port.val(`${L}.info.wifiSignal`)).to.equal(-44);
            expect(env.port.val(`${L}.info.outdoorTemp`)).to.equal(12);
            expect(env.port.val(`${L}.info.outdoorTempTime`)).to.equal(2);
        });
    });
});
