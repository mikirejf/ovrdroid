import { entriesOf, fieldsOf, worded } from './fields.ts';
import type { Fields } from './fields.ts';

export const LAUNCH_WORD = 'ROSTER';
export const FIRST_CHILD_PROMPT = 'child-one:';
export const SECOND_CHILD_PROMPT = 'child-two:';
export const FIRST_CHILD_TITLE = 'roster child one';
export const SECOND_CHILD_TITLE = 'roster child two';

const TASK_TOOL = 'Task';
const TOOL_RESULT = 'tool_result';
export const ROSTER_FILTER = 'Filter agents';

export type RosterRole = 'main' | 'first-child' | 'second-child' | 'other';

export type RosterAnswer = 'launch-children' | 'hold' | 'ok';

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
  if (first.includes(FIRST_CHILD_PROMPT)) {
    return 'first-child';
  }
  if (first.includes(SECOND_CHILD_PROMPT)) {
    return 'second-child';
  }
  return first.includes(LAUNCH_WORD) ? 'main' : 'other';
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
  if (role === 'first-child' || role === 'second-child') {
    return 'hold';
  }
  if (role === 'main') {
    return mayLaunch(body) ? 'launch-children' : 'ok';
  }
  return 'ok';
}

export interface RosterTitles {
  model: string;
  firstChild: string;
  secondChild: string;
}

export const ROSTER_TITLES: RosterTitles = {
  model: 'Stub Stream',
  firstChild: FIRST_CHILD_TITLE,
  secondChild: SECOND_CHILD_TITLE,
};

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
  const firstChild = rowWith(rows, titles.firstChild);
  const secondChild = rowWith(rows, titles.secondChild);
  return [
    rowVerdict('first child', firstChild, titles.model),
    rowVerdict('second child', secondChild, titles.model),
  ];
}

export function describeRoster(verdicts: readonly Verdict[]): string {
  return verdicts.map(({ pass, text }) => `${pass ? 'PASS' : 'FAIL'}  ${text}`).join('\n');
}
