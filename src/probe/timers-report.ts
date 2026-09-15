import path from 'node:path';

import { say } from '../cli.ts';
import { TIMER_VARIABLE } from '../patch/timer-patches.ts';
import { withTempDir } from '../temp.ts';
import { logSize, logSlice } from './log-file.ts';
import { openSettledSession, standBy } from './session.ts';
import { formatTimers, parseTimers, summariseTimers, TIMERS_HEADER } from './timers.ts';

const TOP_SITES = 15;

export interface TimersOptions {
  window: number;
}

export async function timers(binary: string, options: TimersOptions): Promise<void> {
  await withTempDir('timers', async (dir) => {
    const file = path.join(dir, 'timers.tsv');
    const { session } = await openSettledSession(binary, {
      env: { [TIMER_VARIABLE]: file },
      collect: false,
    });

    try {
      const startupBytes = logSize(file);
      await standBy(options.window);

      const startup = await logSlice(file, 0, startupBytes);
      const idleText = await logSlice(file, startupBytes);

      if (startup === '' && idleText === '') {
        say('no timer rows: was the binary built with --timers?');
        return;
      }

      const report = parseTimers(idleText);
      say('');
      say(`while idle: ${summariseTimers(report)}`);
      say(`before that: ${parseTimers(startup).armed} timers armed during startup`);
      say('');
      say(TIMERS_HEADER);
      say(formatTimers(report.costs.slice(0, TOP_SITES)));
    } finally {
      await session.close();
    }
  });
}
