import { describe, expect, test } from 'bun:test';

import {
  DRAWS_NOTHING,
  HOOKS_SHOW,
  RUN_CALLS,
  RUN_UNIT,
  STACK,
  TABLES,
} from '../stacked-view-patches.ts';
import { payloadFunction } from './payload.ts';

interface Hook {
  id: string;
  hookStatus: 'executing' | 'completed';
  quiet: boolean;
}

interface Hooks {
  before: Hook[];
  after: Hook[];
}

interface Call {
  id: string;
  toolName: string;
  status: string;
  hidden?: boolean;
}

interface ItemUnit {
  kind: 'item';
  item: Call;
  sourceIds: string[];
  associatedHooks?: Hooks;
}

interface GroupUnit {
  kind: 'collapsed-group';
  sourceIds: string[];
  group: { tools: Call[]; associatedHooks?: Hooks; $ODstack?: boolean };
}

type Unit = ItemUnit | GroupUnit;

interface DrawOptions {
  associatedHooks?: Hooks;
}

const OPTIONS = { open: false, showThinking: false, awaiting: () => false };

function stackWith(showHookOutput: boolean): (units: Unit[]) => Unit[] {
  const stack = payloadFunction<
    [
      () => boolean,
      (...args: [Call, number, undefined, boolean, DrawOptions]) => object | null,
      () => { getShowHookOutput: () => boolean },
      (hooks: Hooks) => boolean,
      (list: Hook[]) => boolean,
    ],
    (units: Unit[], options: typeof OPTIONS) => Unit[]
  >(
    ['va', 'iD', 'f', 'uD', 'cw'],
    `${TABLES}${HOOKS_SHOW}${RUN_CALLS}${DRAWS_NOTHING}${RUN_UNIT}${STACK}return $ODstack`,
  )(
    () => true,
    (...args) => (args[0].hidden === true && args[4].associatedHooks === undefined ? null : {}),
    () => ({ getShowHookOutput: () => showHookOutput }),
    (hooks) => [...hooks.before, ...hooks.after].some((entry) => entry.hookStatus === 'executing'),
    (list) =>
      list.length > 0 && list.every((entry) => entry.hookStatus === 'completed' && entry.quiet),
  );
  return (units) => stack(units, OPTIONS);
}

const shown = stackWith(true);

function hook(id: string, state: 'failed' | 'quiet' | 'executing'): Hook {
  return {
    id,
    hookStatus: state === 'executing' ? 'executing' : 'completed',
    quiet: state === 'quiet',
  };
}

function read(id: string, after: Hook[] = [], extra: Partial<Call> = {}): ItemUnit {
  return {
    kind: 'item',
    item: { id, toolName: 'Read', status: 'completed', ...extra },
    sourceIds: [id, ...after.map((entry) => entry.id)],
    ...(after.length > 0 && { associatedHooks: { before: [], after } }),
  };
}

function labels(units: Unit[]): string[] {
  return units.map((unit) =>
    unit.kind === 'collapsed-group' && unit.group.$ODstack === true
      ? `run:${unit.group.tools.map((tool) => tool.id).join(',')}`
      : unit.sourceIds.join(','),
  );
}

describe('hooks on a folded call', () => {
  test('a call whose hook prints stays drawn as stock and closes the run', () => {
    const out = shown([read('r1'), read('r2', [hook('h2', 'failed')]), read('r3')]);
    expect(labels(out)).toEqual(['run:r1', 'r2,h2', 'run:r3']);
  });

  test('a quiet hook still folds', () => {
    expect(labels(shown([read('r1'), read('r2', [hook('h2', 'quiet')])]))).toEqual(['run:r1,r2']);
  });

  test('a hook still running folds until it settles', () => {
    expect(labels(shown([read('r1'), read('r2', [hook('h2', 'executing')])]))).toEqual([
      'run:r1,r2',
    ]);
  });

  test('with Show hook output off every hook folds', () => {
    const hidden = stackWith(false);
    expect(labels(hidden([read('r1'), read('r2', [hook('h2', 'failed')])]))).toEqual(['run:r1,r2']);
  });

  test('a stock group whose hooks print stays a group and closes the run', () => {
    const group: GroupUnit = {
      kind: 'collapsed-group',
      sourceIds: ['g1', 'g2', 'h'],
      group: {
        tools: ['g1', 'g2'].map((id) => ({ id, toolName: 'Grep', status: 'completed' })),
        associatedHooks: { before: [hook('h', 'failed')], after: [] },
      },
    };
    expect(labels(shown([read('r1'), group, read('r2')]))).toEqual(['run:r1', 'g1,g2,h', 'run:r2']);
  });

  test('a hidden call with a printing hook draws its hook and closes the run', () => {
    const out = shown([
      read('r1'),
      read('u1', [hook('h1', 'failed')], { hidden: true }),
      read('r2'),
    ]);
    expect(labels(out)).toEqual(['run:r1', 'u1,h1', 'run:r2']);
  });

  test('a hidden call with a quiet hook passes through and leaves the run open', () => {
    const out = shown([
      read('r1'),
      read('u1', [hook('h1', 'quiet')], { hidden: true }),
      read('r2'),
    ]);
    expect(labels(out)).toEqual(['run:r1,r2', 'u1,h1']);
  });
});
