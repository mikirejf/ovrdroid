import { MS_PER_SECOND, say } from '../cli.ts';
import {
  buildFamilies,
  findOrphans,
  formatDroid,
  formatFamilies,
  formatMachine,
  formatOrphans,
  otherOrphansToShow,
  parseCommands,
  parseProcesses,
} from './census.ts';
import { footprintsOf } from './footprint.ts';

export const DEFAULT_CENSUS_WINDOW_S = 20;
export const DEFAULT_CENSUS_TOP = 15;

export interface CensusOptions {
  window: number;
  top: number;
}

function ps(columns: string): string {
  return Bun.spawnSync(['ps', '-Ao', columns]).stdout.toString();
}

function workingDirectory(pid: number): string | undefined {
  const out = Bun.spawnSync([
    'lsof',
    '-a',
    '-d',
    'cwd',
    '-p',
    String(pid),
    '-Fn',
  ]).stdout.toString();
  return out
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
}

export async function census(options: CensusOptions): Promise<void> {
  const before = parseProcesses(ps('pid=,ppid=,utime=,stime=,etime=,comm='));
  await Bun.sleep(options.window * MS_PER_SECOND);
  const after = parseProcesses(ps('pid=,ppid=,utime=,stime=,etime=,comm='));
  const commands = parseCommands(ps('pid=,args='));
  const footprints = footprintsOf(after.map((row) => row.pid));

  const families = buildFamilies({ before, after, footprints, windowS: options.window });
  const orphans = findOrphans({ rows: after, commands, footprints });
  const cwds = new Map<number, string>();
  for (const orphan of otherOrphansToShow(orphans, options.top)) {
    const cwd = workingDirectory(orphan.pid);
    if (cwd !== undefined) {
      cwds.set(orphan.pid, cwd);
    }
  }

  say(formatMachine(families, options.window));
  say(`\n${formatFamilies(families, options.top)}`);
  say(`\n${formatDroid(families)}`);
  say(`\n${formatOrphans(orphans, cwds, options.top)}`);
}
