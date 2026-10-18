import { afterEach, describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { sessionRosterPatches } from '../session-roster-patches.ts';
import { describeStrayNames } from './payload.ts';
import { entry, listing, nodesOf, storeOf, world } from './session-roster-harness.ts';
import type { Described, World } from './session-roster-harness.ts';
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

function childOf(
  sessionId: string,
  parentSessionId: string,
  extra: Partial<Described> = {},
): Described {
  return { ...entry(sessionId, sessionId.length), parentSessionId, ...extra };
}

function nestedPair(): Described[] {
  return [
    { ...entry('child', 1), parentSessionId: 'lead' },
    { ...entry('grandchild', 2), parentSessionId: 'child' },
  ];
}

function ids(list: readonly Described[]): string[] {
  return list.map((item) => item.sessionId);
}

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

describe('the roster lists every descendant, each under its real parent', () => {
  test('a child and a grandchild come with their parents', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('child', 1)]);
    lookup.children.set('child', [entry('grandchild', 2)]);
    expect(lookup.rosterOf('root')).toMatchObject([
      { sessionId: 'child', parentSessionId: 'root' },
      { sessionId: 'grandchild', parentSessionId: 'child' },
    ]);
  });

  test('there is no depth limit', () => {
    const lookup = fresh();
    const chain = ['root', 'a', 'b', 'c', 'd', 'e'];
    for (const [index, parent] of chain.entries()) {
      const child = chain[index + 1];
      if (child !== undefined) {
        lookup.children.set(parent, [entry(child, index)]);
      }
    }
    expect(ids(lookup.rosterOf('root'))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('siblings keep their order and each brings its own children', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('one', 1), entry('two', 2)]);
    lookup.children.set('one', [entry('one-a', 3)]);
    lookup.children.set('two', [entry('two-a', 4)]);
    expect(ids(lookup.rosterOf('root'))).toEqual(['one', 'one-a', 'two', 'two-a']);
  });

  test('a grandchild carries its own model', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('child')]);
    lookup.children.set('child', [entry('grandchild')]);
    lookup.stores.set('child', storeOf(OPUS, 'high'));
    lookup.writeSettings('grandchild', JSON.stringify({ model: HAIKU, reasoningEffort: 'low' }));
    expect(lookup.rosterOf('root')).toMatchObject([
      { sessionId: 'child', model: OPUS, reasoningEffort: 'high' },
      { sessionId: 'grandchild', model: HAIKU, reasoningEffort: 'low' },
    ]);
  });

  test('a cycle back to an ancestor stops there', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('child')]);
    lookup.children.set('child', [entry('grandchild')]);
    lookup.children.set('grandchild', [entry('child'), entry('root')]);
    expect(ids(lookup.rosterOf('root'))).toEqual(['child', 'grandchild']);
  });

  test('a session listed under two parents appears once', () => {
    const lookup = fresh();
    lookup.children.set('root', [entry('one'), entry('two')]);
    lookup.children.set('one', [entry('shared')]);
    lookup.children.set('two', [entry('shared')]);
    expect(ids(lookup.rosterOf('root'))).toEqual(['one', 'shared', 'two']);
  });

  test('no children is an empty roster', () => {
    expect(fresh().rosterOf('root')).toEqual([]);
  });
});

