import { describe, expect, test } from 'bun:test';

import {
  IS_TASK_STEP,
  NEST_UI_DEPTH,
  NESTS,
  nestedSubagentUiPatches,
  TASK_BOX_MAX_ROWS,
  TASK_NAME,
} from '../nested-subagent-ui-patches.ts';
import { applies } from '../rebase.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(nestedSubagentUiPatches);

interface TaskInput {
  subagent_type?: unknown;
  description?: unknown;
  resume?: unknown;
}

interface Ledger {
  subagentType?: string;
  description?: string;
}

type TaskName = (input: TaskInput) => { name: string; description: string };

function taskNameOver(ledger: Record<string, Ledger>): TaskName {
  return payloadFunction<[(id: string) => Ledger | undefined], TaskName>(
    ['qg'],
    `${TASK_NAME};return $ODtaskName`,
  )((id) => ledger[id]);
}

describe('a nested Task step is named after its subagent', () => {
  const taskName = taskNameOver({ old: { subagentType: 'grunt', description: 'Earlier scan' } });

  test('a launch shows the subagent type and its description', () => {
    expect(taskName({ subagent_type: 'grunt', description: 'Find callers' })).toEqual({
      name: 'grunt',
      description: 'Find callers',
    });
  });

  test('a resume reads the type and description from the ledger', () => {
    expect(taskName({ resume: ' old ', subagent_type: 'other' })).toEqual({
      name: 'Resume grunt',
      description: 'Earlier scan',
    });
  });

  test('a resume the ledger does not know falls back to the input', () => {
    expect(taskName({ resume: 'gone', subagent_type: 'grunt', description: 'x' })).toEqual({
      name: 'Resume grunt',
      description: 'x',
    });
  });

  test('a call with no type keeps the generic Task label', () => {
    expect(taskName({})).toEqual({ name: 'Task', description: '' });
  });
});

interface Step {
  type: string;
  toolName?: string;
  toolUseId?: string;
  subagentSessionId?: string;
}

const nests = payloadFunction<[], (step: Step | undefined, depth: number) => boolean>(
  [],
  `${IS_TASK_STEP}${NESTS};return $ODnests`,
)();

interface NestCase {
  name: string;
  step?: Step;
  depth: number;
  opens: boolean;
}

describe('a row opens a nested line only for a resolvable Task step above the depth limit', () => {
  const call: Step = {
    type: 'tool_call',
    toolName: 'Task',
    toolUseId: 'toolu_1',
    subagentSessionId: 'child',
  };

  const { toolUseId: _id, ...withoutId } = call;
  const { subagentSessionId: _session, ...withoutSession } = call;

  test.each<NestCase>([
    { name: 'a Task call at level 1', step: call, depth: 1, opens: true },
    { name: 'a Task call at level 2', step: call, depth: 2, opens: true },
    { name: 'a Task call at the deepest level', step: call, depth: NEST_UI_DEPTH, opens: false },
    {
      name: 'a finished Task, so the line can say Done',
      step: { ...call, type: 'tool_result' },
      depth: 1,
      opens: true,
    },
    { name: 'a Task call without its tool use id', step: withoutId, depth: 1, opens: false },
    { name: 'a Task call without its session', step: withoutSession, depth: 1, opens: false },
    { name: 'a Grep call', step: { ...call, toolName: 'Grep' }, depth: 1, opens: false },
    { name: 'a status update', step: { type: 'status' }, depth: 1, opens: false },
    { name: 'no step yet', depth: 1, opens: false },
  ])('$name', ({ step, depth, opens }) => {
    expect(nests(step, depth)).toBe(opens);
  });
});

const { patchedText, rebasedNamed } = shipped(nestedSubagentUiPatches);

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  test.each(nestedSubagentUiPatches.map((patch) => [patch.name] as const))('%s applies', (name) => {
    expect(applies(rebasedNamed(name))).toBe(true);
  });

  test('Task progress updates carry their tool use id', () => {
    expect(patchedText).toContain(rebasedNamed('nested-subagent-ui-task-call-carries-id').replace);
    expect(patchedText).toContain(
      rebasedNamed('nested-subagent-ui-task-result-carries-id').replace,
    );
  });

  test('the detailed view formats every step through the stock switch, rendered live', () => {
    const step = rebasedNamed('nested-subagent-ui-detail-step');
    const returns = rebasedNamed('nested-subagent-ui-detail-step-returns');
    const live = rebasedNamed('nested-subagent-ui-detail-live-steps');
    expect(step.replace).toContain('function $ODstep(');
    expect(live.replace).toContain('t($ODDetailSteps,{input:');
    expect(patchedText).toContain(step.replace);
    expect(patchedText).not.toContain(returns.find);
    expect(patchedText).toContain(returns.replace);
    expect(patchedText).toContain(live.replace);
  });

  test('a Task block may grow to one line per nesting level', () => {
    const box = rebasedNamed('nested-subagent-ui-compact-box-grows');
    expect(box.replace).toContain(`{minHeight:2,maxHeight:${TASK_BOX_MAX_ROWS},overflow:"hidden",`);
    expect(patchedText).not.toContain(box.find);
    expect(patchedText).toContain(box.replace);
  });
});
