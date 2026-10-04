import { setTimeout as delay } from 'node:timers/promises';

import { summarise } from './ab.ts';
import {
  dies,
  launchEnv,
  PAINT_MARKER,
  PAINT_TIMEOUT_MS,
  probeAnswerer,
  race,
  TERMINAL_SIZE,
} from './launch.ts';
import { Ledger } from './owned-sessions.ts';

const BACKSPACE = '\u007F';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const QUIET_MS = 700;
const QUIET_POLL_MS = 25;
const RESPONSE_TIMEOUT_MS = 5000;

export const DEFAULT_TRIALS = 12;
export const DEFAULT_CHARS = 60;
export const DEFAULT_GAP_MS = 16;

export interface KeysOptions {
  trials: number;
  chars: number;
  gapMs: number;
}

export interface KeysResult {
  echoMs: number[];
  lagMs: number;
  chunks: number;
}

function letterAt(index: number): string {
  return LETTERS[index % LETTERS.length] ?? 'a';
}

class Session implements AsyncDisposable {
  private lastOutputAt = 0;
  private notify: undefined | (() => undefined);
  private readonly painted = Promise.withResolvers<boolean>();
  private readonly decoder = new TextDecoder();
  private readonly answerProbes = probeAnswerer();
  private readonly terminal: Bun.Terminal;

  chunks = 0;

  constructor() {
    this.terminal = new Bun.Terminal({
      ...TERMINAL_SIZE,
      data: (self, chunk) => {
        const text = this.decoder.decode(chunk, { stream: true });
        this.answerProbes(self, text);
        this.lastOutputAt = performance.now();
        this.chunks += 1;
        if (text.includes(PAINT_MARKER)) {
          this.painted.resolve(true);
        }
        this.notify?.();
      },
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.terminal[Symbol.asyncDispose]();
  }

  spawn(target: string, ledger: Ledger): Bun.Subprocess {
    const child = Bun.spawn([target], { terminal: this.terminal, env: launchEnv(ledger.env) });
    ledger.adopt(child);
    return child;
  }

  async waitForPaint(child: Bun.Subprocess): Promise<void> {
    await race(
      Promise.race([this.painted.promise, dies(child)]),
      PAINT_TIMEOUT_MS,
      `no input box after ${PAINT_TIMEOUT_MS}ms`,
    );
  }

  async quiet(): Promise<void> {
    do {
      // oxlint-disable-next-line no-await-in-loop
      await delay(QUIET_POLL_MS);
    } while (performance.now() - this.lastOutputAt <= QUIET_MS);
  }

  async respondsTo(key: string): Promise<number> {
    const answer = Promise.withResolvers<number>();
    const sentAt = performance.now();
    this.notify = () => {
      answer.resolve(performance.now() - sentAt);
    };
    this.terminal.write(key);

    try {
      return await race(
        answer.promise,
        RESPONSE_TIMEOUT_MS,
        `no echo within ${RESPONSE_TIMEOUT_MS}ms`,
      );
    } finally {
      this.notify = undefined;
    }
  }

  write(text: string): void {
    this.terminal.write(text);
  }

  async burst(chars: number, gapMs: number): Promise<number> {
    this.chunks = 0;
    await Promise.all(
      Array.from({ length: chars }, async (_, index) => {
        await delay(index * gapMs);
        this.terminal.write(letterAt(index));
      }),
    );
    return performance.now();
  }

  lagSince(lastKeyAt: number): number {
    return Math.max(0, this.lastOutputAt - lastKeyAt);
  }
}

async function echoTrials(session: Session, trials: number): Promise<number[]> {
  const echoMs: number[] = [];
  for (let index = 0; index < trials; index++) {
    // oxlint-disable-next-line no-await-in-loop
    echoMs.push(await session.respondsTo(letterAt(index)));
    // oxlint-disable-next-line no-await-in-loop
    await session.quiet();
    session.write(BACKSPACE);
    // oxlint-disable-next-line no-await-in-loop
    await session.quiet();
  }
  return echoMs;
}

export async function measureKeys(target: string, options: KeysOptions): Promise<KeysResult> {
  await using session = new Session();
  const ledger = new Ledger();
  try {
    const child = session.spawn(target, ledger);
    await session.waitForPaint(child);
    ledger.expectSession();
    await session.quiet();

    const echoMs = await echoTrials(session, options.trials);

    const lastKeyAt = await session.burst(options.chars, options.gapMs);
    await session.quiet();

    return { echoMs, lagMs: session.lagSince(lastKeyAt), chunks: session.chunks };
  } finally {
    await ledger.release();
  }
}

export function formatKeys(results: readonly KeysResult[]): string {
  const echo = results.flatMap((result) => result.echoMs);
  const lag = results.map((result) => result.lagMs);
  const chunks = results.map((result) => result.chunks);
  return [
    `  echo   ${summarise(echo)}  (n=${echo.length})`,
    `  lag    ${summarise(lag)}`,
    `  chunks ${summarise(chunks)}`,
  ].join('\n');
}
