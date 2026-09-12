#!/usr/bin/env bun
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_TARGET = path.join(homedir(), '.local', 'bin', 'droid');
const RUNS = 3;
const PAINT_MARKER = '╰';
const CTRL_C = '\u0003';
const PAINT_TIMEOUT_MS = 10_000;
const EXIT_TIMEOUT_MS = 10_000;
const SETTLE_MS = 300;
const SECOND_CTRL_C_MS = 50;

interface Timing {
  paintMs: number;
  exitMs: number;
}

async function failAfter(ms: number, message: string): Promise<never> {
  await Bun.sleep(ms);
  throw new Error(message);
}

async function measure(target: string): Promise<Timing> {
  const decoder = new TextDecoder();
  const paint = Promise.withResolvers<number>();
  let output = '';

  await using terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data(_, chunk) {
      output += decoder.decode(chunk, { stream: true });
      if (output.includes(PAINT_MARKER)) {
        paint.resolve(performance.now());
      }
    },
  });

  const started = performance.now();
  const child = Bun.spawn([target], { terminal, env: { ...Bun.env, TERM: 'xterm-256color' } });
  try {
    const paintedAt = await Promise.race([
      paint.promise,
      failAfter(PAINT_TIMEOUT_MS, `no input box after ${PAINT_TIMEOUT_MS}ms`),
    ]);
    const paintMs = paintedAt - started;

    await Bun.sleep(SETTLE_MS);
    terminal.write(CTRL_C);
    await Bun.sleep(SECOND_CTRL_C_MS);
    terminal.write(CTRL_C);
    const exitStarted = performance.now();
    await Promise.race([
      child.exited,
      failAfter(EXIT_TIMEOUT_MS, `still running ${EXIT_TIMEOUT_MS}ms after Ctrl-C`),
    ]);
    return { paintMs, exitMs: performance.now() - exitStarted };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function repeat(target: string, remaining: number): Promise<void> {
  if (remaining === 0) {
    return;
  }
  const timing = await measure(target);
  process.stdout.write(`paint ${seconds(timing.paintMs)}  exit ${seconds(timing.exitMs)}\n`);
  await repeat(target, remaining - 1);
}

const target = process.argv[2] ?? DEFAULT_TARGET;
process.stdout.write(`${target}\n`);
await repeat(target, RUNS);
