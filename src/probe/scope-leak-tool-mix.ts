import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, fieldsOfJson, resultText, worded } from './fields.ts';
import type { ToolCall } from './stub-model.ts';

export const MIX_CONTENT = 'scope-leak scratch read and grep marker';
export const MIX_WORD = 'scope-leak';

export interface NestedCall {
  name: string;
  input: Record<string, string | number>;
}
export interface MixWork {
  child: number;
  call: ToolCall & { id: string };
  nested: NestedCall[];
}
export interface NestedResult extends NestedCall {
  error: boolean | null;
  success: boolean;
  result?: unknown;
}
export interface MixChildEvidence {
  child: number;
  callId: string;
  scriptError: boolean | null;
  output: string;
  calls: NestedResult[];
  todoSkipped: boolean;
}
export function mixWork(
  body: unknown,
  file: string,
  { child, id }: { child: number; id: string },
): MixWork {
  const script = entriesOf(fieldsOf(body), 'tools').find(
    (tool) => worded(tool, 'name') === 'Script',
  );
  if (script === undefined) {
    throw new Error('tool mix requires an advertised Script tool');
  }
  const description = worded(script, 'description');
  const nested: NestedCall[] = [
    { name: 'Read', input: { file_path: file, limit: 5 } },
    { name: 'Grep', input: { path: file, pattern: MIX_WORD, output_mode: 'content' } },
    {
      name: 'Execute',
      input: { command: 'echo scope-leak', riskLevel: 'low', summary: 'Print a word' },
    },
  ];
  if (description.includes('TodoWrite(input:')) {
    nested.push({
      name: 'TodoWrite',
      input: { todos: '1. [completed] Read the scratch file\n2. [completed] Check scope-leak' },
    });
  }
  for (const call of nested) {
    if (!description.includes(`${call.name}(input:`)) {
      throw new Error(`tool mix requires nested ${call.name} in Script's declaration`);
    }
  }
  const program = [
    `const names = ${JSON.stringify(nested.map((call) => call.name))};`,
    'const results = await Promise.allSettled([',
    ...nested.map((call) => `  tools.${call.name}(${JSON.stringify(call.input)}),`),
    ']);',
    'results.forEach((r, i) => text(JSON.stringify({scopeLeakTool: names[i], status: r.status, value: r.status === "fulfilled" ? r.value : String(r.reason)})));',
  ].join('\n');
  return { child, call: { id, name: 'Script', input: { script: program } }, nested };
}
function resultsIn(body: unknown): Fields[] {
  const fields = fieldsOf(body);
  return [
    ...entriesOf(fields, 'messages')
      .flatMap((message) => entriesOf(message, 'content'))
      .filter((block) => worded(block, 'type') === 'tool_result'),
    ...entriesOf(fields, 'input').filter((item) =>
      ['function_call_output', 'custom_tool_call_output'].includes(worded(item, 'type')),
    ),
  ];
}
function expectedOutput(name: string, value: unknown): boolean {
  if (name === 'Read') {
    return typeof value === 'string' && value.includes(MIX_CONTENT);
  }
  if (name === 'Grep') {
    return (
      Array.isArray(value) &&
      value.some((item) => {
        const fields = fieldsOf(item);
        return worded(fields, 'kind') === 'match' && worded(fields, 'text').includes(MIX_CONTENT);
      })
    );
  }
  if (name === 'Execute') {
    const fields = fieldsOf(value);
    return fields.get('exitCode') === 0 && worded(fields, 'output').includes(MIX_WORD);
  }
  return true;
}
export function mixEvidence(
  work: readonly MixWork[],
  bodies: readonly unknown[],
): MixChildEvidence[] {
  const results = bodies.flatMap((row) => {
    const fields = fieldsOf(row);
    return resultsIn(fields.get('body') ?? row);
  });
  return work.map(({ child, call, nested }) => {
    const result = results.find(
      (item) => (worded(item, 'tool_use_id') || worded(item, 'call_id')) === call.id,
    );
    const output = result === undefined ? '' : resultText(result) || worded(result, 'output');
    const records = output.split('\n').map((line) => fieldsOfJson(line));
    return {
      child,
      callId: call.id,
      scriptError: result === undefined ? null : result.get('is_error') === true,
      output,
      todoSkipped: !nested.some((item) => item.name === 'TodoWrite'),
      calls: nested.map((item) => {
        const record = records.find((row) => worded(row, 'scopeLeakTool') === item.name);
        const value = record?.get('value');
        const error =
          record === undefined
            ? null
            : worded(record, 'status') !== 'fulfilled' ||
              fieldsOf(value).get('is_error') === true ||
              fieldsOf(value).get('isError') === true ||
              (item.name === 'Execute' && fieldsOf(value).get('exitCode') !== 0);
        return {
          ...item,
          error,
          success: error === false && expectedOutput(item.name, value),
          result: value,
        };
      }),
    };
  });
}
export function mixExercised(children: readonly MixChildEvidence[]): boolean {
  return children.some(
    (child) =>
      child.scriptError === false &&
      ['Read', 'Grep', 'Execute'].every((name) =>
        child.calls.some((call) => call.name === name && call.success),
      ),
  );
}
export function describeMix(children: readonly MixChildEvidence[]): string {
  return children
    .map(
      (child) =>
        `tool mix child ${child.child} ${child.callId}: Script error=${child.scriptError}; ${child.calls.map((call) => `${call.name} error=${call.error} success=${call.success}`).join(', ')}; TodoWrite ${child.todoSkipped ? 'not declared, skipped' : 'nested'}`,
    )
    .join('; ');
}
