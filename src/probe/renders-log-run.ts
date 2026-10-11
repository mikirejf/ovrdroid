import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { readApp } from '../binary/graph.ts';
import { hasErrorCode, say } from '../cli.ts';
import { RENDERS_DIR } from '../patch/render-profile-patches.ts';
import type { DayFile } from './renders-log.ts';
import { formatLog, parseDayFile, recentDays, sumDays } from './renders-log.ts';
import type { Location } from './renders.ts';
import { placeSources } from './renders.ts';

export const DEFAULT_DAYS = 7;

export interface RendersLogOptions {
  days: number;
  top: number;
  binary: string;
  home?: string;
}

function defaultHome(): string {
  return Bun.env['FACTORY_HOME_OVERRIDE'] ?? homedir();
}

function filesIn(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(folder, name));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }
}

function readDays(root: string, days: readonly string[]): DayFile[] {
  const files: DayFile[] = [];
  for (const file of days.flatMap((day) => filesIn(path.join(root, day)))) {
    const parsed = parseDayFile(readFileSync(file, 'utf-8'));
    if (parsed === undefined) {
      process.stderr.write(`skipped ${file}: not a render day file\n`);
    } else {
      files.push(parsed);
    }
  }
  return files;
}

export function rendersLog(options: RendersLogOptions): void {
  const root = path.join(options.home ?? defaultHome(), '.factory', RENDERS_DIR);
  const summary = sumDays(readDays(root, recentDays(new Date(), options.days)));
  say(
    `render recordings from ${root}, the last ${options.days} days; Droid records them while /renders is on, and each component is summed across processes by its code`,
  );
  say(
    'self time is what React measured inside a component minus its children, on the profiling React build, so it is slower than stock; compare components with each other',
  );
  const places =
    summary.commits === 0
      ? new Map<string, Location | undefined>()
      : placeSources(
          readApp(readFileSync(options.binary)),
          summary.components.slice(0, options.top).map((entry) => entry.source),
        );
  say(
    `each place is where the component's code sits among the modules of ${options.binary}; read them with probe extract ${options.binary}`,
  );
  say('');
  for (const line of formatLog(summary, places, options.top)) {
    say(line);
  }
}
