import { describe, expect, test } from 'bun:test';

import {
  IS_TASK_STEP,
  NEST_UI_DEPTH,
  NESTS,
  nestedSubagentUiPatches,
  PATCHED_RUNNING_COUNT,
  TASK_BOX_MAX_ROWS,
  TASK_NAME,
} from '../nested-subagent-ui-patches.ts';
import { applies } from '../rebase.ts';
import type { PanelTask } from './panel-list.ts';
import { panelUnder } from './panel-list.ts';
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

interface Session {
  parent?: string;
  running: boolean;
}

interface Invocation {
  childSessionId: string;
  parentSessionId: string;
  taskInvocationId: string;
  status: string;
}

interface World {
  sessions: Record<string, Session>;
  ledger?: Invocation[];
}

interface Store {
  id: string;
  getDecompSessionType: () => null;
}

function storeOf(id: string): Store {
  return { id, getDecompSessionType: () => null };
}

function runningUnder(world: World, root: string): number {
  const ledger = world.ledger ?? [];
  const ssm = {
    getAllSessionIds: () => Object.keys(world.sessions),
    getSessionManager: (id: string) => ({ getStore: () => storeOf(id) }),
    getSubagentInvocationSummary: () => null,
  };
  const count = payloadFunction<unknown[], (manager: typeof ssm, root: string) => number>(
    ['Jt', 'Gt', 'Ol', 'hn', 'Ri'],
    `${PATCHED_RUNNING_COUNT};return aRe`,
  )(
    (_store: Store, id: string) => world.sessions[id]?.parent,
    (_store: Store, id: string) => ({
      status: world.sessions[id]?.running === true ? 'running' : 'completed',
    }),
    (parent: string) =>
      ledger.filter((entry) => entry.parentSessionId === parent && entry.status === 'running'),
    (child: string) => ledger.find((entry) => entry.childSessionId === child),
    (status: string) => status === 'running' || status === 'pending',
  );
  return count(ssm, root);
}

describe('the running-subagent counter counts every descendant once', () => {
  test('direct children only, as stock counted them', () => {
    const world: World = {
      sessions: {
        main: { running: true },
        a: { parent: 'main', running: true },
        b: { parent: 'main', running: false },
      },
    };
    expect(runningUnder(world, 'main')).toBe(1);
  });

  test('grandchildren and great-grandchildren count too', () => {
    const world: World = {
      sessions: {
        main: { running: true },
        coder: { parent: 'main', running: true },
        grunt: { parent: 'coder', running: true },
        deep: { parent: 'grunt', running: true },
        other: { parent: 'unrelated', running: true },
      },
    };
    expect(runningUnder(world, 'main')).toBe(3);
  });

  test('a finished child still leads to its running children', () => {
    const world: World = {
      sessions: {
        main: { running: true },
        coder: { parent: 'main', running: false },
        grunt: { parent: 'coder', running: true },
      },
    };
    expect(runningUnder(world, 'main')).toBe(1);
  });

  test('a grandchild known only to the ledger counts once', () => {
    const world: World = {
      sessions: { main: { running: true }, coder: { parent: 'main', running: true } },
      ledger: [
        {
          childSessionId: 'grunt',
          parentSessionId: 'coder',
          taskInvocationId: 'i1',
          status: 'running',
        },
        {
          childSessionId: 'coder',
          parentSessionId: 'main',
          taskInvocationId: 'i0',
          status: 'running',
        },
      ],
    };
    expect(runningUnder(world, 'main')).toBe(2);
  });

  test('a lineage cycle ends instead of looping', () => {
    const world: World = {
      sessions: {
        main: { parent: 'loop', running: true },
        loop: { parent: 'main', running: true },
      },
    };
    expect(runningUnder(world, 'main')).toBe(1);
  });

  test('a subagent counts the subagents under itself, not its siblings', () => {
    const world: World = {
      sessions: {
        main: { running: true },
        coder: { parent: 'main', running: true },
        sibling: { parent: 'main', running: true },
        grunt: { parent: 'coder', running: true },
      },
    };
    expect(runningUnder(world, 'coder')).toBe(1);
  });
});

function task(taskId: string, parentSessionId: string, status = 'running'): PanelTask {
  return { taskId, parentSessionId, status };
}

describe('the sub-agent panel lists every running descendant as a tree', () => {
  test('a nested subagent sits under its parent, one level in', () => {
    const tasks = [task('lead', 'main'), task('sleeper', 'lead'), task('other', 'main')];
    expect(panelUnder(tasks, 'main')).toEqual(['lead', '  sleeper', 'other']);
  });

  test('three levels deep', () => {
    const tasks = [task('a', 'main'), task('b', 'a'), task('c', 'b')];
    expect(panelUnder(tasks, 'main')).toEqual(['a', '  b', '    c']);
  });

  test('a finished parent drops out and its running child moves up a level', () => {
    const tasks = [task('lead', 'main', 'completed'), task('sleeper', 'lead')];
    expect(panelUnder(tasks, 'main')).toEqual(['sleeper']);
  });

  test('sessions outside the current tree are left out', () => {
    const tasks = [task('lead', 'main'), task('stray', 'elsewhere')];
    expect(panelUnder(tasks, 'main')).toEqual(['lead']);
  });

  test('a lineage cycle lists each session once', () => {
    const tasks = [task('a', 'main'), task('b', 'a'), task('a', 'b')];
    expect(panelUnder(tasks, 'main')).toEqual(['a', '  b']);
  });
});

const { patchedText, rebasedNamed } = shipped(nestedSubagentUiPatches);

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  test.each(nestedSubagentUiPatches.map((patch) => [patch.name] as const))('%s applies', (name) => {
    expect(applies(rebasedNamed(name))).toBe(true);
  });

  test('Task progress updates carry their tool use id', () => {
    expect(patchedText).toContain('type:"tool_call",toolName:a.name,toolUseId:a.id,');
    expect(patchedText).toContain('toolUseId:a.toolUseId,');
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
