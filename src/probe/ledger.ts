import path from 'node:path';

export const LEDGER_VARIABLE = 'OVRDROID_PROBE_LEDGER';

const HOOK_TIMEOUT_S = 5;
const LEDGER_COMMAND = [
  `[ -d "$${LEDGER_VARIABLE}" ] || { cat > /dev/null; exit 0; }`,
  `record=$(mktemp "$${LEDGER_VARIABLE}/XXXXXX" 2> /dev/null) || { cat > /dev/null; exit 0; }`,
  'cat > "$record"',
].join('; ');
const SESSION_EVENTS: ReadonlySet<unknown> = new Set(['SessionStart', 'SessionEnd']);
const SESSION_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;
const SESSION_SUFFIXES = ['.jsonl', '.settings.json', '.settings.json.bak'] as const;
const SQLITE_LIBRARY = /^libsqlite3-[\da-f]{16}\.dylib$/u;

interface HookGroup {
  hooks: { type: 'command'; command: string; timeout: number }[];
}

export interface LedgerHooks {
  SessionStart: HookGroup[];
  SessionEnd: HookGroup[];
}

export function ledgerHooks(): LedgerHooks {
  const group: HookGroup = {
    hooks: [{ type: 'command', command: LEDGER_COMMAND, timeout: HOOK_TIMEOUT_S }],
  };
  return { SessionStart: [group], SessionEnd: [group] };
}

export interface LedgerSession {
  id: string;
  transcript: string;
}

function entryOf(record: string, sessionsRoot: string): LedgerSession | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const id = 'session_id' in parsed ? parsed.session_id : undefined;
  const transcript = 'transcript_path' in parsed ? parsed.transcript_path : undefined;
  if (typeof id !== 'string' || !SESSION_ID.test(id) || typeof transcript !== 'string') {
    return undefined;
  }
  const inside = path.relative(sessionsRoot, path.dirname(transcript));
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    return undefined;
  }
  return path.basename(transcript) === `${id}.jsonl` ? { id, transcript } : undefined;
}

export function readLedger(records: readonly string[], sessionsRoot: string): LedgerSession[] {
  const sessions = new Map<string, LedgerSession>();
  for (const record of records) {
    const entry = entryOf(record, sessionsRoot);
    if (entry !== undefined && !sessions.has(entry.id)) {
      sessions.set(entry.id, entry);
    }
  }
  return [...sessions.values()];
}

function isHookRecord(record: string): boolean {
  try {
    const parsed: unknown = JSON.parse(record);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'hook_event_name' in parsed &&
      SESSION_EVENTS.has(parsed.hook_event_name)
    );
  } catch {
    return false;
  }
}

export type Registration = 'registered' | 'waiting' | 'missing';

export function registration(
  records: readonly string[],
  { waitedMs, boundMs }: { waitedMs: number; boundMs: number },
): Registration {
  if (records.some((record) => isHookRecord(record))) {
    return 'registered';
  }
  return waitedMs < boundMs ? 'waiting' : 'missing';
}

export function sessionFolderName(realCwd: string): string {
  return `-${realCwd.replace(/\/+$/u, '').replace(/^\/+/u, '').replaceAll(/\/+/gu, '-')}`;
}

export function missingHookMessage(folder: string, boundMs: number): string {
  return [
    `Droid ran neither the probe's SessionStart nor its SessionEnd hook within ${boundMs}ms of starting its session,`,
    'so the probe cannot identify and delete the sessions this run created.',
    'Likely causes: hooks are disabled ("hooksDisabled": true in a hooks.json or settings.json),',
    'or your organization allows managed hooks only ("allowManagedHooksOnly": true).',
    `A session from this run may remain in ${folder}`,
  ].join('\n');
}

export function sessionFiles(session: LedgerSession): string[] {
  const dir = path.dirname(session.transcript);
  return SESSION_SUFFIXES.map((suffix) => path.join(dir, `${session.id}${suffix}`));
}

export function mayDelete(transcriptBornMs: number | undefined, launchedAtMs: number): boolean {
  if (transcriptBornMs === undefined) {
    return true;
  }
  return transcriptBornMs > 0 && transcriptBornMs >= launchedAtMs;
}

export function newestSqliteLibrary(
  entries: readonly { name: string; mtimeMs: number }[],
): string | undefined {
  return entries
    .filter((entry) => SQLITE_LIBRARY.test(entry.name))
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs)
    .at(0)?.name;
}
