import { describe, expect, test } from 'bun:test';

import {
  DRAWS_NOTHING,
  HISTORY_UNITS,
  HOOKS_SHOW,
  RUN_CALLS,
  RUN_UNIT,
  STACK,
  stackedViewPatches,
  TABLES,
} from '../stacked-view-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Item {
  id: string;
  toolName?: string;
  status?: string;
}

interface Unit {
  kind: string;
  item?: Item;
  sourceIds: string[];
  group?: { tools: Item[]; $ODopen?: boolean };
}

function pass(units: Unit[]): Unit[] {
  return units;
}

const pageUnits = payloadFunction<
  [
    (item: Item) => boolean,
    () => object,
    typeof pass,
    typeof pass,
    typeof pass,
    { messages: Unit[] },
    boolean,
    undefined,
    boolean,
    string,
  ],
  Unit[]
>(
  ['va', 'iD', 'gC', 'Tc', '$m', 'g', 'D', 'B', '$ODstacked', 'R'],
  `${TABLES}${HOOKS_SHOW}${RUN_CALLS}${DRAWS_NOTHING}${RUN_UNIT}${STACK}${HISTORY_UNITS}`,
);

function call(id: string, toolName: string): Unit {
  return { kind: 'item', item: { id, toolName, status: 'completed' }, sourceIds: [id] };
}

function page(stacked: boolean): Unit[] {
  const text: Unit = { kind: 'item', item: { id: 'text' }, sourceIds: ['text'] };
  return pageUnits(
    (item) => 'toolName' in item && 'status' in item,
    () => ({}),
    pass,
    pass,
    pass,
    { messages: [call('r1', 'Read'), call('g1', 'Grep'), text] },
    false,
    undefined,
    stacked,
    stacked ? 'stacked' : 'expanded',
  );
}

function labels(units: Unit[]): string[] {
  return units.map((unit) =>
    unit.group === undefined ? unit.sourceIds.join(',') : `run:${unit.group.tools.length}`,
  );
}

describe('the scroll view', () => {
  test('a history page folds its calls into a closed run when the display is stacked', () => {
    const out = page(true);
    expect(labels(out)).toEqual(['run:2', 'text']);
    expect(out[0]?.group?.$ODopen).toBe(false);
  });

  test('a history page keeps every call when the display is not stacked', () => {
    expect(labels(page(false))).toEqual(['r1', 'g1', 'text']);
  });

  test('the scroll view hands each page the stacked display mode', () => {
    expect(patchNamed(stackedViewPatches, 'stacked-view-history-page-prop').replace).toContain(
      '$ODstacked:$ODmode==="stacked"}',
    );
  });
});
