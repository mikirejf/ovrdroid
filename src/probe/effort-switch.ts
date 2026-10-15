import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say, whole } from '../cli.ts';
import { ovrdroidFile } from '../paths.ts';
import type { Drive } from './effort-switch-turn.ts';
import { logOf, LOG_PATH, takeTurn } from './effort-switch-turn.ts';
import type { TurnBust, TurnEnds, TurnName, TurnUsage } from './effort-switch-verdict.ts';
import { bustsByTurn, switchVerdict, turnUsage } from './effort-switch-verdict.ts';
import { CYCLE_EFFORT, lastShownEffort } from './effort.ts';
import { jsonlAppender } from './jsonl.ts';
import { openLiveSession, sessionFolder, withLiveDir } from './live-session.ts';
import type { UsageLine } from './logs.ts';
import type { Session } from './session.ts';
import { SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';

export const DEFAULT_SWITCH_MODEL = 'custom:droidproxy:sonnet-5-5';
export const DEFAULT_SWITCH_FROM = 'high';
export const DEFAULT_SWITCH_TO = 'medium';
export const DEFAULT_SWITCH_TIMEOUT = 180;
export const DEFAULT_SWITCH_RUNS = ovrdroidFile('effort-switch-runs.jsonl');

const MAX_PRESSES = 8;
const PRESS_QUIET_MS = 800;
const PRESS_TIMEOUT_MS = 10_000;
const TURNS: readonly TurnName[] = ['seed', 'control', 'switched'];

export interface EffortSwitchOptions {
  model: string;
  from: string;
  to: string;
  timeout: number;
  yes: boolean;
  out: string;
}

interface Labels {
  from: string;
  to: string;
}

interface Measured {
  labels: Labels;
  lines: Record<TurnName, UsageLine>;
  efforts: Record<TurnName, string>;
  busts: TurnBust[];
}

function sameLabel(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function pressUntil(session: Session, to: string): Promise<Labels> {
  const start = lastShownEffort(session.frames());
  if (start === undefined || start === null) {
    throw new Error('the status line shows no effort label before the switch');
  }
  if (sameLabel(start, to)) {
    throw new Error(`the session already shows "${start}", so there is nothing to switch to`);
  }
  const seen = [start];
  let label: string | null = start;
  for (let press = 0; press < MAX_PRESSES; press += 1) {
    session.mark();
    // oxlint-disable-next-line no-await-in-loop
    await session.type(CYCLE_EFFORT);
    // oxlint-disable-next-line no-await-in-loop
    await session.quiet(PRESS_QUIET_MS, PRESS_TIMEOUT_MS);
    const shown = lastShownEffort(session.frames());
    if (shown !== undefined) {
      label = shown;
    }
    seen.push(label ?? 'none');
    if (label !== null && sameLabel(label, to)) {
      return { from: start, to: label };
    }
  }
  throw new Error(
    `${MAX_PRESSES} Tab presses never reached "${to}"; labels seen: ${seen.join(', ')}`,
  );
}

async function runSwitch(
  binary: string,
  options: EffortSwitchOptions,
  dir: string,
): Promise<Measured> {
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd);
  const session = await openLiveSession(binary, {
    cwd,
    dir,
    model: options.model,
    effort: options.from,
    collect: true,
  });
  try {
    await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
    const context: Drive = {
      session,
      folder: sessionFolder(cwd),
      tag: randomUUID().slice(0, 8),
      model: options.model,
      timeoutMs: options.timeout * MS_PER_SECOND,
    };
    const seed = await takeTurn(context, 'seed');
    const control = await takeTurn(context, 'control', seed.sessionId);
    const labels = await pressUntil(session, options.to);
    const switched = await takeTurn(context, 'switched', control.sessionId);
    const ends: TurnEnds = {
      seed: seed.line.at,
      control: control.line.at,
      switched: switched.line.at,
    };
    return {
      labels,
      lines: { seed: seed.line, control: control.line, switched: switched.line },
      efforts: { seed: seed.effort, control: control.effort, switched: switched.effort },
      busts: bustsByTurn(logOf(seed.sessionId).busts, ends),
    };
  } finally {
    await session.close();
  }
}

function usageText(turn: TurnName, measured: Measured, usage: TurnUsage): string {
  return `${turn}: effort ${measured.efforts[turn]}, read ${whole(usage.cacheRead)}, wrote ${whole(usage.cacheWrite)}, input ${whole(usage.input)} (${measured.lines[turn].modelId})`;
}

export async function effortSwitch(binary: string, options: EffortSwitchOptions): Promise<void> {
  say(`${options.model} starts at effort ${options.from}, then answers three short prompts:`);
  say('  seed: the first turn, which writes the cache');
  say('  control: a second turn at the same effort, which should read it');
  say(`  switched: a third turn after Tab moves the status-line label to ${options.to}`);
  say(`Droid's own log (${LOG_PATH}) gives the cache numbers for each turn`);
  say('');
  if (!options.yes) {
    say('nothing was sent; re-run with --yes to spend it');
    return;
  }

  const measured = await withLiveDir(
    'effort-switch',
    async (dir) => await runSwitch(binary, options, dir),
  );
  const turns = {
    seed: turnUsage(measured.lines.seed),
    control: turnUsage(measured.lines.control),
    switched: turnUsage(measured.lines.switched),
  };
  for (const turn of TURNS) {
    say(usageText(turn, measured, turns[turn]));
  }
  say(`the status line showed "${measured.labels.from}", then "${measured.labels.to}" after Tab`);
  say('');
  say(switchVerdict({ efforts: measured.efforts, ...turns, busts: measured.busts }));
  await jsonlAppender(options.out)({
    t: new Date().toISOString(),
    model: options.model,
    labels: measured.labels,
    efforts: measured.efforts,
    turns,
    busts: measured.busts,
  });
  say('');
  say(`this run appended to ${options.out}`);
}
