import { describe, expect, test } from 'bun:test';

import { SEGMENTS, STACK_VIEW, stackedViewPatches, TABLES } from '../stacked-view-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Call {
  id: string;
  toolName: string;
  toolInput?: { skill?: string };
  isError?: boolean;
}

const segments = payloadFunction<[], (calls: Call[]) => [string, Call[]][]>(
  [],
  `${SEGMENTS}return $ODsegments`,
)();

function counted(names: string[]): string[] {
  const calls = names.map((toolName, index) => ({ id: `c${index}`, toolName }));
  return segments(calls).map(([name, members]) => `${name} ${members.length}`);
}

describe('stacked segments', () => {
  test('keep the order the calls ran in and merge only neighbours of the same tool', () => {
    expect(counted(['Read', 'Read', 'Grep', 'Read', 'Execute', 'Execute'])).toEqual([
      'Read 2',
      'Grep 1',
      'Read 1',
      'Execute 2',
    ]);
  });

  test('a run of one tool is one segment', () => {
    expect(counted(['Read', 'Read', 'Read'])).toEqual(['Read 3']);
  });

  test('each skill keeps its own segment, even next to another skill', () => {
    expect(counted(['Read', 'Skill', 'Skill', 'Read'])).toEqual([
      'Read 1',
      'Skill 1',
      'Skill 1',
      'Read 1',
    ]);
  });

  test('are drawn with a chevron between them', () => {
    const { replace } = patchNamed(stackedViewPatches, 'stacked-view-helpers');
    expect(replace).toContain(String.raw`children:" \u203A "`);
    expect(replace).not.toContain(String.raw`\xB7`);
  });
});

interface TextProps {
  text?: string;
  children?: string | (string | null)[];
}

function drawText(_type: string, props: TextProps): string {
  return (
    props.text ?? (Array.isArray(props.children) ? props.children.join('') : (props.children ?? ''))
  );
}

const drawStack = payloadFunction<
  [typeof drawText],
  (props: { group: { tools: Call[]; $ODopen?: boolean } }) => string
>(
  ['t'],
  'var l=t,c="Box",o="Text",S2="ToolName",a={text:{muted:"muted"},error:"error"},VW="param",Xxe="name";' +
    'function Uu(value){return value}function cbe(){return"completed"}function LA(noun,count){return noun+(count===1?"":"s")}' +
    `${TABLES}${SEGMENTS}${STACK_VIEW}return $ODStack`,
)(drawText);

function drawCalls(...calls: Omit<Call, 'id'>[]): string {
  const tools: Call[] = [];
  for (const [index, call] of calls.entries()) {
    tools.push({ id: `c${index}`, ...call });
  }
  return drawStack({ group: { tools } });
}

describe('skill names in stacked view', () => {
  test('keeps every loaded skill name in call order after the run closes', () => {
    expect(
      drawCalls(
        { toolName: 'Read' },
        { toolName: 'Skill', toolInput: { skill: 'patching-droid-cli' } },
        { toolName: 'Skill', toolInput: { skill: 'simplify' } },
        { toolName: 'Read' },
      ),
    ).toBe('Read 1 file › Skill patching-droid-cli › Skill simplify › Read 1 file');
  });

  test('does not hide repeated skill loads behind a count', () => {
    const call = { toolName: 'Skill', toolInput: { skill: 'simplify' } };
    expect(drawCalls(call, call)).toBe('Skill simplify › Skill simplify');
  });

  test('keeps the failure visible alongside the skill name', () => {
    expect(drawCalls({ toolName: 'Skill', toolInput: { skill: 'missing' }, isError: true })).toBe(
      'Skill missing (1 failed)',
    );
  });

  test('keeps the call visible before its skill input arrives', () => {
    expect(drawCalls({ toolName: 'Skill' })).toBe('Skill 1 call');
  });

  test('other tools still merge into counts', () => {
    expect(drawCalls({ toolName: 'Read' }, { toolName: 'Read' })).toBe('Read 2 files');
  });
});

describe('stacked failure counts', () => {
  test('puts a single failure in parentheses', () => {
    expect(drawCalls({ toolName: 'Read' }, { toolName: 'Read', isError: true })).toBe(
      'Read 2 files (1 failed)',
    );
  });

  test('puts multiple failures in parentheses before the next segment', () => {
    expect(
      drawCalls(
        { toolName: 'Read', isError: true },
        { toolName: 'Read', isError: true },
        { toolName: 'Execute' },
      ),
    ).toBe('Read 2 files (2 failed) › Execute 1 command');
  });
});
