import { describe, expect, test } from 'bun:test';

import { describeToolErrors } from '../tool-errors-describe.ts';
import {
  baseName,
  classify,
  parseMoment,
  pickSession,
  readSettings,
  readToolErrors,
  summariseToolErrors,
} from '../tool-errors.ts';
import type { Filters } from '../tool-errors.ts';

const WINDOW: Filters = { since: Date.parse('2026-10-23'), until: Date.parse('2026-10-30') };
const DAY = '2026-10-24T10:00:00.000Z';
function notFound(name: string): string {
  return `Error: Not found: ${name}. Every tool this session can load is named in the Deferred tools reminder; if none provides this, the capability is unavailable.`;
}

interface Stamp {
  at?: string;
  visibility?: string;
}

function line(role: string, content: unknown[], { at = DAY, visibility }: Stamp = {}): string {
  return JSON.stringify({ type: 'message', timestamp: at, message: { role, content, visibility } });
}

function call(id: string, name: string, stamp: Stamp = {}): string {
  return line('assistant', [{ type: 'tool_use', id, name, input: {} }], stamp);
}

function failed(id: string, content: unknown, at = DAY): string {
  return line('user', [{ type: 'tool_result', tool_use_id: id, is_error: true, content }], { at });
}

function worked(id: string): string {
  return line('user', [{ type: 'tool_result', tool_use_id: id, is_error: false, content: 'ok' }]);
}

describe('baseName', () => {
  test.each([
    ['mcp__hollow_pipe__Read', 'Read'],
    ['mcp__oblige_door__reform_Read', 'Read'],
    ['view_Read', 'Read'],
    ['mcp://hollow_pipe__view_Read', 'Read'],
    ['mcp__hollow_pipe__str_replace_placeholder', 'str_replace'],
    ['mcp__hollow_pipe__mcp__hollow_pipe__blue_Edit_placeholder', 'Edit'],
    ['mcp__oblige_done__placeholder', 'oblige_done'],
    ['str_replace', 'str_replace'],
    ['Read', 'Read'],
  ])('%s is %s', (name, base) => {
    expect(baseName(name)).toBe(base);
  });
});

describe('classify', () => {
  test('a made-up tool name is not offered, but a ToolSearch miss is not', () => {
    expect(classify(notFound('mcp__hollow_pipe__Read'), 'mcp__hollow_pipe__Read')).toEqual({
      cause: 'not-offered',
      detail: ['mcp__hollow_pipe__Read'],
    });
    expect(
      classify('Error: Not found: "sheet". Every tool this session can load', 'ToolSearch').cause,
    ).toBe('other');
  });

  test('every wrong-typed field of an Invalid input is named with its tool', () => {
    const found = classify(
      'Error: Invalid Read input: offset: Expected number, received string; line_numbers: Expected boolean, received string; received keys: "file_path", "offset"',
      'Read',
    );
    expect(found.cause).toBe('argument-type');
    expect(found.detail).toEqual([
      'Read.offset: Expected number, received string',
      'Read.line_numbers: Expected boolean, received string',
    ]);
  });

  test('a Script input error loses its line number so repeats group', () => {
    const found = classify(
      'Error: Invalid Script input: (input): Line 41: program line equals the tag of the input block opened at line 1; pick a tag no body line uses; received keys: "script"',
      'Script',
    );
    expect(found.detail).toEqual([
      'Script.(input): Line N: program line equals the tag of the input block opened at line N',
    ]);
  });

  test.each([
    'Error: Error reading file: ENOENT: no such file or directory, open /x',
    'Error reading file: ENOENT: no such file or directory',
    'Error: Path does not exist: /x',
    'LS tool call failed: ENOENT: no such file or directory, scandir',
  ])('%s is a missing file', (text) => {
    expect(classify(text, 'Read').cause).toBe('missing-file');
  });

  test('a shell failure that mentions ENOENT later is not a missing file', () => {
    expect(
      classify('Error: Command failed (exit code: 1)\nENOENT: no such file', 'Execute').cause,
    ).toBe('other');
  });

  test('a refused edit is a file changed since read', () => {
    expect(
      classify('Error: File "/a.ts" has been modified externally since it was last read.', 'Edit')
        .cause,
    ).toBe('changed-since-read');
  });
});

