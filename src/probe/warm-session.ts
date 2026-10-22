import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND } from '../cli.ts';
import { ovrdroidFile } from '../paths.ts';
import { logOf } from './effort-switch-turn.ts';
import { turnUsage } from './effort-switch-verdict.ts';
import type { TurnUsage } from './effort-switch-verdict.ts';
import { transcriptsIn } from './live-session.ts';
import { callerOf, childOf, replyCount } from './live-transcript.ts';
import type { Transcript } from './live-transcript.ts';
import type { UsageLine } from './logs.ts';
import { poll } from './poll.ts';
import type { Session } from './session.ts';
import { SETTLE_TIMEOUT_MS } from './session.ts';
import type { LabelSample, WarmLine } from './warm-verdict.ts';
import { cacheLabelOf, warmLinesOf } from './warm-verdict.ts';

const USAGE_LOG = ovrdroidFile('cache-usage.jsonl');
const LABEL_WAIT_MS = 70_000;
const LOG_WAIT_MS = 60_000;
const LOG_FLUSH_MS = 1500;
const QUIET_MS = 1500;

export interface Drive {
  session: Session;
  folder: string;
  tag: string;
  model: string;
  timeoutMs: number;
}

export interface TurnWait {
  replies: number;
  before: number;
  turn: string;
}

export interface Ended {
  sessionId: string;
  usage: TurnUsage;
}

function parentTranscript(context: Drive): Transcript | undefined {
  return transcriptsIn(context.folder).find(
    ({ text }) => callerOf(text) === '' && text.includes(context.tag),
  );
}

export function shownLabel(session: Session): string | undefined {
  return session
    .frames()
    .map((frame) => cacheLabelOf(frame.text))
    .findLast((label) => label !== undefined);
}

export async function settledLabel(session: Session): Promise<string | undefined> {
  await session.quiet(QUIET_MS, SETTLE_TIMEOUT_MS);
  return shownLabel(session);
}

function warmLines(sessionId: string): WarmLine[] {
  return existsSync(USAGE_LOG) ? warmLinesOf(readFileSync(USAGE_LOG, 'utf-8'), sessionId) : [];
}

function modelLine(lines: readonly UsageLine[], model: string): UsageLine | undefined {
  return lines.findLast(({ modelId }) => modelId === model);
}

export async function turnEnd(context: Drive, wait: TurnWait): Promise<Ended> {
  const ended = await poll(() => {
    const found = parentTranscript(context);
    return found !== undefined && replyCount(found.text) >= wait.replies ? found : undefined;
  }, context.timeoutMs);
  if (ended === undefined) {
    throw new Error(
      `the ${wait.turn} turn did not finish within ${context.timeoutMs / MS_PER_SECOND}s`,
    );
  }
  const logged = await poll(
    () => modelLine(logOf(ended.id).usage.slice(wait.before), context.model),
    LOG_WAIT_MS,
  );
  if (logged === undefined) {
    throw new Error(`Droid logged no ${context.model} usage line for the ${wait.turn} turn`);
  }
  await delay(LOG_FLUSH_MS);
  const line = modelLine(logOf(ended.id).usage.slice(wait.before), context.model) ?? logged;
  return { sessionId: ended.id, usage: turnUsage(line) };
}

export function childRunning(context: Drive, parentId: string): boolean {
  const child = childOf(transcriptsIn(context.folder), parentId);
  return child !== undefined && replyCount(child.text) === 0;
}

export async function sampleUntilWarm(
  context: Drive,
  sessionId: string,
  deadline: number,
): Promise<{ warm: WarmLine | undefined; samples: LabelSample[] }> {
  const samples: LabelSample[] = [];
  const warm = await poll(
    () => {
      samples.push({ at: Date.now(), label: shownLabel(context.session) });
      return warmLines(sessionId)[0];
    },
    Math.max(0, deadline - Date.now()),
  );
  return { warm, samples };
}

export async function labelAfterWarm(
  session: Session,
  before: string | undefined,
): Promise<string | undefined> {
  const changed = await poll(() => {
    const label = shownLabel(session);
    return label === before ? undefined : label;
  }, LABEL_WAIT_MS);
  return changed ?? shownLabel(session);
}
