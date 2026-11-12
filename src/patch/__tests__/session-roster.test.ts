import { afterEach, describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { sessionRosterPatches } from '../session-roster-patches.ts';
import { describeStrayNames } from './payload.ts';
import { entry, rowsOf, storeOf, world } from './session-roster-harness.ts';
import type { World } from './session-roster-harness.ts';
import { shipped, stockDroid } from './stock-scanner.ts';

describeStrayNames(sessionRosterPatches);

const OPUS = 'custom:droidproxy:opus-5-5';
const HAIKU = 'custom:droidproxy:haiku-5-5';

let open: World | undefined;

function fresh(): World {
  open = world();
  return open;
}

afterEach(() => {
  open?.dispose();
  open = undefined;
});

describe('a roster entry carries the model and effort of its session', () => {
  test('a loaded session reports both', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('child')]);
    lookup.stores.set('child', storeOf(OPUS, 'high'));
    expect(lookup.rosterOf('root')).toMatchObject([
      { sessionId: 'child', model: OPUS, reasoningEffort: 'high' },
    ]);
  });

  test('a model without an effort reports the model alone', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('child')]);
    lookup.stores.set('child', storeOf(OPUS));
    const [described] = lookup.rosterOf('root');
    expect(described?.model).toBe(OPUS);
    expect(described?.reasoningEffort).toBeUndefined();
  });

  test('an unloaded session reads the model and effort from its settings file', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('child')]);
    lookup.writeSettings('child', JSON.stringify({ model: HAIKU, reasoningEffort: 'medium' }));
    expect(lookup.rosterOf('root')).toMatchObject([
      { sessionId: 'child', model: HAIKU, reasoningEffort: 'medium' },
    ]);
  });

  test('a loaded store with no model gives way to the settings file', () => {
    const lookup = fresh();
    lookup.stores.set('child', storeOf());
    lookup.writeSettings('child', JSON.stringify({ model: HAIKU }));
    expect(lookup.modelOf('child')).toEqual({ model: HAIKU });
  });

  test('a loaded store wins over the settings file', () => {
    const lookup = fresh();
    lookup.stores.set('child', storeOf(OPUS, 'low'));
    lookup.writeSettings('child', JSON.stringify({ model: HAIKU, reasoningEffort: 'high' }));
    expect(lookup.modelOf('child')).toEqual({ model: OPUS, reasoningEffort: 'low' });
  });

  test('a session with no store and no file reports neither', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('child')]);
    const [described] = lookup.rosterOf('root');
    expect(described?.model).toBeUndefined();
    expect(described?.reasoningEffort).toBeUndefined();
  });

  test('a broken file reports neither and does not throw', () => {
    const lookup = fresh();
    lookup.writeSettings('child', '{not json');
    expect(lookup.modelOf('child')).toEqual({});
  });

  test('a file with no model reports neither', () => {
    const lookup = fresh();
    lookup.writeSettings('child', JSON.stringify({ reasoningEffort: 'high' }));
    expect(lookup.modelOf('child')).toEqual({});
  });

  test('a file that appears later is picked up, since a miss is not cached', () => {
    const lookup = fresh();
    expect(lookup.modelOf('child')).toEqual({});
    lookup.writeSettings('child', JSON.stringify({ model: HAIKU }));
    expect(lookup.modelOf('child').model).toBe(HAIKU);
  });

  test('a hit is read once per session', () => {
    const lookup = fresh();
    lookup.writeSettings('child', JSON.stringify({ model: HAIKU }));
    expect(lookup.modelOf('child').model).toBe(HAIKU);
    lookup.removeSettings('child');
    expect(lookup.modelOf('child').model).toBe(HAIKU);
  });

  test('a store that changes model is read live', () => {
    const lookup = fresh();
    lookup.stores.set('child', storeOf(OPUS, 'low'));
    expect(lookup.modelOf('child').reasoningEffort).toBe('low');
    lookup.stores.set('child', storeOf(OPUS, 'high'));
    expect(lookup.modelOf('child').reasoningEffort).toBe('high');
  });
});

describe('the roster enriches direct children', () => {
  test('siblings keep their order and each carries its own model and effort', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('one', 1), entry('two', 2)]);
    lookup.stores.set('one', storeOf(OPUS, 'high'));
    lookup.writeSettings('two', JSON.stringify({ model: HAIKU, reasoningEffort: 'low' }));
    expect(lookup.rosterOf('root')).toMatchObject([
      { sessionId: 'one', model: OPUS, reasoningEffort: 'high' },
      { sessionId: 'two', model: HAIKU, reasoningEffort: 'low' },
    ]);
  });

  test('enrichment preserves the stock child fields', () => {
    const lookup = fresh();
    const child = entry('child', 42, 'idle');
    lookup.children.set('root', [child]);
    lookup.stores.set('child', storeOf(OPUS, 'high'));
    expect(lookup.rosterOf('root')).toEqual([{ ...child, model: OPUS, reasoningEffort: 'high' }]);
  });

  test('no children is an empty roster', () => {
    expect(fresh().rosterOf('root')).toEqual([]);
  });
});

describe('the roster rows carry model and effort', () => {
  test('an archived child keeps its model and effort but stays idle', () => {
    const [row] = rowsOf([
      { ...entry('child', 1), model: HAIKU, reasoningEffort: 'low', archived: true },
    ]);
    expect(row).toMatchObject({
      model: HAIKU,
      reasoningEffort: 'low',
      archived: true,
      workingState: 'idle',
    });
  });

  test('each direct child carries its own model and effort', () => {
    const rows = rowsOf([
      { ...entry('one', 1), model: OPUS, reasoningEffort: 'high' },
      { ...entry('two', 2), model: HAIKU },
    ]);
    expect(rows).toMatchObject([
      { sessionId: 'one', model: OPUS, reasoningEffort: 'high' },
      { sessionId: 'two', model: HAIKU },
    ]);
    expect(rows[1]?.reasoningEffort).toBeUndefined();
  });

  test('a child without model settings reports neither', () => {
    const [row] = rowsOf([entry('child')]);
    expect(row?.model).toBeUndefined();
    expect(row?.reasoningEffort).toBeUndefined();
  });
});
describe.skipIf(stockDroid === undefined)('the shipped session roster', () => {
  const { patchedText, rebasedNamed } = shipped(sessionRosterPatches);

  test.each(sessionRosterPatches.map((patch) => [patch.name] as const))(
    '%s lands exactly once',
    (name) => {
      expect(applies(rebasedNamed(name))).toBe(true);
      expect(patchedText.split(rebasedNamed(name).replace)).toHaveLength(2);
    },
  );
});
