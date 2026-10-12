import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { CaptureLog, EMAIL, FakeCloud, PASSWORD } from '../../../test/helpers/fake-cloud';
import {
    AuthClient,
    TokenManager,
    extractAuthCode,
    extractCallbackQuery,
    extractCsrfToken,
    generatePkce,
} from './auth';
import {
    CredentialsRejectedError,
    LoginFlowError,
    NetworkError,
    ServiceUnavailableError,
    TokenRejectedError,
} from './errors';
import { HttpTransport } from './http';

const credentials = { email: EMAIL, password: PASSWORD };

function setup(now: () => number = Date.now): { cloud: FakeCloud; auth: AuthClient } {
    const cloud = new FakeCloud();
    const http = new HttpTransport({ fetch: cloud.fetch, minIntervalMs: 0 });
    return { cloud, auth: new AuthClient(http, { now }) };
}

describe('api/auth', () => {
    describe('helpers', () => {
        it('creates a valid S256 PKCE pair', () => {
            const { verifier, challenge } = generatePkce();
            expect(verifier).to.match(/^[\w-]{43}$/);
            expect(challenge).to.equal(createHash('sha256').update(verifier).digest('base64url'));
            expect(generatePkce().verifier).to.not.equal(verifier);
        });

        it('finds the CSRF token regardless of attribute order', () => {
            expect(extractCsrfToken('<input type="hidden" name="_csrf" value="a1">')).to.equal('a1');
            expect(extractCsrfToken('<input value="b2" type="hidden" name="_csrf"/>')).to.equal('b2');
            expect(extractCsrfToken('<INPUT NAME="_csrf" VALUE="c3">')).to.equal('c3');
            expect(extractCsrfToken('<input name="other" value="x">')).to.equal(undefined);
        });

        it('extracts code and callback with HTML entities', () => {
            expect(extractAuthCode('melcloudhome://?code=A%2BB&state=1')).to.equal('A+B');
            expect(extractAuthCode('<a href="/x?state=1&amp;code=XYZ">')).to.equal('XYZ');
            expect(extractAuthCode('decode=1')).to.equal(undefined);
            expect(extractCallbackQuery('<a href="/connect/authorize/callback?a=1&amp;b=2">')).to.equal('a=1&b=2');
        });
    });

    describe('AuthClient.login', () => {
        it('runs the full PKCE + Cognito flow', async () => {
            const { cloud, auth } = setup(() => 1_000_000);
            const tokens = await auth.login(credentials);
            expect(tokens.accessToken).to.match(/^access-/);
            expect(tokens.refreshToken).to.match(/^refresh-/);
            expect(tokens.expiresAt).to.equal(1_000_000 + 3600 * 1000);
            expect(cloud.loginCount).to.equal(1);
            const credentialPost = cloud.requests.find(r => r.method === 'POST' && r.url.includes('/login'));
            expect(credentialPost?.headers.get('origin')).to.equal(
                'https://live-melcloudhome.auth.eu-west-1.amazoncognito.com',
            );
            expect(credentialPost?.headers.get('user-agent')).to.include('iPhone');
        });

        it('uses the shortcut if the identity server still has a session', async () => {
            const { cloud, auth } = setup();
            cloud.sessionShortcut = true;
            await auth.login(credentials);
            expect(cloud.loginCount).to.equal(1);
            expect(cloud.requests.some(r => r.method === 'POST' && r.url.includes('amazoncognito'))).to.equal(false);
        });

        it('reports rejected credentials', async () => {
            const { cloud, auth } = setup();
            cloud.password = 'something else';
            await expect(auth.login(credentials)).to.be.rejectedWith(CredentialsRejectedError);
        });

        it('reports a changed login page as flow error', async () => {
            const { cloud, auth } = setup();
            cloud.loginPage = '<html><form><input name="username"></form></html>';
            await expect(auth.login(credentials)).to.be.rejectedWith(LoginFlowError, 'CSRF');
        });

        it('maps HTTP 5xx during login to ServiceUnavailableError', async () => {
            const { cloud, auth } = setup();
            cloud.faults.push({ match: /connect\/par/, response: 503 });
            await expect(auth.login(credentials)).to.be.rejectedWith(ServiceUnavailableError);
        });

        it('maps unexpected PAR answers to LoginFlowError', async () => {
            const { cloud, auth } = setup();
            cloud.faults.push({ match: /connect\/par/, response: 400 });
            await expect(auth.login(credentials)).to.be.rejectedWith(LoginFlowError, 'PAR');
        });

        it('maps network failures to NetworkError', async () => {
            const { cloud, auth } = setup();
            cloud.faults.push({ match: /amazoncognito/, response: 'network' });
            await expect(auth.login(credentials)).to.be.rejectedWith(NetworkError);
        });

        it('never puts credentials into error messages', async () => {
            const { cloud, auth } = setup();
            cloud.password = 'other';
            const error = await auth.login(credentials).catch((e: Error) => e);
            expect((error as Error).message)
                .to.not.include(PASSWORD)
                .and.not.include(EMAIL);
        });
    });

    describe('AuthClient.refresh', () => {
        it('rotates the refresh token', async () => {
            const { cloud, auth } = setup();
            const first = await auth.login(credentials);
            const second = await auth.refresh(first.refreshToken!);
            expect(second.refreshToken).to.not.equal(first.refreshToken);
            expect(cloud.refreshCount).to.equal(1);
            // single use: the old token is now invalid
            await expect(auth.refresh(first.refreshToken!)).to.be.rejectedWith(TokenRejectedError);
        });

        it('distinguishes rejection from outage', async () => {
            const { cloud, auth } = setup();
            const tokens = await auth.login(credentials);
            cloud.faults.push({ match: /connect\/token/, response: 502 });
            await expect(auth.refresh(tokens.refreshToken!)).to.be.rejectedWith(ServiceUnavailableError);
            cloud.rejectRefresh = true;
            await expect(auth.refresh(tokens.refreshToken!)).to.be.rejectedWith(TokenRejectedError);
        });
    });

    describe('TokenManager', () => {
        let clock: number;
        let cloud: FakeCloud;
        let log: CaptureLog;
        let manager: TokenManager;

        beforeEach(() => {
            clock = 1_000_000;
            const env = setup(() => clock);
            cloud = env.cloud;
            log = new CaptureLog();
            manager = new TokenManager(env.auth, credentials, log, () => clock);
        });

        it('logs in once and reuses the token', async () => {
            const a = await manager.getAccessToken();
            const b = await manager.getAccessToken();
            expect(a).to.equal(b);
            expect(cloud.loginCount).to.equal(1);
        });

        it('refreshes 60 s before expiry', async () => {
            const a = await manager.getAccessToken();
            clock += 3600_000 - 61_000;
            expect(await manager.getAccessToken()).to.equal(a);
            clock += 2000;
            expect(await manager.getAccessToken()).to.not.equal(a);
            expect(cloud.refreshCount).to.equal(1);
            expect(cloud.loginCount).to.equal(1);
        });

        it('never refreshes in parallel', async () => {
            await manager.getAccessToken();
            manager.invalidateAccessToken();
            const tokens = await Promise.all([
                manager.getAccessToken(),
                manager.getAccessToken(),
                manager.getAccessToken(),
            ]);
            expect(new Set(tokens).size).to.equal(1);
            expect(cloud.refreshCount).to.equal(1);
        });

        it('logs in again if the refresh token is rejected', async () => {
            await manager.getAccessToken();
            cloud.rejectRefresh = true;
            manager.invalidateAccessToken();
            await manager.getAccessToken();
            expect(cloud.loginCount).to.equal(2);
            expect(log.at('info')).to.include('MELCloud Home session expired - logging in again');
        });

        it('keeps the refresh token during an outage instead of logging in', async () => {
            await manager.getAccessToken();
            manager.invalidateAccessToken();
            cloud.faults.push({ match: /connect\/token/, response: 'network' });
            await expect(manager.getAccessToken()).to.be.rejectedWith(NetworkError);
            await manager.getAccessToken();
            expect(cloud.loginCount).to.equal(1);
            expect(cloud.refreshCount).to.equal(1);
        });

        it('forceLogin performs a full login', async () => {
            await manager.getAccessToken();
            manager.forceLogin();
            await manager.getAccessToken();
            expect(cloud.loginCount).to.equal(2);
            expect(cloud.refreshCount).to.equal(0);
        });

        it('never logs tokens or credentials', async () => {
            await manager.getAccessToken();
            cloud.rejectRefresh = true;
            manager.invalidateAccessToken();
            await manager.getAccessToken();
            expect(log.text).to.not.match(/access-|refresh-|code-/);
            expect(log.text).to.not.include(PASSWORD).and.not.include(EMAIL);
        });
    });
});
