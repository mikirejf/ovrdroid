import { InvalidArgumentError } from 'commander';

import { MS_PER_DAY } from '../cli.ts';
import { entriesOf, fieldsOf, fieldsOfJson, resultText, worded } from './fields.ts';
import { HIDDEN_FROM_MODEL, ofKind } from './live-transcript.ts';
import { STALE_REFUSAL } from './stale-edit-cases.ts';

const UNKNOWN = 'unknown';
export const MODES = ['script_only', 'direct_only'] as const;
export const LEVELS = ['top', 'nested'] as const;
export const CAUSES = [
  'not-offered',
  'argument-type',
  'missing-file',
  'changed-since-read',
  'other',
] as const;

export type Level = (typeof LEVELS)[number];
export type Cause = (typeof CAUSES)[number];
export type Counts = Record<Level, number>;

const NO_CALL = '(no call recorded)';
const DETAIL_CHARS = 100;
const KNOWN_TOOLS: ReadonlySet<string> = new Set([
  'ApplyPatch',
  'AskUser',
  'Create',
  'Edit',
  'Execute',
  'FetchUrl',
  'GenerateImage',
  'Glob',
  'Grep',
  'LS',
  'Read',
  'Script',
  'Skill',
  'Task',
  'TodoWrite',
  'ToolSearch',
  'WaitForScript',
  'WebSearch',
]);
const PLACEHOLDER_SUFFIX = /_{1,2}placeholder$/u;
const WORD_PREFIX = /^[a-z]+_(?<rest>.+)$/u;
const RELATIVE_DAYS = /^(?<days>\d+)d$/u;
const NOT_OFFERED = /^(?:Error: )*Not found: (?<name>[^\s"]+?)\.? Every tool/u;
const INVALID_INPUT = /^(?:Error: )*Invalid (?<tool>\S+) input: (?<fields>.+)$/su;
const KEYS_NOTE = 'received keys:';
const INPUT_FIELD = /^(?<field>[^:]+): (?<problem>.+)$/su;
const MISSING_FILE =
  /^(?:Error: )*(?:Error reading file: ENOENT|Path does not exist:|\S+ tool call failed: ENOENT)/u;
const SEARCH_TOOL = 'ToolSearch';

export interface Failure {
  level: Level;
  cause: Cause;
  tool: string;
  base: string;
  day: string;
  detail: string[];
}

export interface Reading {
  requests: number;
  calls: Counts;
  failures: Failure[];
}

export interface Filters {
  since: number;
  until: number;
  tool?: string | undefined;
}

export interface SessionSettings {
  model: string;
  mode: string;
}

export interface SessionPick {
  model?: string | undefined;
  mode?: string | undefined;
}

export interface SessionReading {
  settings: SessionSettings;
  reading: Reading;
}

export interface Group {
  model: string;
  mode: string;
  sessions: number;
  requests: number;
  calls: Counts;
  failures: Failure[];
}

interface Verdict {
  cause: Cause;
  detail: string[];
}

interface Call {
  level: Level;
  tool: string;
  day: string;
  counted: boolean;
}

export function parseMoment(raw: string, now: number): number {
  const days = RELATIVE_DAYS.exec(raw)?.groups?.['days'];
  if (days !== undefined) {
    return now - Number(days) * MS_PER_DAY;
  }
  const at = Date.parse(raw);
  if (Number.isNaN(at)) {
    throw new InvalidArgumentError(
      'expected a date such as 2026-10-23, or a number of days such as 7d',
    );
  }
  return at;
}

export function baseName(name: string): string {
  const last = name.replace(PLACEHOLDER_SUFFIX, '').split('__').at(-1) ?? name;
  const rest = WORD_PREFIX.exec(last)?.groups?.['rest'];
  return rest !== undefined && KNOWN_TOOLS.has(rest) ? rest : last;
}

function clipped(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim().slice(0, DETAIL_CHARS);
}

function inputDetail(tool: string, fields: string): string[] {
  const parts = fields.split('; ').flatMap((part) => {
    const groups = part.startsWith(KEYS_NOTE) ? undefined : INPUT_FIELD.exec(part)?.groups;
    return groups === undefined
      ? []
      : [
          `${tool}.${groups['field']}: ${clipped(groups['problem'] ?? '').replaceAll(/\d+/gu, 'N')}`,
        ];
  });
  return parts.length > 0 ? parts : [`${tool}: ${clipped(fields)}`];
}

export function classify(text: string, callTool: string): Verdict {
  const notOffered = NOT_OFFERED.exec(text)?.groups?.['name'];
  if (notOffered !== undefined && callTool !== SEARCH_TOOL) {
    return { cause: 'not-offered', detail: [notOffered] };
  }
  const invalid = INVALID_INPUT.exec(text)?.groups;
  if (invalid !== undefined) {
    return {
      cause: 'argument-type',
      detail: inputDetail(invalid['tool'] ?? callTool, invalid['fields'] ?? ''),
    };
  }
  if (MISSING_FILE.test(text)) {
    return { cause: 'missing-file', detail: [] };
  }
  if (text.includes(STALE_REFUSAL)) {
    return { cause: 'changed-since-read', detail: [] };
  }
  return { cause: 'other', detail: [clipped(text)] };
}

export function readSettings(text = ''): SessionSettings {
  const fields = fieldsOfJson(text);
  return {
    model: worded(fields, 'model') || UNKNOWN,
    mode: worded(fields, 'toolExecutionMode') || UNKNOWN,
  };
}

export function pickSession(settings: SessionSettings, pick: SessionPick): boolean {
  const modelFits =
    pick.model === undefined || settings.model.toLowerCase().includes(pick.model.toLowerCase());
  return modelFits && (pick.mode === undefined || settings.mode === pick.mode);
}

function asksFor(name: string, filters: Filters): boolean {
  return filters.tool === undefined || name === filters.tool || baseName(name) === filters.tool;
}

function inWindow(at: number, filters: Filters): boolean {
  return at >= filters.since && at < filters.until;
}

function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 'YYYY-MM-DD'.length);
}