describe('the roster nodes keep the parent, the model and the nesting mark', () => {
  test('a grandchild nests under its child', () => {
    const [top, ...others] = nodesOf([childOf('child', 'lead'), childOf('grandchild', 'child')]);
    expect(others).toEqual([]);
    expect(top?.droid.sessionId).toBe('child');
    expect(top?.children.map((node) => node.droid.sessionId)).toEqual(['grandchild']);
  });

  test('a node carries its model and effort', () => {
    const [top] = nodesOf([
      childOf('child', 'lead', { model: OPUS, reasoningEffort: 'high' }),
      childOf('grandchild', 'child', { model: HAIKU }),
    ]);
    expect(top?.droid).toMatchObject({ model: OPUS, reasoningEffort: 'high' });
    expect(top?.children[0]?.droid).toMatchObject({ model: HAIKU });
    expect(top?.children[0]?.droid.reasoningEffort).toBeUndefined();
  });

  test('a direct child of the lead has no parent node, so it stays at the top', () => {
    const nodes = nodesOf([childOf('child', 'lead')]);
    expect(nodes.map((node) => node.droid.sessionId)).toEqual(['child']);
    expect(nodes[0]?.droid.parentSessionId).toBeNull();
  });

  test('three levels nest, deepest last', () => {
    const [top] = nodesOf([childOf('a', 'lead'), childOf('bb', 'a'), childOf('ccc', 'bb')]);
    expect(top?.children[0]?.children[0]?.droid.sessionId).toBe('ccc');
  });

  test('a cycle among the entries yields each session once', () => {
    const nodes = nodesOf([childOf('a', 'lead'), childOf('bb', 'ccc'), childOf('ccc', 'bb')]);
    const seen = new Set<string>();
    const walk = (list: typeof nodes): void => {
      for (const node of list) {
        expect(seen.has(node.droid.sessionId)).toBe(false);
        seen.add(node.droid.sessionId);
        walk(node.children);
      }
    };
    walk(nodes);
    expect([...seen]).toEqual(['a']);
  });

  test('an entry without the roster fields stays unparented and unmarked, as for a mission', () => {
    const [node] = nodesOf([{ ...entry('agent', 1) }]);
    expect(node?.droid.parentSessionId).toBeNull();
    expect(node?.droid.nestedRoster).toBe(false);
  });

  test('a working grandchild makes its top-level ancestor count as working', () => {
    const [top] = nodesOf([
      childOf('child', 'lead', { status: 'idle' }),
      childOf('grandchild', 'child', { status: 'running' }),
    ]);
    expect(top?.droid.workingState).toBe('idle');
    expect(top?.group).toBe('working');
  });
});

describe('a node with children is expanded by default', () => {
  test('the child and the grandchild are both listed, the grandchild indented', () => {
    const rows = listing(nodesOf(nestedPair())).rows();
    expect(rows).toMatchObject([
      { sessionId: 'child', depth: 0, expanded: true },
      { sessionId: 'grandchild', depth: 1, parent: 'child' },
    ]);
  });

  test('every level of a deep chain is open', () => {
    const rows = listing(
      nodesOf([
        { ...entry('a', 1), parentSessionId: 'lead' },
        { ...entry('bb', 2), parentSessionId: 'a' },
        { ...entry('ccc', 3), parentSessionId: 'bb' },
      ]),
    ).rows();
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
  });

  test('a node without children is not marked expanded', () => {
    const rows = listing(nodesOf([{ ...entry('solo', 1), parentSessionId: 'lead' }])).rows();
    expect(rows).toMatchObject([{ sessionId: 'solo', expanded: false }]);
  });

  test('collapsing hides the children, expanding shows them again', () => {
    const view = listing(nodesOf(nestedPair()));
    view.collapse('child');
    expect(view.rows().map((row) => row.sessionId)).toEqual(['child']);
    view.expand('child');
    expect(view.rows().map((row) => row.sessionId)).toEqual(['child', 'grandchild']);
  });

  test('a collapse survives later renders', () => {
    const view = listing(nodesOf(nestedPair()));
    view.collapse('child');
    expect(view.rows()).toHaveLength(1);
    expect(view.rows()).toHaveLength(1);
  });

  test('collapsing one node leaves the others open', () => {
    const view = listing(
      nodesOf([
        { ...entry('one', 1), parentSessionId: 'lead' },
        { ...entry('two', 2), parentSessionId: 'lead' },
        { ...entry('one-a', 3), parentSessionId: 'one' },
        { ...entry('two-a', 4), parentSessionId: 'two' },
      ]),
    );
    view.collapse('one');
    expect(view.rows().map((row) => row.sessionId)).toEqual(['one', 'two', 'two-a']);
  });

  test('a mission agent with children keeps stock behaviour: closed until expanded', () => {
    const view = listing(
      nodesOf([
        { ...entry('lead-agent', 1) },
        { ...entry('sub', 2), parentSessionId: 'lead-agent' },
      ]),
    );
    expect(view.rows().map((row) => row.sessionId)).toEqual(['lead-agent']);
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
