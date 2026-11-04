import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { messageOf, say } from '../cli.ts';
import { withTempDir } from '../temp.ts';
import { interleaveWith } from './ab.ts';
import { boxSpans, findInputBox, SYNC_START } from './input-box.ts';
import {
  dies,
  launchEnv,
  PAINT_TIMEOUT_MS,
  probeAnswerer,
  race,
  TERMINAL_SIZE,
  warmWithLaunch,
} from './launch.ts';
import { Ledger } from './owned-sessions.ts';
import { sayPaired } from './paired.ts';
import type { Measure } from './regressions.ts';
import { failOnRegressions } from './regressions.ts';
import { TerminalScreen } from './terminal-screen.ts';
import type { TypingStartRun } from './typing-start-report.ts';
import {
  assertFlatStartupBox,
  describeTypingStart,
  StartupTimeline,
  typingStartMeasure,
} from './typing-start-report.ts';

export const DEFAULT_START_GAPS_MS = [25, 100];
export const DEFAULT_START_RUNS = 10;

const KEY_PAIR = '/\u007F';
const CTRL_C = '\u0003';
const SECOND_CTRL_C_MS = 50;
const SETTLE_MS = 300;
const EXIT_TIMEOUT_MS = 10_000;
const INTERRUPTED_EXIT_CODE = 130;
const BORDER_DRAFT = 'startup-border';
const BORDER_RESIZE_COLS = 100;
const SYNC_END = '\u001B[?2026l';

async function checkStartupBorders(binary: string): Promise<void> {
  const decoder = new TextDecoder();
  const screen = new TerminalScreen(TERMINAL_SIZE.cols, TERMINAL_SIZE.rows);
  const timeline = new StartupTimeline();
  const answerProbes = probeAnswerer();
  const first = Promise.withResolvers<null>();
  const typed = Promise.withResolvers<null>();
  const resized = Promise.withResolvers<null>();
  const app = Promise.withResolvers<null>();
  const failure = Promise.withResolvers<never>();
  let syncTail = '';
  let synced = false;
  let firstSeen = false;
  let typedSeen = false;
  let resizedSeen = false;
  let typingSent = false;
  let resizeSent = false;
  let appSeen = false;
  let syncEnded = false;
  let resizeOutput = '';

  const snapshot = (stage: string) => {
    const lines = screen.lines();
    assertFlatStartupBox(lines, stage);
    const box = findInputBox(lines);
    say(`${stage}: flat, ${box?.bottomLine.length} columns, ${box?.rows.join(' / ')}`);
  };
  const sampleShell = () => {
    const box = findInputBox(screen.lines());
    if (box === undefined) {
      return;
    }
    if (!firstSeen && box.bottomLine.length === TERMINAL_SIZE.cols) {
      snapshot('first shell');
      firstSeen = true;
      first.resolve(null);
    } else if (
      typingSent &&
      !typedSeen &&
      box.bottomLine.length === TERMINAL_SIZE.cols &&
      box.rows.join('\n').includes(BORDER_DRAFT)
    ) {
      snapshot('pre-handoff typing');
      typedSeen = true;
      typed.resolve(null);
    } else if (
      resizeSent &&
      !resizedSeen &&
      box.bottomLine.length === BORDER_RESIZE_COLS &&
      boxSpans(resizeOutput, BORDER_RESIZE_COLS) &&
      box.rows.join('\n').includes(BORDER_DRAFT)
    ) {
      snapshot('pre-handoff resize');
      resizedSeen = true;
      resized.resolve(null);
    }
  };

  await using terminal = new Bun.Terminal({
    ...TERMINAL_SIZE,
    data(self, chunk) {
      const text = decoder.decode(chunk, { stream: true });
      answerProbes(self, text);
      try {
        for (const char of text) {
          if (resizeSent && !synced) {
            resizeOutput += char;
          }
          syncTail = (syncTail + char).slice(-SYNC_START.length);
          if (!synced && syncTail === SYNC_START) {
            sampleShell();
            synced = true;
            if (!resizedSeen) {
              throw new Error(
                'app handoff arrived before first shell, typing and resize were captured',
              );
            }
          }
          screen.feed(char);
          syncEnded ||= synced && syncTail === SYNC_END;
          if (!synced && char === '\n') {
            sampleShell();
          }
        }
        timeline.feed(text, performance.now());
        if (!synced) {
          sampleShell();
        } else if (!appSeen && timeline.appAt !== undefined && syncEnded) {
          snapshot('app handoff');
          const box = findInputBox(screen.lines());
          if (
            box?.bottomLine.length !== BORDER_RESIZE_COLS ||
            !box.rows.join('\n').includes(BORDER_DRAFT)
          ) {
            throw new Error('app handoff lost the early draft or resized input width');
          }
          appSeen = true;
          app.resolve(null);
        }
      } catch (error) {
        failure.reject(error);
      }
    },
  });

  const ledger = new Ledger();
  try {
    const child = Bun.spawn([binary], { terminal, env: launchEnv(ledger.env) });
    ledger.adopt(child);
    const wait = async (promise: Promise<null>, stage: string) =>
      await race(
        Promise.race([promise, failure.promise, dies(child)]),
        PAINT_TIMEOUT_MS,
        `${stage}: no input box`,
      );
    await wait(first.promise, 'first shell');
    typingSent = true;
    terminal.write(BORDER_DRAFT);
    await wait(typed.promise, 'pre-handoff typing');
    resizeSent = true;
    screen.resize(BORDER_RESIZE_COLS, TERMINAL_SIZE.rows);
    terminal.resize(BORDER_RESIZE_COLS, TERMINAL_SIZE.rows);
    process.kill(child.pid, 'SIGWINCH');
    await wait(resized.promise, 'pre-handoff resize');
    await wait(app.promise, 'app handoff');
    await ledger.confirmSession();
    say('PASS: first shell, typing, resize and app handoff are flat; no prompt was submitted');
  } finally {
    await ledger.release();
  }
}

