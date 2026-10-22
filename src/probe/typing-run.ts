import type { LaunchEnv } from './launch.ts';
import {
  dies,
  launchEnv,
  PAINT_TIMEOUT_MS,
  paintDetector,
  probeAnswerer,
  race,
  TERMINAL_SIZE,
} from './launch.ts';
import { TerminalScreen } from './terminal-screen.ts';
import type { TypingReading } from './typing.ts';
import { keysInBox, readTyping, TYPED_KEY } from './typing.ts';

const CTRL_C = '\u0003';
const SECOND_CTRL_C_MS = 80;
const EXIT_GRACE_MS = 5000;
const SETTLE_MS = 1500;
const SCREEN_ROWS = 60;
const SESSION_PREFIXES = ['FACTORY_', 'DROID_'];
const AUTO_UPDATE = 'FACTORY_DROID_AUTO_UPDATE_ENABLED';

export const DEFAULT_TYPING_MS = 15_000;
export const DEFAULT_TYPING_GAP_MS = 100;

export interface TypingOptions {
  durationMs: number;
  gapMs: number;
  real: boolean;
  cwd: string;
}

function realEnv(): LaunchEnv {
  const env: LaunchEnv = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    const injected = key === 'FORCE_COLOR' || SESSION_PREFIXES.some((p) => key.startsWith(p));
    if (typeof value === 'string' && !injected) {
      env[key] = value;
    }
  }
  env['TERM'] = 'xterm-256color';
  env[AUTO_UPDATE] = 'false';
  return env;
}

export async function measureTyping(
  target: string,
  options: TypingOptions,
): Promise<TypingReading> {
  const screen = new TerminalScreen(TERMINAL_SIZE.cols, SCREEN_ROWS);
  const decoder = new TextDecoder();
  const answerProbes = probeAnswerer();
  const isPainted = paintDetector();
  const painted = Promise.withResolvers<boolean>();
  const sentAt: number[] = [];
  const shownAt: number[] = [];
  const spawnedAt = performance.now();

  await using terminal = new Bun.Terminal({
    cols: TERMINAL_SIZE.cols,
    rows: SCREEN_ROWS,
    data(self, chunk) {
      const text = decoder.decode(chunk, { stream: true });
      answerProbes(self, text);
      screen.feed(text);
      if (isPainted(text)) {
        painted.resolve(true);
      }
      const now = performance.now() - spawnedAt;
      const shown = keysInBox(screen.lines());
      while (shownAt.length < shown) {
        shownAt.push(now);
      }
    },
  });

  const env = options.real ? realEnv() : launchEnv();
  const child = Bun.spawn([target], { terminal, env, cwd: options.cwd });
  try {
    await race(
      Promise.race([painted.promise, dies(child)]),
      PAINT_TIMEOUT_MS,
      `no input box after ${PAINT_TIMEOUT_MS}ms`,
    );
    const stopAt = performance.now() + options.durationMs;
    while (performance.now() < stopAt) {
      terminal.write(TYPED_KEY);
      sentAt.push(performance.now() - spawnedAt);
      // oxlint-disable-next-line no-await-in-loop
      await Bun.sleep(options.gapMs);
    }
    await Bun.sleep(SETTLE_MS);
    return readTyping(sentAt, shownAt);
  } finally {
    terminal.write(CTRL_C);
    await Bun.sleep(SECOND_CTRL_C_MS);
    terminal.write(CTRL_C);
    await Promise.race([child.exited, Bun.sleep(EXIT_GRACE_MS)]);
    child.kill('SIGKILL');
  }
}