describe('readToolErrors', () => {
  test('splits top-level from nested calls and pairs results by id', () => {
    const reading = readToolErrors(
      [
        call('t1', 'Read'),
        failed('t1', 'Error: Error reading file: ENOENT: x'),
        call('n1', 'Read', { visibility: 'user_only' }),
        failed('n1', [{ type: 'text', text: 'Path does not exist: /y' }]),
        call('t2', 'Grep'),
        worked('t2'),
      ],
      WINDOW,
    );
    expect(reading.requests).toBe(2);
    expect(reading.calls).toEqual({ top: 2, nested: 1 });
    expect(reading.failures.map((found) => [found.level, found.cause, found.tool])).toEqual([
      ['top', 'missing-file', 'Read'],
      ['nested', 'missing-file', 'Read'],
    ]);
  });

  test('reports the base name and day of a made-up tool name', () => {
    const [found] = readToolErrors(
      [call('t1', 'mcp__hollow_pipe__Grep'), failed('t1', notFound('mcp__hollow_pipe__Grep'))],
      WINDOW,
    ).failures;
    expect(found).toMatchObject({ cause: 'not-offered', base: 'Grep', day: '2026-10-24' });
  });

  test('ignores lines outside the window, even when the result is inside it', () => {
    const reading = readToolErrors(
      [
        call('old', 'Read', { at: '2026-10-20T00:00:00.000Z' }),
        failed('old', 'Error: Path does not exist: /x', DAY),
        call('late', 'Read', { at: '2026-10-30T00:00:00.000Z' }),
        failed('late', 'Error: Path does not exist: /x', '2026-10-30T00:00:01.000Z'),
        'not json',
        '',
      ],
      WINDOW,
    );
    expect(reading).toEqual({ requests: 0, calls: { top: 0, nested: 0 }, failures: [] });
  });

  test('--tool keeps a call by its name or its base name, and counts only those requests', () => {
    const reading = readToolErrors(
      [
        call('a', 'mcp__hollow_pipe__Read'),
        call('b', 'Grep'),
        failed('b', 'Error: Path does not exist: /x'),
      ],
      { ...WINDOW, tool: 'Read' },
    );
    expect(reading.requests).toBe(1);
    expect(reading.calls.top).toBe(1);
    expect(reading.failures).toEqual([]);
  });

  test('a failed result with no recorded call counts as a top-level failure', () => {
    const [found] = readToolErrors(
      [failed('ghost', 'Error: Tool execution cancelled by user')],
      WINDOW,
    ).failures;
    expect(found).toMatchObject({ level: 'top', cause: 'other', tool: '(no call recorded)' });
  });
});

describe('settings', () => {
  test('a missing settings file reads as unknown model and mode', () => {
    expect(readSettings()).toEqual({ model: 'unknown', mode: 'unknown' });
    expect(readSettings('{broken')).toEqual({ model: 'unknown', mode: 'unknown' });
  });

  test('model matches by substring ignoring case, mode exactly', () => {
    const settings = readSettings(
      '{"model":"custom:droidproxy:opus-5-5","toolExecutionMode":"script_only"}',
    );
    expect(pickSession(settings, { model: 'OPUS', mode: 'script_only' })).toBe(true);
    expect(pickSession(settings, { mode: 'direct_only' })).toBe(false);
    expect(pickSession(readSettings(), { model: 'opus' })).toBe(false);
  });
});

describe('parseMoment', () => {
  test('reads a date as UTC midnight and Nd as N days before now', () => {
    expect(parseMoment('2026-10-23', 0)).toBe(Date.parse('2026-10-23T00:00:00Z'));
    expect(parseMoment('7d', Date.parse('2026-10-30'))).toBe(Date.parse('2026-10-23'));
    expect(() => parseMoment('soon', 0)).toThrow();
  });
});

