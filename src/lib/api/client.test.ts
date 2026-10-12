import { expect } from 'chai';
import { CaptureLog, EMAIL, FakeCloud, PASSWORD } from '../../../test/helpers/fake-cloud';
import { AuthClient, TokenManager } from './auth';
import { MelCloudHomeClient, formatReportTime, formatTelemetryTime } from './client';
import { ApiError, NetworkError, ServiceUnavailableError, TokenRejectedError } from './errors';
import { HttpTransport } from './http';

const UNIT = '00000000-0000-4000-8000-000000000001';

function setup(now = Date.UTC(2025, 11, 9, 9, 41, 27)): {
    cloud: FakeCloud;
    client: MelCloudHomeClient;
    log: CaptureLog;
    sleeps: number[];
} {
    const cloud = new FakeCloud();
    const log = new CaptureLog();
    const sleeps: number[] = [];
    const http = new HttpTransport({ fetch: cloud.fetch, minIntervalMs: 0 });
    const tokens = new TokenManager(new AuthClient(http), { email: EMAIL, password: PASSWORD }, log);
    const client = new MelCloudHomeClient({
        http,
        tokens,
        log,
        now: () => now,
        sleep: ms => {
            sleeps.push(ms);
            return Promise.resolve();
        },
    });
    return { cloud, client, log, sleeps };
}

