import { STALE_EDIT_NOTE } from '../patch/stale-edit-patches.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import type { ToolCall } from './stub-model.ts';

export const STALE_REFUSAL = 'has been modified externally since it was last read';
export const SCRIPT_FAILED = 'EDIT-FAILED';

export type Expected = 'tolerated' | 'applied' | 'refused-stale' | 'landed';
export type Outcome = 'tolerated' | 'applied' | 'refused-stale' | 'failed' | 'no result';
export type Via = 'direct' | 'script';

export interface EditSpec {
  old: string;
  replacement: string;
  changeAll?: boolean;
}

export interface Step {
  outside?: string;
  edits: readonly EditSpec[];
  expect: Expected;
}

export interface StaleCase {
  what: string;
  via: Via;
  steps: readonly Step[];
  final: string;
  needsNote?: boolean;
}

export const INITIAL = 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 4\n';
const DELTA_CHANGED = 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 40\n';
const ALPHA_EDIT: EditSpec = { old: 'alpha = 1', replacement: 'alpha = 10' };
const GAMMA_EDIT: EditSpec = { old: 'gamma = 3', replacement: 'gamma = 30' };
const ALPHA_GONE = 'alpha = 7\nbeta = 2\ngamma = 3\ndelta = 4\n';
const ALPHA_TWICE = `${INITIAL}alpha = 1\n`;

export function staleEditCases(): StaleCase[] {
  return [
    {
      what: 'an outside change elsewhere in the file leaves old_str unique: the edit applies onto the current file, the outside change survives and the model is told',
      via: 'direct',
      steps: [{ outside: DELTA_CHANGED, edits: [ALPHA_EDIT], expect: 'tolerated' }],
      final: 'alpha = 10\nbeta = 2\ngamma = 3\ndelta = 40\n',
    },
    {
      what: 'an outside change removed old_str: Droid refuses as stock does and writes nothing',
      via: 'direct',
      steps: [{ outside: ALPHA_GONE, edits: [ALPHA_EDIT], expect: 'refused-stale' }],
      final: ALPHA_GONE,
    },
    {
      what: 'an outside change made old_str appear twice: Droid refuses as stock does and writes nothing',
      via: 'direct',
      steps: [{ outside: ALPHA_TWICE, edits: [ALPHA_EDIT], expect: 'refused-stale' }],
      final: ALPHA_TWICE,
    },
    {
      what: 'change_all set after an outside change: Droid refuses as stock does and writes nothing',
      via: 'direct',
      steps: [
        {
          outside: DELTA_CHANGED,
          edits: [{ ...ALPHA_EDIT, changeAll: true }],
          expect: 'refused-stale',
        },
      ],
      final: DELTA_CHANGED,
    },
    {
      what: 'two Edits to different spans in one message after an outside change: both land and neither is lost',
      via: 'direct',
      steps: [{ outside: DELTA_CHANGED, edits: [ALPHA_EDIT, GAMMA_EDIT], expect: 'landed' }],
      final: 'alpha = 10\nbeta = 2\ngamma = 30\ndelta = 40\n',
      needsNote: true,
    },
    {
      what: 'an Edit made inside a Script call after an outside change applies the same way',
      via: 'script',
      steps: [{ outside: DELTA_CHANGED, edits: [ALPHA_EDIT], expect: 'tolerated' }],
      final: 'alpha = 10\nbeta = 2\ngamma = 3\ndelta = 40\n',
    },
    {
      what: 'a second Edit right after a tolerated one, with no outside change between, applies with no note',
      via: 'direct',
      steps: [
        { outside: DELTA_CHANGED, edits: [ALPHA_EDIT], expect: 'tolerated' },
        { edits: [GAMMA_EDIT], expect: 'applied' },
      ],
      final: 'alpha = 10\nbeta = 2\ngamma = 30\ndelta = 40\n',
    },
  ];
}

export interface StubCall extends ToolCall {
  id: string;
}

export interface Turn {
  outside?: string;
  calls: StubCall[];
  editCallIds: string[];
}

function editInput(file: string, edit: EditSpec) {
  const input = { file_path: file, old_str: edit.old, new_str: edit.replacement };
  return edit.changeAll === undefined ? input : { ...input, change_all: edit.changeAll };
}

function scriptReading(file: string): string {
  return `await tools.Read(${JSON.stringify({ file_path: file })});`;
}

function scriptEditing(file: string, edit: EditSpec): string {
  return [
    'try {',
    `  const reply = await tools.Edit(${JSON.stringify(editInput(file, edit))});`,
    "  text('EDIT-REPLY ' + (typeof reply === 'string' ? reply : JSON.stringify(reply)));",
    '} catch (error) {',
    `  text('${SCRIPT_FAILED} ' + String(error));`,
    '}',
  ].join('\n');
}

