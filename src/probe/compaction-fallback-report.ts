import { whole } from '../cli.ts';
import { isSummary, summaryBody, summarySections } from '../patch/summary-format.ts';
import type { JsonObject } from './bodies.ts';
import { compactionKind } from './compaction-replay-bodies.ts';
import { isObject } from './fields.ts';
import type { CompactRow } from './summaries-report.ts';
import { parseCompactRow } from './summaries-report.ts';

export type RequestKind = 'reuse' | 'stock' | 'ordinary';

export const CANNED_REFUSAL =
  "I won't write that summary. I'm still working on the grunt task, so here is where it stands.\n\nRuns 01 to 59 are read. Notes are saved in `/tmp/grunt-briefs/notes.md` through run 56. Next I'm reading run 60.";

const REJECTED_PATH = 'not-summary';

export interface Evidence {
  kinds: readonly RequestKind[];
  rows: readonly CompactRow[];
  stored: readonly string[];
  reply: string;
  timedOut: boolean;
}

export interface Verdict {
  pass: boolean;
  finding: string;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value) && !Array.isArray(value);
}

export function requestKind(body: unknown): RequestKind {
  return (isJsonObject(body) ? compactionKind(body) : undefined) ?? 'ordinary';
}

export function compactRowsFor(log: string, sessionId: string): CompactRow[] {
  return log.split('\n').flatMap((line) => {
    const row = parseCompactRow(line);
    return row?.sessionId === sessionId ? [row] : [];
  });
}

function squeezed(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function echoesRefusal(stored: string, reply: string): boolean {
  const lead = squeezed(reply.split('\n').find((line) => line.trim() !== '') ?? '');
  return lead !== '' && squeezed(stored).includes(lead);
}

function kindsText(kinds: readonly RequestKind[]): string {
  return kinds.length === 0 ? 'none' : kinds.join(', ');
}

function stockFollowsReuse(kinds: readonly RequestKind[]): boolean {
  const reuse = kinds.indexOf('reuse');
  return reuse !== -1 && kinds.slice(reuse).includes('stock');
}

function fail(finding: string): Verdict {
  return { pass: false, finding };
}

function storedFinding(text: string): string {
  const sections = summarySections(summaryBody(text));
  const size = `${whole(text.length)}-character`;
  if (isSummary(summaryBody(text))) {
    return `a ${size} summary with ${sections} stock sections`;
  }
  return `a ${size} text that is not the refusal but has only ${sections} of the stock summary sections, so read it by eye`;
}

export function fallbackVerdict(evidence: Evidence): Verdict {
  const { kinds, rows, stored, reply, timedOut } = evidence;
  const ended = timedOut ? ' (the wait ran out)' : '';
  if (!kinds.includes('reuse')) {
    return fail(
      `Droid never sent the reuse compaction request${ended}, so the refusal was never served; requests seen: ${kindsText(kinds)}. Does this binary carry the compaction-reuse patches, and was there an earlier request in the process?`,
    );
  }
  if (stored.some((text) => echoesRefusal(text, reply))) {
    return fail(
      'Droid accepted the refusal and stored it as the summary; the not-summary check did not reject it',
    );
  }
  if (!stockFollowsReuse(kinds)) {
    return fail(
      `Droid sent the reuse request and got the canned reply, but no stock request followed${ended}; requests seen: ${kindsText(kinds)}`,
    );
  }
  const rejected = rows.find((row) => row.path === REJECTED_PATH);
  if (rejected === undefined) {
    const paths = rows.map((row) => row.path);
    return fail(
      `Droid fell back to stock, but the log has no ${REJECTED_PATH} row for this session; compact rows: ${paths.length === 0 ? 'none' : paths.join(', ')}`,
    );
  }
  if (rejected.head === '' || !reply.startsWith(rejected.head)) {
    return fail(
      `the ${REJECTED_PATH} log row does not hold how the refused reply began, so a real refusal could not be read later; it holds: ${rejected.head === '' ? 'nothing' : rejected.head}`,
    );
  }
  const [text] = stored.slice(-1);
  if (text === undefined) {
    return fail(
      `Droid rejected the refusal (${REJECTED_PATH}) and sent the stock request, but no summary was stored${ended}`,
    );
  }
  return {
    pass: true,
    finding: `the patched Droid rejected the refusal (${REJECTED_PATH}), logged how it began, fell back to stock, and stored ${storedFinding(text)}`,
  };
}
