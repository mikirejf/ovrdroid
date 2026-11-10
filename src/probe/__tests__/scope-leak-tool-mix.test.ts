import { describe, expect, test } from 'bun:test';

import { fieldsOf, fieldsOfJson, worded } from '../fields.ts';
import { childWorkDone, responsesWorkDone, waitReportsExercised } from '../scope-leak-coverage.ts';
import { responsesEvents } from '../scope-leak-responses.ts';
import {
  MIX_CONTENT,
  describeMix,
  mixEvidence,
  mixExercised,
  mixWork,
} from '../scope-leak-tool-mix.ts';

const FILE = '/tmp/scope-leak-fixture.txt';
const BODY = {
  tools: [
    { name: 'Script', description: 'Read(input: Grep(input: Execute(input:' },
    { name: 'WaitForScript' },
  ],
};
const WORK = mixWork(BODY, FILE, { child: 0, id: 'toolu_work1' });
const VALUES = [
  MIX_CONTENT,
  [{ path: FILE, line: 1, text: MIX_CONTENT, kind: 'match' }],
  { exitCode: 0, output: 'scope-leak\n' },
];
function output(values: unknown[] = VALUES): string {
  return ['Read', 'Grep', 'Execute']
    .map((scopeLeakTool, index) =>
      JSON.stringify({ scopeLeakTool, status: 'fulfilled', value: values[index] }),
    )
    .join('\n');
}
function anthropic(content: string, isError = false) {
  return {
    messages: [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: WORK.call.id, content, is_error: isError }],
      },
      { role: 'user', content: 'Script-only reminder' },
    ],
  };
}
const COVERED = {
  launched: 14,
  waitsStarted: 14,
  waitsFinished: 11,
  completed: 11,
  tornDown: 11,
  heldPending: 3,
  quickReplies: 11,
  closedHosts: 11,
  mainState: 'executing_tool',
  observedAfterTeardownMs: 30_000,
};

describe('scope tool mix', () => {
  test('one Script starts all three nested calls together and prints every settled result', () => {
    const script = worded(fieldsOf(WORK.call.input), 'script');
    const mock = `const tools = {
      Read: async (input) => { if(input.file_path !== ${JSON.stringify(FILE)} || input.limit !== 5) throw Error("bad Read"); return ${JSON.stringify(VALUES[0])}; },
      Grep: async (input) => { if(input.pattern !== "scope-leak" || input.path !== ${JSON.stringify(FILE)} || input.output_mode !== "content") throw Error("bad Grep"); return ${JSON.stringify(VALUES[1])}; },
      Execute: async (input) => { if(input.command !== "echo scope-leak" || input.riskLevel !== "low" || !input.summary) throw Error("bad Execute"); return ${JSON.stringify(VALUES[2])}; },
    };
    const text = console.log;`;
    const result = Bun.spawnSync([process.execPath, '-e', `${mock}\n${script}`]);
    expect(result.exitCode).toBe(0);
    expect(script).toContain('Promise.allSettled([');
    expect(WORK.call.name).toBe('Script');
    expect(WORK.nested.map((call) => call.name)).toEqual(['Read', 'Grep', 'Execute']);
    expect(mixExercised(mixEvidence([WORK], [anthropic(result.stdout.toString())]))).toBe(true);
    expect(script).not.toContain('TodoWrite');
    expect(script).not.toContain('tools.Create');
  });
  test('only calls advertised Script and nested tools, with optional nested TodoWrite', () => {
    expect(() => mixWork({ tools: [] }, FILE, { child: 0, id: 'x' })).toThrow('advertised Script');
    expect(() => mixWork({ tools: [{ name: 'Script' }] }, FILE, { child: 0, id: 'x' })).toThrow(
      'nested Read',
    );
    const todo = mixWork(
      {
        tools: [
          {
            name: 'Script',
            description: `${BODY.tools[0]?.description} TodoWrite(input: { todos: string; }):`,
          },
        ],
      },
      FILE,
      { child: 0, id: 'x' },
    );
    expect(todo.nested.at(-1)).toEqual({
      name: 'TodoWrite',
      input: { todos: '1. [completed] Read the scratch file\n2. [completed] Check scope-leak' },
    });
  });
  test('recognizes Script output after batch results and a later warning on both APIs', () => {
    const body = anthropic(output());
    expect(childWorkDone(body)).toBe(true);
    const responses = {
      input: [
        { type: 'custom_tool_call', name: 'Script', call_id: 'call_work1', input: 'text("x")' },
        { type: 'custom_tool_call_output', call_id: 'call_work1', output: output() },
        { role: 'user', content: 'Script-only reminder' },
      ],
    };
    expect(responsesWorkDone({ input: responses.input.slice(0, 1) })).toBe(false);
    expect(responsesWorkDone(responses)).toBe(true);
    const work = { ...WORK, call: { ...WORK.call, id: 'call_work1' } };
    const children = mixEvidence([work], [{ path: '/v1/responses', body: responses }]);
    expect(mixExercised(children)).toBe(true);
    expect(children[0]).toMatchObject({ scriptError: false, todoSkipped: true });
    expect(children[0]?.calls.every((call) => call.error === false && call.success)).toBe(true);
    expect(describeMix(children)).toContain('Read error=false success=true');
  });
  test('missing, rejected, outer error and nonmatching results cannot prove coverage', () => {
    const rejected = JSON.stringify({
      scopeLeakTool: 'Read',
      status: 'rejected',
      value: 'missing',
    });
    const failed = mixEvidence([WORK], [anthropic(rejected)]);
    expect(failed[0]?.calls[0]?.error).toBe(true);
    const examples = [
      [],
      [anthropic(output(), true)],
      [anthropic(rejected)],
      [anthropic(output(['wrong content', VALUES[1], VALUES[2]]))],
      [anthropic(output([VALUES[0], [], VALUES[2]]))],
      [anthropic(output([VALUES[0], VALUES[1], { exitCode: 1, output: 'scope-leak' }]))],
    ];
    for (const bodies of examples) {
      const toolMix = mixEvidence([WORK], bodies);
      expect(mixExercised(toolMix)).toBe(false);
      expect(waitReportsExercised({ ...COVERED, toolMix })).toBe(false);
    }
    expect(waitReportsExercised({ ...COVERED, toolMix: [] })).toBe(false);
    expect(
      waitReportsExercised({ ...COVERED, toolMix: mixEvidence([WORK], [anthropic(output())]) }),
    ).toBe(true);
  });
  test('Responses Script uses raw custom tool input with matching SSE deltas and completion', () => {
    const script = worded(fieldsOf(WORK.call.input), 'script');
    const events = responsesEvents('mix', { ...WORK.call, customInput: script }).map((frame) =>
      fieldsOfJson(frame.split('\ndata: ')[1] ?? '{}'),
    );
    expect(events[0]?.get('type')).toBe('response.created');
    expect(events[2]?.get('item')).toMatchObject({
      type: 'custom_tool_call',
      name: 'Script',
      input: '',
    });
    expect(
      events
        .filter((item) => item.get('type') === 'response.custom_tool_call_input.delta')
        .map((item) => item.get('delta'))
        .join(''),
    ).toBe(script);
    expect(events.at(-2)?.get('item')).toMatchObject({
      type: 'custom_tool_call',
      name: 'Script',
      input: script,
      status: 'completed',
    });
    expect(events.at(-1)?.get('type')).toBe('response.completed');
  });
});
