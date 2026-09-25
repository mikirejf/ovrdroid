import { MS_PER_SECOND } from '../cli.ts';
import type { Frame } from './session.ts';
import { openSettledSession, sendAndRead } from './session.ts';

export const HIGHLIGHT_PROMPT =
  'Reply with one fenced javascript code block containing console.log(1). Do not use tools.';
const REPLY_TEXT = 'console.log';
const CRASH_TEXT = 'Cannot find module';
const MISSING_MODULE = /Cannot find module '(?<name>[^']+)'/gu;
const REPLY_TIMEOUT_MS = 120_000;
const QUIET_MS = 2000;

export interface HighlightReading {
  replied: boolean;
  crashed: boolean;
  missing: readonly string[];
}

export function readHighlight(frames: readonly Frame[]): HighlightReading {
  const text = frames.map((frame) => frame.text).join('\n');
  const missing = new Set<string>();
  for (const match of text.matchAll(MISSING_MODULE)) {
    const name = match.groups?.['name'];
    if (name !== undefined) {
      missing.add(name);
    }
  }
  return {
    replied: text.includes(REPLY_TEXT),
    crashed: text.includes(CRASH_TEXT),
    missing: [...missing],
  };
}

export function describeHighlight(reading: HighlightReading): string {
  if (reading.crashed) {
    return [
      `crashed while rendering the reply: missing ${reading.missing.join(', ')}`,
      'a chunk the app loads by name at runtime did not survive the rebuild',
    ].join('\n');
  }
  return reading.replied
    ? 'rendered a highlighted code block without loading errors'
    : `no reply within ${REPLY_TIMEOUT_MS / MS_PER_SECOND}s`;
}

export async function askForHighlight(binary: string): Promise<HighlightReading> {
  const { session } = await openSettledSession(binary);
  return await sendAndRead(session, {
    text: HIGHLIGHT_PROMPT,
    read: readHighlight,
    done: (reading) => reading.replied || reading.crashed,
    timeoutMs: REPLY_TIMEOUT_MS,
    quietMs: QUIET_MS,
  });
}