describe('api/client', () => {
    it('formats the query timestamps', () => {
        const t = Date.UTC(2025, 11, 9, 9, 5, 7);
        expect(formatTelemetryTime(t)).to.equal('2025-12-09 09:05');
        expect(formatReportTime(t)).to.equal('2025-12-09T09:05:07.0000000Z');
    });

    describe('getContext', () => {
        it('logs in, fetches and parses /context (text/plain)', async () => {
            const { cloud, client } = setup();
            const context = await client.getContext();
            expect(context.ataUnits).to.have.length(3);
            expect(cloud.loginCount).to.equal(1);
            const request = cloud.requests.find(r => r.url.endsWith('/context'));
            expect(request?.headers.get('user-agent')).to.include('MonitorAndControl.App.Mobile');
            expect(request?.headers.get('authorization')).to.match(/^Bearer access-/);
        });

        it('warns about unknown values only once', async () => {
            const { client, log } = setup();
            await client.getContext();
            await client.getContext();
            expect(log.at('warn').filter(m => m.includes('Turbo'))).to.have.length(1);
        });

        it('refreshes the token after HTTP 401 and retries', async () => {
            const { cloud, client } = setup();
            await client.getContext();
            cloud.expireAccessTokens();
            await client.getContext();
            expect(cloud.refreshCount).to.equal(1);
            expect(cloud.loginCount).to.equal(1);
        });

        it('logs in again if the refreshed token is still rejected', async () => {
            const { cloud, client } = setup();
            await client.getContext();
            cloud.expireAccessTokens();
            cloud.faults.push({ match: /\/context$/, response: 401 });
            cloud.faults.push({ match: /\/context$/, response: 401 });
            await client.getContext();
            expect(cloud.refreshCount).to.equal(1);
            expect(cloud.loginCount).to.equal(2);
        });

        it('gives up after a fresh login is still unauthorised', async () => {
            const { cloud, client } = setup();
            for (let i = 0; i < 3; i++) {
                cloud.faults.push({ match: /\/context$/, response: 401 });
            }
            await expect(client.getContext()).to.be.rejectedWith(TokenRejectedError);
        });

        it('retries a GET once after HTTP 5xx', async () => {
            const { cloud, client, sleeps } = setup();
            cloud.faults.push({ match: /\/context$/, response: 503 });
            await client.getContext();
            expect(sleeps).to.deep.equal([5000]);
        });

        it('fails after the retry also failed', async () => {
            const { cloud, client } = setup();
            cloud.faults.push({ match: /\/context$/, response: 503 }, { match: /\/context$/, response: 500 });
            await expect(client.getContext()).to.be.rejectedWith(ServiceUnavailableError);
            cloud.faults.push(
                { match: /\/context$/, response: 'network' },
                { match: /\/context$/, response: 'network' },
            );
            await expect(client.getContext()).to.be.rejectedWith(NetworkError);
        });

        it('does not retry client errors', async () => {
            const { cloud, client, sleeps } = setup();
            cloud.faults.push({ match: /\/context$/, response: 404 });
            await expect(client.getContext()).to.be.rejectedWith(ApiError, 'HTTP 404');
            expect(sleeps).to.deep.equal([]);
        });

        it('rejects invalid JSON', async () => {
            const { cloud, client } = setup();
            cloud.contextBody = '<html>maintenance</html>';
            await expect(client.getContext()).to.be.rejectedWith(ApiError, 'invalid JSON');
        });
    });

    describe('controlAta', () => {
        it('sends all 8 fields as JSON', async () => {
            const { cloud, client } = setup();
            await client.controlAta(UNIT, { power: true, operationMode: 'Heat', setTemperature: 22 });
            expect(cloud.controlBodies).to.deep.equal([
                {
                    power: true,
                    operationMode: 'Heat',
                    setFanSpeed: null,
                    vaneHorizontalDirection: null,
                    vaneVerticalDirection: null,
                    setTemperature: 22,
                    temperatureIncrementOverride: null,
                    inStandbyMode: null,
                },
            ]);
            const put = cloud.requests.find(r => r.method === 'PUT');
            expect(put?.url).to.match(new RegExp(`/monitor/ataunit/${UNIT}$`));
            expect(put?.headers.get('content-type')).to.equal('application/json; charset=utf-8');
        });

        it('refuses both vane axes in one request', async () => {
            const { client } = setup();
            await expect(
                client.controlAta(UNIT, { vaneHorizontalDirection: 'Left', vaneVerticalDirection: 'One' }),
            ).to.be.rejectedWith(RangeError);
        });

        it('refuses power on without operation mode', async () => {
            const { client } = setup();
            await expect(client.controlAta(UNIT, { power: true })).to.be.rejectedWith(RangeError);
            await client.controlAta(UNIT, { power: false });
        });

        it('is never retried automatically', async () => {
            const { cloud, client, sleeps } = setup();
            await client.getContext();
            cloud.faults.push({ match: /monitor\/ataunit/, response: 503 });
            await expect(client.controlAta(UNIT, { setTemperature: 21 })).to.be.rejectedWith(ServiceUnavailableError);
            expect(sleeps).to.deep.equal([]);
            expect(cloud.count('/monitor/ataunit/')).to.equal(1);
        });
    });

    describe('telemetry', () => {
        it('requests energy from a full hour and parses Wh values', async () => {
            const { cloud, client } = setup();
            const energy = await client.getHourlyEnergy(UNIT);
            const url = new URL(cloud.requests.find(r => r.url.includes('/energy/'))!.url);
            expect(url.searchParams.get('from')).to.equal('2025-12-08 10:00');
            expect(url.searchParams.get('to')).to.equal('2025-12-09 09:41');
            expect(url.searchParams.get('interval')).to.equal('Hour');
            expect(energy.get(Date.UTC(2025, 11, 9, 9))).to.equal(450);
        });

        it('requests rssi for exactly one hour', async () => {
            const { cloud, client } = setup();
            const reading = await client.getWifiSignal(UNIT);
            const url = new URL(cloud.requests.find(r => r.url.includes('/actual/'))!.url);
            expect(url.searchParams.get('from')).to.equal('2025-12-09 08:41');
            expect(url.searchParams.get('to')).to.equal('2025-12-09 09:41');
            expect(url.searchParams.get('measure')).to.equal('rssi');
            expect(reading?.value).to.equal(-61);
        });

        it('requests the 48 h trend report with Z timestamps on second 0', async () => {
            const { cloud, client } = setup();
            const reading = await client.getOutdoorTemperature(UNIT, 'Europe/Berlin');
            const url = new URL(cloud.requests.find(r => r.url.includes('trendsummary'))!.url);
            expect(url.searchParams.get('to')).to.equal('2025-12-09T09:41:00.0000000Z');
            expect(url.searchParams.get('from')).to.equal('2025-12-07T09:41:00.0000000Z');
            expect(url.searchParams.get('period')).to.equal('Hourly');
            expect(reading?.value).to.equal(4);
        });

        it('treats HTTP 304 as no data', async () => {
            const { cloud, client } = setup();
            cloud.faults.push({ match: /\/energy\//, response: 304 });
            expect((await client.getHourlyEnergy(UNIT)).size).to.equal(0);
        });
    });

    it('fetches the WebSocket credential', async () => {
        const { client } = setup();
        expect(await client.getWebSocketHash()).to.equal('ws-secret-hash');
    });

    it('never logs tokens, credentials or the WebSocket hash', async () => {
        const { cloud, client, log } = setup();
        await client.getContext();
        cloud.expireAccessTokens();
        await client.getContext();
        await client.getWebSocketHash();
        await client.controlAta(UNIT, { setTemperature: 21 });
        expect(log.text).to.not.match(/access-\d|refresh-\d|code-\d|ws-secret-hash/);
        expect(log.text).to.not.include(PASSWORD).and.not.include(EMAIL);
        expect(log.text).to.not.include('6x2dgdulg7omjsxalnhmo4ynba0dcgwk');
    });
});
