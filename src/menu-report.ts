import path from 'node:path';

import type { ChurnKind } from './churn.ts';
import { describeChurn, induceChurn } from './churn.ts';
import { say } from './cli.ts';
import { launch } from './launch.ts';
import { LOADING_TEXT, openMenuSession, readFrames } from './menu.ts';
import { CONFIG_FILES } from './paths.ts';
import { withTempDir } from './temp.ts';
import { touchesDuring } from './touches.ts';
import { WATCH_VARIABLE } from './watch-patches.ts';
import { formatWatch, parseWatch, summariseWatch, WATCH_HEADER } from './watch.ts';

export interface ChurnCommandOptions {
  churn: ChurnKind;
  rounds: number;
  gap: number;
  with: string;
}

function churnArguments(binary: string, options: ChurnCommandOptions) {
  return {
    rounds: options.rounds,
    gapMs: options.gap,
    binary: options.with === '' ? binary : options.with,
  };
}

export async function menu(binary: string, options: ChurnCommandOptions): Promise<void> {
  const session = await openMenuSession(binary);
  try {
    const opened = await session.open();
    say(`opening the menu drew ${opened.totalFrames} frames`);
    say(`  footer gone in the first frame : ${opened.footerFirstFrame ? 'no, it lingers' : 'yes'}`);
    say(`  commands listed                : ${opened.listsCommands ? 'yes' : 'no'}`);

    say('');
    say(`while the menu is open: ${describeChurn(options.churn)}`);
    session.mark();
    await induceChurn(options.churn, churnArguments(binary, options));
    const flickers = readFrames(session.frames()).loadingFrames;
    say(`  "${LOADING_TEXT}" frames        : ${flickers}`);

    const closed = await session.closeMenu();
    say('');
    say(`closing the menu drew ${closed.totalFrames} frames`);
    say(`  footer back by the last frame  : ${closed.footerLastFrame ? 'yes' : 'no'}`);
  } finally {
    await session.close();
  }
}

export async function watch(binary: string, options: ChurnCommandOptions): Promise<void> {
  await withTempDir('watch', async (dir) => {
    const file = path.join(dir, 'watch.tsv');
    const session = await openMenuSession(binary, { env: { [WATCH_VARIABLE]: file } });
    try {
      await session.open();
      say(`while the menu is open: ${describeChurn(options.churn)}`);

      const writtenBefore = Bun.file(file).size;
      await induceChurn(options.churn, churnArguments(binary, options));

      const added = await Bun.file(file)
        .slice(writtenBefore)
        .text()
        .catch(() => '');
      const report = parseWatch(added);
      if (report.rows.length === 0) {
        say('no watcher rows: was the binary built with --watch?');
        return;
      }
      say('');
      say(summariseWatch(report));
      say('');
      say(WATCH_HEADER);
      say(formatWatch(report.rows));
    } finally {
      await session.close();
    }
  });
}

export async function touches(binary: string): Promise<void> {
  say('files Droid rewrites while it starts, and files it only touches:');
  say('');
  const readings = await touchesDuring(CONFIG_FILES, async () => {
    await launch(binary);
  });
  for (const reading of readings) {
    say(path.basename(reading.file));
    say(`  ${reading.verdict}`);
    if (reading.changes.length > 0) {
      say(`  changed: ${reading.changes.join(', ')}`);
    }
  }
}
