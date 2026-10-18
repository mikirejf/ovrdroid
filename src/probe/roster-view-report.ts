import { entriesOf, fieldsOf, worded } from './fields.ts';
import type { Fields } from './fields.ts';

export const NEST_WORD = 'NEST';
export const LEVEL_ONE = 'level1:';
export const LEVEL_TWO = 'level2:';
export const CHILD_TITLE = 'roster level one';
export const GRANDCHILD_TITLE = 'roster level two';

const TASK_TOOL = 'Task';
const TOOL_RESULT = 'tool_result';
export const ROSTER_FILTER = 'Filter agents';
const NODE_PREFIX = /^[\s│├└─▸▾▶▼›>•●○◐◑*+-]*/u;

export type RosterRole = 'main' | 'child' | 'grandchild' | 'other';

export type RosterAnswer = 'launch-child' | 'launch-grandchild' | 'hold' | 'hi' | 'ok';

export interface Verdict {
  pass: boolean;
  text: string;
}

function blocks(message: Fields): Fields[] {
  const content = message.get('content');
  return Array.isArray(content) ? content.map((block) => fieldsOf(block)) : [];
}

function wordsOf(message: Fields): string {
  const content = message.get('content');
  if (typeof content === 'string') {
    return content;
  }
  return blocks(message)
    .map((block) => worded(block, 'text'))
    .join('\n');
}

function openingWords(body: unknown): string {
  const words: string[] = [];
  for (const message of entriesOf(fieldsOf(body), 'messages')) {
    if (worded(message, 'role') === 'assistant') {
      break;
    }
    words.push(wordsOf(message));
  }
  return words.join('\n');
}

export function roleOf(body: unknown): RosterRole {
  const first = openingWords(body);
  if (first.includes(LEVEL_TWO)) {
    return 'grandchild';
  }
  if (first.includes(LEVEL_ONE)) {
    return 'child';
  }
  return first.includes(NEST_WORD) ? 'main' : 'other';
}

function mayLaunch(body: unknown): boolean {
  const request = fieldsOf(body);
  const tools = entriesOf(request, 'tools').map((tool) => worded(tool, 'name'));
  const last = entriesOf(request, 'messages').at(-1);
  if (!tools.includes(TASK_TOOL) || last === undefined) {
    return false;
  }
  return (
    worded(last, 'role') === 'user' &&
    !blocks(last).some((block) => worded(block, 'type') === TOOL_RESULT)
  );
}

export function answerFor(body: unknown): RosterAnswer {
  const role = roleOf(body);
  if (role === 'grandchild') {
    return 'hold';
  }
  if (role === 'child') {
    return mayLaunch(body) ? 'launch-grandchild' : 'hi';
  }
  if (role === 'main') {
    return mayLaunch(body) ? 'launch-child' : 'ok';
  }
  return 'ok';
}

export interface RosterTitles {
  model: string;
  child: string;
  grandchild: string;
}

export const ROSTER_TITLES: RosterTitles = {
  model: 'Stub Stream',
  child: CHILD_TITLE,
  grandchild: GRANDCHILD_TITLE,
};

export function indentOf(line: string): number {
  return NODE_PREFIX.exec(line)?.[0].length ?? 0;
}

function rowWith(lines: readonly string[], marker: string): string | undefined {
  return lines.find((line) => line.toLowerCase().includes(marker.toLowerCase()));
}

function verdict(pass: boolean, passed: string, failed: string): Verdict {
  return { pass, text: pass ? passed : failed };
}

function rowVerdict(label: string, row: string | undefined, model: string): Verdict {
  if (row === undefined) {
    return { pass: false, text: `the ${label} row is not on screen` };
  }
  return verdict(
    row.includes(model),
    `the ${label} row carries the ${model} chip: ${row.trim()}`,
    `the ${label} row has no ${model} chip: ${row.trim()}`,
  );
}

export function rosterVerdicts(
  lines: readonly string[] | undefined,
  titles: RosterTitles,
): Verdict[] {
  if (lines === undefined) {
    return [{ pass: false, text: 'the session roster never listed the sub-agents' }];
  }
  const opened = lines.findIndex((line) => line.includes(ROSTER_FILTER));
  if (opened === -1) {
    return [{ pass: false, text: `the session roster is not open: no "${ROSTER_FILTER}" line` }];
  }
  const rows = lines.slice(opened + 1);
  const child = rowWith(rows, titles.child);
  const grandchild = rowWith(rows, titles.grandchild);
  const nested =
    child !== undefined &&
    grandchild !== undefined &&
    rows.indexOf(child) < rows.indexOf(grandchild) &&
    indentOf(grandchild) > indentOf(child);
  return [
    rowVerdict('child', child, titles.model),
    rowVerdict('grandchild', grandchild, titles.model),
    verdict(
      nested,
      `the grandchild sits under the child, indented ${indentOf(grandchild ?? '')} against ${indentOf(child ?? '')}`,
      'the grandchild row is not indented under the child row',
    ),
  ];
}

export function describeRoster(verdicts: readonly Verdict[]): string {
  return verdicts.map(({ pass, text }) => `${pass ? 'PASS' : 'FAIL'}  ${text}`).join('\n');
}
