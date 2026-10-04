import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { LEDGER_VARIABLE } from '../ledger.ts';
import { Ledger } from '../owned-sessions.ts';
import { openSession } from '../session.ts';
import { rejection, scriptDir, START_HOOK } from './scripts.ts';

const OWNED_SESSIONS = path.join(import.meta.dir, '..', 'owned-sessions.ts');
const SLOW_STOP_MS = 1000;
const dir = scriptDir('owned-sessions');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const RUNNER = `
import { Ledger } from ${JSON.stringify(OWNED_SESSIONS)};
const ledger = new Ledger();
const child = Bun.spawn(['sh', '-c', 'trap "sleep ${SLOW_STOP_MS / 1000}; exit 0" INT; while :; do sleep 0.05; done'], {
  stdout: 'ignore',
});
ledger.adopt(child);
await Bun.sleep(200);
console.log(ledger.env[${JSON.stringify(LEDGER_VARIABLE)}], child.pid);
await Bun.sleep(60_000);
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    if (text.includes('\n')) {
      break;
    }
  }
  return text.split('\n')[0] ?? '';
}

describe('interrupting a probe', () => {
  test('a second Ctrl-C waits for Droid to stop and its sessions to be cleaned before exiting', async () => {
    const runner = path.join(dir, 'runner.ts');
    await Bun.write(runner, RUNNER);
    const probe = Bun.spawn([process.execPath, runner], { stdout: 'pipe', stderr: 'pipe' });
    const line = await firstLine(probe.stdout);
    const [ledger = '', pid = ''] = line.split(' ');
    const ready = { ledger, child: Number(pid) };
    expect(existsSync(ready.ledger)).toBe(true);

    const interruptedAt = performance.now();
    probe.kill('SIGINT');
    await delay(100);
    probe.kill('SIGINT');
    const code = await probe.exited;
    const elapsedMs = performance.now() - interruptedAt;

    expect(code).toBe(130);
    expect(elapsedMs).toBeGreaterThanOrEqual(SLOW_STOP_MS - 100);
    expect(alive(ready.child)).toBe(false);
    expect(existsSync(ready.ledger)).toBe(false);
    expect(await new Response(probe.stderr).text()).toContain('still cleaning up');
  });
});

const LOOP = ['trap "exit 0" INT', 'while :; do sleep 0.05; done'];

const SESSION_ID = '0b7e3f1a-5c2d-4e8f-9a1b-2c3d4e5f6a7b';

function sessionRunner(boundMs: number, then: 'wait' | 'release', child: string): string {
  return `
import { existsSync } from 'node:fs';
import { Ledger } from ${JSON.stringify(OWNED_SESSIONS)};
const ledger = new Ledger(${JSON.stringify(dir)}, ${boundMs});
const transcript = Bun.env.TRANSCRIPT ?? '';
const child = Bun.spawn(['sh', '-c', ${JSON.stringify(child)}], {
  env: { PATH: Bun.env.PATH ?? '', TRANSCRIPT: transcript, ...ledger.env },
  stdout: 'ignore',
});
ledger.adopt(child);
ledger.expectSession();
while (!existsSync(transcript)) await Bun.sleep(10);
console.log(ledger.env[${JSON.stringify(LEDGER_VARIABLE)}], child.pid);
if (${JSON.stringify(then)} === 'release') {
  try {
    await ledger.release();
    console.error('released');
  } catch (error) {
    console.error('failed:', error.message.split('\\n')[0]);
  }
  console.error('child', child.exitCode);
} else {
  await Bun.sleep(60_000);
}
`;
}

function hookRecord(event: string): string {
  const record = `{"session_id":"${SESSION_ID}","transcript_path":"%s","hook_event_name":"${event}"}`;
  return `printf '${record}' "$TRANSCRIPT" > "$${LEDGER_VARIABLE}/${event}"`;
}

const CREATE_TRANSCRIPT = 'mkdir -p "$(dirname "$TRANSCRIPT")"; : > "$TRANSCRIPT"';

async function runSessionProbe(
  name: string,
  runner: string,
): Promise<{
  probe: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  transcript: string;
  ledger: string;
}> {
  const home = path.join(dir, `${name}-home`);
  const transcript = path.join(home, '.factory', 'sessions', '-scratch', `${SESSION_ID}.jsonl`);
  const file = path.join(dir, `${name}.ts`);
  await Bun.write(file, runner);
  const probe = Bun.spawn([process.execPath, file], {
    env: { ...Bun.env, HOME: home, TRANSCRIPT: transcript },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const line = await firstLine(probe.stdout);
  const [ledger = ''] = line.split(' ');
  return { probe, transcript, ledger };
}

describe('the cleanup order', () => {
  test('a Ctrl-C while the record is on its way waits for it, then deletes the session', async () => {
    const child = [
      CREATE_TRANSCRIPT,
      'trap "exit 0" INT',
      'sleep 0.8 & wait $!',
      hookRecord('SessionStart'),
      ...LOOP,
    ].join('\n');
    const { probe, transcript, ledger } = await runSessionProbe(
      'pending',
      sessionRunner(5000, 'wait', child),
    );
    expect(existsSync(transcript)).toBe(true);
    await delay(100);
    const interruptedAt = performance.now();
    probe.kill('SIGINT');
    const code = await probe.exited;

    expect(code).toBe(130);
    const elapsedMs = performance.now() - interruptedAt;
    expect(elapsedMs).toBeGreaterThanOrEqual(500);
    expect(elapsedMs).toBeLessThan(3000);
    expect(existsSync(transcript)).toBe(false);
    expect(existsSync(ledger)).toBe(false);
    expect(await new Response(probe.stderr).text()).not.toContain('ran neither');
  }, 15_000);

  test('an end record written while Droid stops counts, so the release succeeds', async () => {
    const child = [
      CREATE_TRANSCRIPT,
      `trap '${hookRecord('SessionEnd').replaceAll("'", `'"'"'`)}; exit 0' INT`,
      'while :; do sleep 0.05; done',
    ].join('\n');
    const { probe, transcript } = await runSessionProbe(
      'end-only',
      sessionRunner(200, 'release', child),
    );
    const output = await new Response(probe.stderr).text();
    await probe.exited;

    expect(output).toContain('released');
    expect(output).not.toContain('failed');
    expect(output).toContain('child 0');
    expect(existsSync(transcript)).toBe(false);
  });

  test('a Ctrl-C with no record ever prints the loud message, then exits 130', async () => {
    const child = [CREATE_TRANSCRIPT, ...LOOP].join('\n');
    const { probe } = await runSessionProbe('no-record', sessionRunner(200, 'wait', child));
    probe.kill('SIGINT');
    const code = await probe.exited;
    const stderr = await new Response(probe.stderr).text();

    expect(code).toBe(130);
    expect(stderr).toContain("ran neither the probe's SessionStart nor its SessionEnd hook");
    expect(stderr).toContain(`-${realpathSync(dir).slice(1).replaceAll('/', '-')}`);
    expect(stderr.indexOf('interrupted')).toBeLessThan(stderr.indexOf('ran neither'));
  });
});