async function typeThroughStartup(binary: string, gapMs: number): Promise<TypingStartRun> {
  const decoder = new TextDecoder();
  const timeline = new StartupTimeline();
  const shell = Promise.withResolvers<null>();
  const app = Promise.withResolvers<null>();
  const answerProbes = probeAnswerer();

  await using terminal = new Bun.Terminal({
    ...TERMINAL_SIZE,
    data(self, chunk) {
      const text = decoder.decode(chunk, { stream: true });
      answerProbes(self, text);
      timeline.feed(text, performance.now());
      if (timeline.shellAt !== undefined) {
        shell.resolve(null);
      }
      if (timeline.appAt !== undefined) {
        app.resolve(null);
      }
    },
  });

  const ledger = new Ledger();
  try {
    const spawnedAt = performance.now();
    const child = Bun.spawn([binary], { terminal, env: launchEnv(ledger.env) });
    ledger.adopt(child);

    let pairs = 0;
    const typing = (async () => {
      await shell.promise;
      while (timeline.appAt === undefined) {
        terminal.write(KEY_PAIR);
        pairs += 1;
        // oxlint-disable-next-line no-await-in-loop
        await delay(gapMs);
      }
    })();

    await race(
      Promise.race([app.promise, dies(child)]),
      PAINT_TIMEOUT_MS,
      `app never painted while typing every ${gapMs}ms (no frame after ${PAINT_TIMEOUT_MS}ms)`,
    );
    if (timeline.shellAt === undefined || timeline.appAt === undefined) {
      throw new Error('the app painted with no early input shell to type into');
    }
    await typing;
    const run = {
      shellMs: timeline.shellAt - spawnedAt,
      appMs: timeline.appAt - spawnedAt,
      pairs,
    };

    await ledger.confirmSession();
    await Bun.sleep(SETTLE_MS);
    terminal.write(CTRL_C);
    await Bun.sleep(SECOND_CTRL_C_MS);
    terminal.write(CTRL_C);
    await race(child.exited, EXIT_TIMEOUT_MS, `still running ${EXIT_TIMEOUT_MS}ms after Ctrl-C`);
    if (
      child.signalCode !== 'SIGINT' &&
      child.exitCode !== 0 &&
      child.exitCode !== INTERRUPTED_EXIT_CODE
    ) {
      throw new Error(`exited with ${child.signalCode ?? child.exitCode} after Ctrl-C`);
    }
    return run;
  } finally {
    shell.resolve(null);
    await ledger.release();
  }
}

export async function typingStart(
  stock: string,
  target: string,
  options: { runs: number; gaps: number[]; checkBorders?: boolean },
): Promise<void> {
  if (options.checkBorders === true) {
    await checkStartupBorders(target);
    return;
  }
  await withTempDir('typing-start', async (dir) => {
    const copies = new Map(
      [stock, target].map((binary, index) => [binary, path.join(dir, `droid-${index}`)]),
    );
    for (const [binary, copy] of copies) {
      copyFileSync(binary, copy);
    }
    say(
      `both binaries copied into ${dir} and measured from there: fs.watch costs 4-5x more for a binary directly in /tmp`,
    );

    const copyOf = (binary: string): string => {
      const copy = copies.get(binary);
      if (copy === undefined) {
        throw new Error(`no copy of ${binary}`);
      }
      return copy;
    };
    for (const binary of copies.keys()) {
      // oxlint-disable-next-line no-await-in-loop
      await warmWithLaunch(copyOf(binary));
    }

    const measures: Measure[] = [];
    for (const gapMs of options.gaps) {
      // oxlint-disable-next-line no-await-in-loop
      const series = await interleaveWith(
        [stock, target],
        {
          measure: async (binary) =>
            await typeThroughStartup(copyOf(binary), gapMs).catch((error: unknown) => {
              throw new Error(`${binary}: ${messageOf(error)}`);
            }),
          warmUp: async () => {},
        },
        options.runs,
      );
      say('');
      for (const line of describeTypingStart(gapMs, series)) {
        say(line);
      }
      const measure = typingStartMeasure(gapMs, series);
      sayPaired(measure.series, measure.label);
      measures.push(measure);
    }
    failOnRegressions(measures);
  });
}
