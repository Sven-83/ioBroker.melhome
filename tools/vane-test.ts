/*
 * Controlled single-command test for the horizontal vane (developer tool, not part of the adapter).
 *
 *   npm run vane-test
 *
 * - asks for e-mail and password on the terminal (hidden input), stores them nowhere
 * - sends exactly ONE control request (vaneHorizontalDirection only) after explicit confirmation
 * - watches /context for 3 minutes and reports whether the unit takes over the value
 * - offers to restore the previous value (again only after confirmation)
 */

import { createInterface } from 'node:readline';
import { AuthClient, TokenManager } from '../src/lib/api/auth';
import { MelCloudHomeClient } from '../src/lib/api/client';
import { describeError } from '../src/lib/api/errors';
import { HttpTransport, type Logger } from '../src/lib/api/http';
import type { AtaUnit, VaneHorizontalDirection } from '../src/lib/api/types';

const WATCH_MS = 3 * 60_000;
const POLL_MS = 20_000;

const quietLog: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: message => console.log(`  (warning: ${message})`),
    error: message => console.log(`  (error: ${message})`),
};

function ask(question: string, hidden = false): Promise<string> {
    return new Promise(resolve => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string): void => {
                if (s.startsWith(question)) {
                    process.stdout.write(question);
                }
            };
        }
        rl.question(question, answer => {
            rl.close();
            if (hidden) {
                process.stdout.write('\n');
            }
            resolve(answer.trim());
        });
    });
}

const confirmed = (answer: string): boolean => ['ja', 'j', 'yes', 'y'].includes(answer.toLowerCase());
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function watch(client: MelCloudHomeClient, unitId: string, expected: VaneHorizontalDirection): Promise<boolean> {
    const started = Date.now();
    let last: string | null | undefined;
    while (Date.now() - started < WATCH_MS) {
        await sleep(POLL_MS);
        const unit = (await client.getContext()).ataUnits.find(u => u.id === unitId);
        const value = unit?.vaneHorizontalDirection;
        const seconds = Math.round((Date.now() - started) / 1000);
        if (value !== last) {
            console.log(`  after ${seconds} s: cloud reports ${value ?? 'unknown'}`);
            last = value;
        } else {
            console.log(`  after ${seconds} s: unchanged`);
        }
        if (value === expected) {
            return true;
        }
    }
    return false;
}

async function main(): Promise<void> {
    console.log('Horizontal vane test - sends ONE command only after your confirmation.\n');
    const email = await ask('MELCloud Home e-mail: ');
    const password = await ask('MELCloud Home password (hidden): ', true);
    if (!email || !password) {
        console.log('Aborted.');
        return;
    }

    const http = new HttpTransport();
    const tokens = new TokenManager(new AuthClient(http), { email, password }, quietLog);
    const client = new MelCloudHomeClient({ http, tokens, log: quietLog });

    const units = (await client.getContext()).ataUnits;
    console.log('\nUnits:');
    units.forEach((u: AtaUnit, i) =>
        console.log(
            `  ${i + 1}) ${u.name} - power ${u.power ? 'on' : 'off'}, horizontal vane ${u.vaneHorizontalDirection ?? '?'}, supportsWideVane=${u.capabilities.supportsWideVane}`,
        ),
    );
    const choice = Number(await ask('\nWhich unit (number)? '));
    const unit = units[choice - 1];
    if (!unit) {
        console.log('Aborted.');
        return;
    }
    const original = unit.vaneHorizontalDirection;
    const target: VaneHorizontalDirection = original === 'Left' ? 'Right' : 'Left';

    console.log(`\n${unit.name}: horizontal vane ${original ?? '?'} -> ${target}`);
    console.log('Tip: if the unit is on, you can watch the vane move. Nothing else is changed.');
    if (!confirmed(await ask('Send this ONE command now? (ja/nein) '))) {
        console.log('Nothing sent.');
        return;
    }
    await client.controlAta(unit.id, { vaneHorizontalDirection: target });
    console.log('  command accepted by the cloud (HTTP 200) - watching for up to 3 min...');
    const applied = await watch(client, unit.id, target);
    console.log(
        applied
            ? `\nRESULT: the unit reports ${target} - the horizontal vane CAN be controlled.`
            : `\nRESULT: the unit did NOT report ${target} within 3 min.`,
    );
    console.log('Did the vane physically move? Please note it for the chat.');

    if (original && original !== target) {
        if (confirmed(await ask(`\nRestore the previous value ${original}? (ja/nein) `))) {
            await client.controlAta(unit.id, { vaneHorizontalDirection: original });
            console.log(`  restore command for ${original} accepted.`);
        }
    }
}

main()
    .catch(error => {
        console.error(`Test failed: ${describeError(error)}`);
        process.exitCode = 1;
    })
    .finally(() => process.exit());
