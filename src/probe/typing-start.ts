import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { messageOf, say } from '../cli.ts';
import { withTempDir } from '../temp.ts';
import { interleaveWith } from './ab.ts';
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
import type { TypingStartRun } from './typing-start-report.ts';
import { describeTypingStart, StartupTimeline, typingStartMeasure } from './typing-start-report.ts';

export const DEFAULT_START_GAPS_MS = [25, 100];
export const DEFAULT_START_RUNS = 10;

const KEY_PAIR = '/\u007F';
const CTRL_C = '\u0003';
const SECOND_CTRL_C_MS = 50;
const SETTLE_MS = 300;
const EXIT_TIMEOUT_MS = 10_000;
const INTERRUPTED_EXIT_CODE = 130;

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
    await typing;
    if (timeline.shellAt === undefined || timeline.appAt === undefined) {
      throw new Error('the app painted with no early input shell to type into');
    }
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
  options: { runs: number; gaps: number[] },
): Promise<void> {
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
