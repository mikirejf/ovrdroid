import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ovrdroidFile } from '../paths.ts';

export const PAINT_MARKER = '╰';
export const TERMINAL_SIZE = { cols: 120, rows: 40 } as const;
const CTRL_C = '\u0003';
const ESC = '\u001B';
export const PAINT_TIMEOUT_MS = 20_000;
const EXIT_TIMEOUT_MS = 10_000;
const SECOND_CTRL_C_MS = 50;
const INTERRUPTED_EXIT_CODE = 130;
const DEFAULT_SETTLE_MS = 300;
const INJECTED_PREFIXES = ['FACTORY_', 'DROID_', 'HERDR_'];
const AUTO_UPDATE = 'FACTORY_DROID_AUTO_UPDATE_ENABLED';
const RUNTIME_SETTINGS = 'FACTORY_RUNTIME_SETTINGS_PATH';
export const SILENT_SETTINGS_FILE = ovrdroidFile('probe-settings.json');
const SILENT_SETTINGS = { completionSound: 'off', awaitingInputSound: 'off' };
const WINDOW = 64;

export type LaunchEnv = Record<string, string>;

const PROBE_REPLIES: readonly (readonly [string, string])[] = [
  [`${ESC}[c`, `${ESC}[?62;22c`],
  [`${ESC}[?u`, `${ESC}[?0u`],
  [`${ESC}]11;?`, `${ESC}]11;rgb:1e1e/1e1e/1e1e${ESC}\\`],
  [`${ESC}P$qm${ESC}\\`, `${ESC}P1$r48:2::1:2:3m${ESC}\\`],
];

export function probeAnswerer(): (terminal: Bun.Terminal, text: string) => void {
  const answered = new Set<string>();
  let tail = '';

  return (terminal, text) => {
    tail += text;
    for (const [query, reply] of PROBE_REPLIES) {
      if (!answered.has(query) && tail.includes(query)) {
        answered.add(query);
        terminal.write(reply);
      }
    }
    tail = tail.slice(-WINDOW);
  };
}

export interface LaunchOptions {
  env?: LaunchEnv;
  settleMs?: number;
  paintTimeoutMs?: number;
}

export interface LaunchResult {
  paintMs: number;
  exitMs: number;
  pid: number;
}

function isInjected(key: string): boolean {
  return key === 'FORCE_COLOR' || INJECTED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function writeSilentSettings(): string {
  mkdirSync(path.dirname(SILENT_SETTINGS_FILE), { recursive: true });
  writeFileSync(SILENT_SETTINGS_FILE, JSON.stringify(SILENT_SETTINGS));
  return SILENT_SETTINGS_FILE;
}

export function launchEnv(extra: LaunchEnv = {}) {
  const env: LaunchEnv = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value === 'string' && !isInjected(key)) {
      env[key] = value;
    }
  }
  env['TERM'] = 'xterm-256color';
  env[AUTO_UPDATE] = 'false';
  env[RUNTIME_SETTINGS] = writeSilentSettings();
  return Object.assign(env, extra);
}

async function expire(ms: number, message: string, signal: AbortSignal): Promise<never> {
  await delay(ms, undefined, { signal });
  throw new Error(message);
}

export async function race<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  const cancel = new AbortController();
  const deadline = expire(ms, message, cancel.signal);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    cancel.abort();
  }
}

type Child = Bun.Subprocess;

function deathOf(child: Child): string | undefined {
  if (child.signalCode !== null) {
    return `signal ${child.signalCode}`;
  }
  return child.exitCode === null ? undefined : `code ${child.exitCode}`;
}

function assertRunning(child: Child): void {
  const death = deathOf(child);
  if (death !== undefined) {
    throw new Error(`exited with ${death} before settling; paint time is meaningless`);
  }
}

export async function dies(child: Child): Promise<never> {
  await child.exited;
  throw new Error(`exited with ${deathOf(child) ?? 'no status'} before painting`);
}

function assertCleanExit(child: Child): void {
  if (
    child.signalCode === 'SIGINT' ||
    child.exitCode === 0 ||
    child.exitCode === INTERRUPTED_EXIT_CODE
  ) {
    return;
  }
  throw new Error(`exited with ${deathOf(child) ?? 'no status'} after Ctrl-C`);
}

export async function launch(target: string, options: LaunchOptions = {}): Promise<LaunchResult> {
  const decoder = new TextDecoder();
  const paint = Promise.withResolvers<number>();
  const answerProbes = probeAnswerer();

  await using terminal = new Bun.Terminal({
    ...TERMINAL_SIZE,
    data(self, chunk) {
      const text = decoder.decode(chunk, { stream: true });
      answerProbes(self, text);
      if (text.includes(PAINT_MARKER)) {
        paint.resolve(performance.now());
      }
    },
  });

  const spawnedAt = performance.now();
  const child = Bun.spawn([target], { terminal, env: launchEnv(options.env) });

  try {
    const paintTimeoutMs = options.paintTimeoutMs ?? PAINT_TIMEOUT_MS;
    const paintedAt = await race(
      Promise.race([paint.promise, dies(child)]),
      paintTimeoutMs,
      `no input box after ${paintTimeoutMs}ms`,
    );
    const paintMs = paintedAt - spawnedAt;

    await Bun.sleep(options.settleMs ?? DEFAULT_SETTLE_MS);
    assertRunning(child);

    const exitStarted = performance.now();
    terminal.write(CTRL_C);
    await Bun.sleep(SECOND_CTRL_C_MS);
    terminal.write(CTRL_C);

    await race(child.exited, EXIT_TIMEOUT_MS, `still running ${EXIT_TIMEOUT_MS}ms after Ctrl-C`);
    const exitMs = performance.now() - exitStarted;
    assertCleanExit(child);
    return { paintMs, exitMs, pid: child.pid };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}
