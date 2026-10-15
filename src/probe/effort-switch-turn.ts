import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say } from '../cli.ts';
import { FACTORY_LOGS } from '../paths.ts';
import type { TurnName } from './effort-switch-verdict.ts';
import { turnLine } from './effort-switch-verdict.ts';
import { submit, transcriptsIn } from './live-session.ts';
import { callerOf, replyCount, replyEfforts } from './live-transcript.ts';
import { LIVE_LOG } from './logs-report.ts';
import type { LogRecords, UsageLine } from './logs.ts';
import { parseLog } from './logs.ts';
import { poll } from './poll.ts';
import type { Session } from './session.ts';

const LOG_WAIT_MS = 60_000;
const LOG_FLUSH_MS = 1500;
export const LOG_PATH = path.join(FACTORY_LOGS, LIVE_LOG);

const PROMPTS: Record<TurnName, string> = {
  seed: 'Reply with only the word one.',
  control: 'Reply with only the word two.',
  switched: 'Reply with only the word three.',
};

export interface Drive {
  session: Session;
  folder: string;
  tag: string;
  model: string;
  timeoutMs: number;
}

export interface Taken {
  sessionId: string;
  line: UsageLine;
  effort: string;
}

export function logOf(sessionId: string): LogRecords {
  const records = parseLog(readFileSync(LOG_PATH, 'utf-8'));
  return {
    usage: records.usage.filter((line) => line.sessionId === sessionId && !line.subagent),
    busts: records.busts.filter((bust) => bust.sessionId === sessionId),
  };
}

function mainTranscript(folder: string, tag: string) {
  return transcriptsIn(folder).find(({ text }) => callerOf(text) === '' && text.includes(tag));
}

export async function takeTurn(drive: Drive, turn: TurnName, sessionId?: string): Promise<Taken> {
  const before = sessionId === undefined ? 0 : logOf(sessionId).usage.length;
  const replies = Object.keys(PROMPTS).indexOf(turn) + 1;
  await submit(drive.session, `${PROMPTS[turn]} (probe ${drive.tag})`);
  const ended = await poll(() => {
    const found = mainTranscript(drive.folder, drive.tag);
    return found !== undefined && replyCount(found.text) >= replies ? found : undefined;
  }, drive.timeoutMs);
  if (ended === undefined) {
    throw new Error(`the ${turn} turn did not finish within ${drive.timeoutMs / MS_PER_SECOND}s`);
  }
  const logged = await poll(
    () => (logOf(ended.id).usage.length > before ? true : undefined),
    LOG_WAIT_MS,
  );
  if (logged === undefined) {
    throw new Error(`Droid logged no usage line for the ${turn} turn within ${LOG_WAIT_MS}ms`);
  }
  await delay(LOG_FLUSH_MS);
  const added = logOf(ended.id).usage.slice(before);
  say(
    `${turn} turn: Droid logged ${added.length} usage line${added.length === 1 ? '' : 's'} (${added.map(({ modelId, reason }) => `${modelId} ${reason}`).join('; ')})`,
  );
  const effort = replyEfforts(ended.text)[replies - 1];
  if (effort === undefined || effort === '') {
    throw new Error(`the ${turn} turn's reply in the transcript carries no reasoningEffort`);
  }
  return { sessionId: ended.id, line: turnLine(added, drive.model, turn), effort };
}