export function turnsOf(
  staleCase: StaleCase,
  file: string,
  idFor: (turn: number) => string,
): Turn[] {
  const reading: Turn =
    staleCase.via === 'script'
      ? {
          calls: [{ id: idFor(0), name: 'Script', input: { script: scriptReading(file) } }],
          editCallIds: [],
        }
      : { calls: [{ id: idFor(0), name: 'Read', input: { file_path: file } }], editCallIds: [] };
  const edits = staleCase.steps.map((step, at): Turn => {
    const turn = at + 1;
    const calls: StubCall[] =
      staleCase.via === 'script'
        ? [
            {
              id: idFor(turn),
              name: 'Script',
              input: { script: step.edits.map((edit) => scriptEditing(file, edit)).join('\n') },
            },
          ]
        : step.edits.map((edit, index) => ({
            id: `${idFor(turn)}_${index}`,
            name: 'Edit',
            input: editInput(file, edit),
          }));
    const planned: Turn = { calls, editCallIds: calls.map((call) => call.id) };
    if (step.outside !== undefined) {
      planned.outside = step.outside;
    }
    return planned;
  });
  return [reading, ...edits];
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return Array.isArray(content)
    ? content.map((part) => worded(fieldsOf(part), 'text')).join('\n')
    : '';
}

export function toolResultsIn(body: unknown): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  for (const message of entriesOf(fieldsOf(body), 'messages')) {
    for (const block of entriesOf(message, 'content')) {
      if (worded(block, 'type') === 'tool_result') {
        results.set(worded(block, 'tool_use_id'), {
          text: textOf(block.get('content')),
          isError: block.get('is_error') === true,
        });
      }
    }
  }
  return results;
}

export function toolNamesIn(body: unknown): string[] {
  return entriesOf(fieldsOf(body), 'tools').map((tool) => worded(tool, 'name'));
}

export function outcomeOf(result: ToolResult | undefined): Outcome {
  if (result === undefined) {
    return 'no result';
  }
  if (result.text.includes(STALE_REFUSAL)) {
    return 'refused-stale';
  }
  if (result.isError || result.text.includes(SCRIPT_FAILED)) {
    return 'failed';
  }
  return result.text.includes(STALE_EDIT_NOTE) ? 'tolerated' : 'applied';
}

export interface Observed {
  results: ReadonlyMap<string, ToolResult>;
  outsideWrites: number;
  finalText: string | undefined;
  offered: readonly string[];
}

export interface Verdict {
  pass: boolean;
  text: string;
}

function matches(expected: Expected, outcome: Outcome): boolean {
  return expected === 'landed'
    ? outcome === 'tolerated' || outcome === 'applied'
    : expected === outcome;
}

function mismatch(expected: Expected, outcome: Outcome, step: number): string {
  const at = `step ${step}`;
  if (outcome === 'refused-stale' && (expected === 'tolerated' || expected === 'landed')) {
    return `${at}: Droid refused with "modified externally since it was last read" although old_str still matched once, so the edit was safe`;
  }
  if (outcome === 'applied' && (expected === 'tolerated' || expected === 'refused-stale')) {
    return `not exercised, ${at}: the Edit went through with no refusal and no note, so Droid did not see the file as changed between the Read and the Edit`;
  }
  if (outcome === 'failed' && (expected === 'tolerated' || expected === 'refused-stale')) {
    return `not exercised, ${at}: the Edit failed for another reason than the stale-file refusal, so the stale branch was not reached`;
  }
  if (outcome === 'tolerated' && expected === 'refused-stale') {
    return `${at}: Droid applied an edit it should refuse`;
  }
  if (outcome === 'tolerated' && expected === 'applied') {
    return `${at}: Droid added the stale-file note although nothing changed since the last Edit`;
  }
  return `${at}: expected ${expected}, saw ${outcome}`;
}

function problemsOf(staleCase: StaleCase, turns: readonly Turn[], observed: Observed): string[] {
  const wanted = staleCase.steps.filter((step) => step.outside !== undefined).length;
  if (observed.outsideWrites < wanted) {
    return [
      `not exercised: the file was changed from outside ${observed.outsideWrites} of ${wanted} times, so Droid never reached the Edit after a change`,
    ];
  }
  if (staleCase.via === 'script' && !observed.offered.includes('Script')) {
    return [
      `not exercised: Droid did not offer the Script tool to the stub model (offered: ${observed.offered.join(', ')})`,
    ];
  }
  const problems: string[] = [];
  const outcomes: Outcome[] = [];
  for (const [at, step] of staleCase.steps.entries()) {
    const turn = turns[at + 1];
    for (const id of turn?.editCallIds ?? []) {
      const outcome = outcomeOf(observed.results.get(id));
      outcomes.push(outcome);
      if (outcome === 'no result') {
        problems.push(`not exercised, step ${at + 1}: Droid never reported a result for the Edit`);
      } else if (!matches(step.expect, outcome)) {
        problems.push(mismatch(step.expect, outcome, at + 1));
      }
    }
  }
  if (staleCase.needsNote === true && !outcomes.includes('tolerated') && problems.length === 0) {
    problems.push('not exercised: neither Edit carried the stale-file note');
  }
  if (observed.finalText !== staleCase.final) {
    problems.push(
      `the final file is ${JSON.stringify(observed.finalText)}, expected ${JSON.stringify(staleCase.final)}`,
    );
  }
  return problems;
}

export function caseVerdict(
  staleCase: StaleCase,
  turns: readonly Turn[],
  observed: Observed,
): Verdict {
  const problems = problemsOf(staleCase, turns, observed);
  return problems.length === 0
    ? { pass: true, text: staleCase.what }
    : { pass: false, text: `${staleCase.what}: ${problems.join('; ')}` };
}

export function describeVerdicts(verdicts: readonly Verdict[]): string {
  return verdicts.map((verdict) => `${verdict.pass ? 'ok  ' : 'FAIL'}  ${verdict.text}`).join('\n');
}