describe('describeToolErrors', () => {
  test('groups by model and mode, with rates per 1,000 requests', () => {
    const opus = readSettings('{"model":"opus","toolExecutionMode":"script_only"}');
    const lines = [
      call('a', 'mcp__hollow_pipe__Read'),
      failed('a', notFound('mcp__hollow_pipe__Read')),
      call('b', 'Read'),
      failed('b', 'Error: Invalid Read input: offset: Expected number, received string'),
      call('c', 'Read', { visibility: 'user_only' }),
      call('d', 'Edit'),
      failed('d', 'Error: The text to replace was not found'),
    ];
    const groups = summariseToolErrors([
      { settings: opus, reading: readToolErrors(lines, WINDOW) },
      { settings: readSettings(), reading: readToolErrors([call('e', 'Read')], WINDOW) },
      { settings: opus, reading: readToolErrors([], WINDOW) },
    ]);
    expect(groups.map((group) => [group.model, group.mode, group.sessions])).toEqual([
      ['opus', 'script_only', 1],
      ['unknown', 'unknown', 1],
    ]);
    const words = describeToolErrors(groups);
    expect(words).toContain('top-level requests that made tool calls: 3');
    expect(words).toContain('tool not offered (Not found)           1 (333.3)');
    expect(words).toContain('Read: 1 top level, 0 inside Script  (as mcp__hollow_pipe__Read x1)');
    expect(words).toContain('Read.offset: Expected number, received string: 1 top level');
    expect(words).toContain('Edit: Error: The text to replace was not found');
    expect(words).toContain('tool not offered (Not found): 2026-10-24 1/0');
  });

  test('prints every section in full', () => {
    const lines = [
      call('a', 'mcp__hollow_pipe__Read'),
      failed('a', notFound('mcp__hollow_pipe__Read')),
      call('b', 'Read'),
      failed('b', notFound('Read')),
      call('c', 'Read'),
      failed(
        'c',
        'Error: Invalid Read input: offset: Expected number, received 5; limit: Required',
      ),
      call('d', 'Read', { visibility: 'user_only' }),
      failed('d', 'Error reading file: ENOENT: no such file'),
      call('e', 'Edit'),
      failed('e', 'Error: File "/a" has been modified externally since it was last read.'),
      call('f', 'Edit'),
      failed('f', 'Error: The text to replace was not found'),
      call('g', 'Edit'),
      worked('g'),
    ];
    const groups = summariseToolErrors([
      {
        settings: readSettings('{"model":"opus","toolExecutionMode":"script_only"}'),
        reading: readToolErrors(lines, WINDOW),
      },
    ]);
    expect(describeToolErrors(groups)).toBe(
      [
        'opus, script_only: 1 sessions',
        '  top-level requests that made tool calls: 6',
        '  tool calls: 6 top level, 1 inside Script',
        '  failed calls (per 1,000 requests)         top level     inside Script',
        '  tool not offered (Not found)           2 (333.3)           0 (0.0)',
        '  argument type                          1 (166.7)           0 (0.0)',
        '  missing file                             0 (0.0)         1 (166.7)',
        '  file changed since read                1 (166.7)           0 (0.0)',
        '  other                                  1 (166.7)           0 (0.0)',
        '  tool not offered, by base name:',
        '    Read: 2 top level, 0 inside Script  (as mcp__hollow_pipe__Read x1)',
        '  argument type, by tool:',
        '    Read: 1 top level, 0 inside Script',
        '  argument type, by field (a call can have several):',
        '    Read.limit: Required: 1 top level, 0 inside Script',
        '    Read.offset: Expected number, received N: 1 top level, 0 inside Script',
        '  missing file, by tool:',
        '    Read: 0 top level, 1 inside Script',
        '  file changed since read, by tool:',
        '    Edit: 1 top level, 0 inside Script',
        '  other, by tool:',
        '    Edit: 1 top level, 0 inside Script',
        '  other, sample texts:',
        '    Edit: Error: The text to replace was not found',
        '  per day, top level / inside Script:',
        '    tool not offered (Not found): 2026-10-24 2/0',
        '    argument type: 2026-10-24 1/0',
        '    missing file: 2026-10-24 0/1',
        '    file changed since read: 2026-10-24 1/0',
        '    other: 2026-10-24 1/0',
      ].join('\n'),
    );
  });
});