export function readToolErrors(lines: readonly string[], filters: Filters): Reading {
  const calls = new Map<string, Call>();
  const reading: Reading = { requests: 0, calls: { top: 0, nested: 0 }, failures: [] };

  const fail = ({ level, tool, day }: Pick<Call, 'level' | 'tool' | 'day'>, text: string): void => {
    const { cause, detail } = classify(text, tool);
    reading.failures.push({ level, cause, tool, base: baseName(tool), day, detail });
  };

  for (const line of lines) {
    const parsed = fieldsOfJson(line);
    const at = Date.parse(worded(parsed, 'timestamp'));
    const message = fieldsOf(parsed.get('message'));
    const blocks = entriesOf(message, 'content');
    if (worded(message, 'role') === 'assistant') {
      const level: Level = worded(message, 'visibility') === HIDDEN_FROM_MODEL ? 'nested' : 'top';
      let asked = false;
      for (const block of ofKind(blocks, 'tool_use')) {
        const tool = worded(block, 'name');
        const counted = inWindow(at, filters) && asksFor(tool, filters);
        calls.set(worded(block, 'id'), { level, tool, day: counted ? dayOf(at) : '', counted });
        if (counted) {
          reading.calls[level] += 1;
          asked = true;
        }
      }
      if (asked && level === 'top') {
        reading.requests += 1;
      }
      continue;
    }
    for (const block of ofKind(blocks, 'tool_result')) {
      if (block.get('is_error') !== true) {
        continue;
      }
      const call = calls.get(worded(block, 'tool_use_id'));
      if (call === undefined && inWindow(at, filters) && filters.tool === undefined) {
        fail({ level: 'top', tool: NO_CALL, day: dayOf(at) }, resultText(block));
      } else if (call?.counted === true) {
        fail(call, resultText(block));
      }
    }
  }
  return reading;
}

export function summariseToolErrors(readings: readonly SessionReading[]): Group[] {
  const groups = new Map<string, Group>();
  for (const { settings, reading } of readings) {
    if (reading.calls.top + reading.calls.nested === 0) {
      continue;
    }
    const key = `${settings.model}\n${settings.mode}`;
    const group = groups.get(key) ?? {
      ...settings,
      sessions: 0,
      requests: 0,
      calls: { top: 0, nested: 0 },
      failures: [],
    };
    group.sessions += 1;
    group.requests += reading.requests;
    group.calls.top += reading.calls.top;
    group.calls.nested += reading.calls.nested;
    group.failures.push(...reading.failures);
    groups.set(key, group);
  }
  return [...groups.values()].toSorted(
    (left, right) => left.model.localeCompare(right.model) || left.mode.localeCompare(right.mode),
  );
}
