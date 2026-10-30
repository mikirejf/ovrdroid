import { readFileSync } from 'node:fs';

import { MS_PER_SECOND } from '../cli.ts';
import { SCRIPT_TOOL } from '../patch/file-tracker-patches.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { entriesOf, fieldsOf, fieldsOfJson, worded } from './fields.ts';
import type { Fields } from './fields.ts';
import { HIDDEN_FROM_MODEL, ofKind, transcriptFileOf, turnEnded } from './live-transcript.ts';
import { poll } from './poll.ts';

const TRANSCRIPT_WAIT_MS = 15_000;

const DIRECT_ONLY_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'TodoWrite']);
const SEARCH_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep']);

export interface TranscriptCounts {
  requests: number;
  nested: number;
  directReadGrep: number;
  scripts: number;
  directOnlyRequests: number;
  toolErrors: number;
}

export function emptyCounts(): TranscriptCounts {
  return {
    requests: 0,
    nested: 0,
    directReadGrep: 0,
    scripts: 0,
    directOnlyRequests: 0,
    toolErrors: 0,
  };
}

function addAssistant(counts: TranscriptCounts, message: Fields): void {
  const blocks = entriesOf(message, 'content');
  const calls = ofKind(blocks, 'tool_use');
  if (worded(message, 'visibility') === HIDDEN_FROM_MODEL) {
    counts.nested += calls.length;
    return;
  }
  const speaks = ofKind(blocks, 'text').some((block) => worded(block, 'text').trim() !== '');
  if (calls.length > 0 || speaks) {
    counts.requests += 1;
  }
  const names = calls.map((call) => worded(call, 'name'));
  counts.directReadGrep += names.filter((name) => SEARCH_TOOLS.has(name)).length;
  counts.scripts += names.filter((name) => name === SCRIPT_TOOL).length;
  if (names.length > 0 && names.every((name) => DIRECT_ONLY_TOOLS.has(name))) {
    counts.directOnlyRequests += 1;
  }
}

function addUser(counts: TranscriptCounts, message: Fields): void {
  counts.toolErrors += ofKind(entriesOf(message, 'content'), 'tool_result').filter(
    (result) => result.get('is_error') === true,
  ).length;
}

export function countTranscript(text: string): TranscriptCounts {
  const counts = emptyCounts();
  for (const line of text.split('\n')) {
    const fields = fieldsOfJson(line);
    if (worded(fields, 'type') !== 'message') {
      continue;
    }
    const message = fieldsOf(fields.get('message'));
    const role = worded(message, 'role');
    if (role === 'assistant') {
      addAssistant(counts, message);
    } else if (role === 'user') {
      addUser(counts, message);
    }
  }
  return counts;
}

async function finishedTranscript(sessionId: string): Promise<string> {
  const text = await poll(() => {
    const file = transcriptFileOf(sessionId);
    const held = file === undefined ? undefined : readFileSync(file, 'utf-8');
    return held !== undefined && turnEnded(held) ? held : undefined;
  }, TRANSCRIPT_WAIT_MS);
  if (text === undefined) {
    throw new Error(
      `session ${sessionId} has no finished transcript under ${FACTORY_SESSIONS} after ${TRANSCRIPT_WAIT_MS / MS_PER_SECOND}s`,
    );
  }
  return text;
}

export async function countFinishedTranscript(sessionId: string): Promise<TranscriptCounts> {
  return countTranscript(await finishedTranscript(sessionId));
}