function spawnFake(ledger: Ledger, lines: readonly string[]): Bun.Subprocess {
  const child = Bun.spawn(['sh', '-c', lines.join('\n')], {
    env: { PATH: Bun.env['PATH'] ?? '', ...ledger.env },
    stdout: 'ignore',
  });
  ledger.adopt(child);
  return child;
}

describe('confirming that Droid reported its session', () => {
  test('a release that finds no start record stops Droid, cleans up, then fails naming the folder', async () => {
    const listeners = process.listenerCount('SIGINT');
    const ledger = new Ledger(dir, 200);
    const ledgerDir = ledger.env[LEDGER_VARIABLE] ?? '';
    const child = spawnFake(ledger, LOOP);
    ledger.expectSession();
    const message = await rejection(ledger.release());
    expect(message).toContain(
      "ran neither the probe's SessionStart nor its SessionEnd hook within 200ms",
    );
    expect(message).toContain(`-${realpathSync(dir).slice(1).replaceAll('/', '-')}`);
    expect(child.signalCode ?? child.exitCode).toBe(0);
    expect(existsSync(ledgerDir)).toBe(false);
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  test('a release waits for a start record that is still on its way', async () => {
    const ledger = new Ledger(dir, 5000);
    spawnFake(ledger, ['sleep 0.3', START_HOOK, ...LOOP]);
    ledger.expectSession();
    const started = performance.now();
    await ledger.release();
    expect(performance.now() - started).toBeGreaterThanOrEqual(250);
  });

  test('does not wait out the bound for a Droid that already exited', async () => {
    const ledger = new Ledger(dir, 5000);
    const child = spawnFake(ledger, ['exit 3']);
    await child.exited;
    ledger.expectSession();
    const started = performance.now();
    const message = await rejection(ledger.release());
    expect(message).toContain('Droid had already exited with code 3');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('asks for nothing when the caller expected no session', async () => {
    const ledger = new Ledger(dir, 5000);
    const child = spawnFake(ledger, ['exit 0']);
    await child.exited;
    await ledger.release();
  });
});

describe('opening a session', () => {
  test('a binary that fails to spawn releases its ledger and its signal handlers', async () => {
    const temp = path.join(dir, 'tmp');
    mkdirSync(temp);
    const previous = Bun.env['TMPDIR'] ?? tmpdir();
    const interrupts = process.listenerCount('SIGINT');
    const terminations = process.listenerCount('SIGTERM');
    Bun.env['TMPDIR'] = temp;
    try {
      await rejection(openSession(path.join(dir, 'no-such-droid')));
    } finally {
      Bun.env['TMPDIR'] = previous;
    }
    expect(process.listenerCount('SIGINT')).toBe(interrupts);
    expect(process.listenerCount('SIGTERM')).toBe(terminations);
    expect(readdirSync(temp)).toEqual([]);
  });
});
