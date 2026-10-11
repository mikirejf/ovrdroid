import { describe, expect, test } from 'bun:test';

import { formatRetainer, retainersOf } from '../heap-retainers.ts';
import {
  formatGrowth,
  formatNewStrings,
  formatTotals,
  growthOf,
  newStrings,
  shown,
} from '../heapdiff.ts';
import { parseSnapshot, summarise } from '../heapsnapshot.ts';

function fail(): never {
  throw new Error('expected a retainer');
}

const NODE_TYPES = ['hidden', 'array', 'string', 'object', 'closure', 'synthetic'];
const EDGE_TYPES = ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak'];
const NODE_STRIDE = 7;

interface TestEdge {
  type: string;
  name: string | number;
  to: number;
}

interface TestNode {
  type: string;
  name: string;
  size?: number;
  edges?: TestEdge[];
}

function snapshotText(graph: readonly TestNode[]): string {
  const strings: string[] = [];
  const stringId = (text: string): number => {
    const known = strings.indexOf(text);
    if (known !== -1) {
      return known;
    }
    strings.push(text);
    return strings.length - 1;
  };
  const nodes: number[] = [];
  const edges: number[] = [];
  for (const [index, node] of graph.entries()) {
    const own = node.edges ?? [];
    nodes.push(
      NODE_TYPES.indexOf(node.type),
      stringId(node.name),
      index,
      node.size ?? 0,
      own.length,
      0,
      0,
    );
    for (const edge of own) {
      const name = typeof edge.name === 'number' ? edge.name : stringId(edge.name);
      edges.push(EDGE_TYPES.indexOf(edge.type), name, edge.to * NODE_STRIDE);
    }
  }
  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: [
          'type',
          'name',
          'id',
          'self_size',
          'edge_count',
          'trace_node_id',
          'detachedness',
        ],
        node_types: [NODE_TYPES, 'string', 'number', 'number', 'number', 'number', 'number'],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [EDGE_TYPES, 'string_or_number', 'node'],
      },
    },
    nodes,
    edges,
    strings,
  });
}

const root: TestNode = {
  type: 'synthetic',
  name: '(GC roots)',
  edges: [{ type: 'property', name: 'cache', to: 1 }],
};

const cache: TestNode = {
  type: 'object',
  name: 'Cache',
  size: 16,
  edges: [
    { type: 'element', name: 0, to: 2 },
    { type: 'element', name: 1, to: 3 },
    { type: 'weak', name: 'ghost', to: 4 },
  ],
};

const before = parseSnapshot(
  snapshotText([
    root,
    cache,
    { type: 'object', name: 'Entry', size: 100 },
    { type: 'string', name: 'transcript: hello', size: 40 },
    { type: 'object', name: 'Ghost', size: 7 },
    { type: 'object', name: 'Orphan', size: 9 },
  ]),
);

const after = parseSnapshot(
  snapshotText([
    root,
    {
      ...cache,
      edges: [
        { type: 'element', name: 0, to: 2 },
        { type: 'element', name: 1, to: 3 },
        { type: 'element', name: 2, to: 6 },
        { type: 'weak', name: 'ghost', to: 4 },
      ],
    },
    { type: 'object', name: 'Entry', size: 100 },
    { type: 'string', name: 'transcript: hello', size: 40 },
    { type: 'object', name: 'Ghost', size: 7 },
    { type: 'object', name: 'Orphan', size: 9 },
    {
      type: 'object',
      name: 'Entry',
      size: 100,
      edges: [{ type: 'property', name: 'text', to: 7 }],
    },
    { type: 'string', name: 'transcript: a much longer reply', size: 120 },
  ]),
);

describe('parseSnapshot', () => {
  test('reads the layout from the meta', () => {
    expect(before.layout.stride).toBe(NODE_STRIDE);
    expect(before.layout.edgeTo).toBe(2);
    expect(before.strings).toContain('Cache');
  });

  test('refuses text that is not a heap snapshot', () => {
    expect(() => parseSnapshot('[]')).toThrow('not a V8 heap snapshot');
    expect(() => parseSnapshot('{"snapshot":{"meta":{}}}')).toThrow('node_fields');
  });
});

describe('summarise', () => {
  test('counts nodes and self size', () => {
    const summary = summarise(after);
    expect(summary.nodes).toBe(8);
    expect(summary.size).toBe(16 + 100 + 40 + 7 + 9 + 100 + 120);
  });

  test('groups objects by constructor name and strings together', () => {
    const { groups } = summarise(after);
    expect(groups.get('object Entry')).toEqual({ count: 2, size: 200 });
    expect(groups.get('string')).toEqual({ count: 2, size: 160 });
  });

  test('tallies strings by content and by their first 40 characters', () => {
    const { strings, prefixes } = summarise(after);
    expect(strings.get('transcript: hello')).toEqual({ count: 1, size: 40 });
    expect(prefixes.get('transcript: a much longer reply')?.size).toBe(120);
  });
});

describe('growth', () => {
  const was = summarise(before);
  const now = summarise(after);

  test('ranks groups by self size growth and skips ones that did not grow', () => {
    const growth = growthOf(was.groups, now.groups, 10);
    expect(growth.map((entry) => entry.key)).toEqual(['string', 'object Entry']);
    expect(growth[1]).toEqual({
      key: 'object Entry',
      countBefore: 1,
      countAfter: 2,
      sizeDelta: 100,
    });
  });

  test('cuts the list at the limit', () => {
    expect(growthOf(was.groups, now.groups, 1)).toHaveLength(1);
  });

  test('lists only strings whose content is new', () => {
    expect(newStrings(was, now, 5)).toEqual([
      { content: 'transcript: a much longer reply', count: 1, size: 120 },
    ]);
  });

  test('formats totals, growth and strings in words', () => {
    expect(formatTotals(was, now)).toContain('nodes      6 -> 8  (+2)');
    expect(formatGrowth(growthOf(was.groups, now.groups, 10))).toContain('+120 bytes');
    expect(formatGrowth([])).toContain('nothing grew');
    expect(formatNewStrings(newStrings(was, now, 5))).toContain(
      '"transcript: a much longer reply"',
    );
    expect(formatNewStrings([])).toContain('no string exists only after');
  });

  test('escapes and truncates shown text', () => {
    expect(shown('a\nb')).toBe('a\\nb');
    expect(shown('x'.repeat(10), 4)).toBe('xxxx...');
  });
});

describe('retainersOf', () => {
  test('finds the shortest route from a root and the route that gained nodes', () => {
    const [entry] = retainersOf(before, after, ['object Entry']);
    expect(entry?.countBefore).toBe(1);
    expect(entry?.countAfter).toBe(2);
    expect(entry?.path?.map((step) => step.node)).toEqual([
      'synthetic (GC roots)',
      'object Cache',
      'object Entry',
    ]);
    expect(entry?.path?.map((step) => step.edge)).toEqual(['', '.cache', '[0]']);
  });

  test('picks the route that gained the most nodes, not the shortest', () => {
    const graph: TestNode[] = [
      {
        ...root,
        edges: [
          { type: 'property', name: 'old', to: 1 },
          { type: 'property', name: 'leak', to: 2 },
        ],
      },
      { type: 'object', name: 'Item', edges: [] },
      { type: 'object', name: 'Bag', edges: [{ type: 'element', name: 0, to: 3 }] },
      { type: 'object', name: 'Item', edges: [] },
    ];
    const grown: TestNode[] = [
      ...graph.slice(0, 2),
      {
        type: 'object',
        name: 'Bag',
        edges: [
          { type: 'element', name: 0, to: 3 },
          { type: 'element', name: 1, to: 4 },
        ],
      },
      { type: 'object', name: 'Item', edges: [] },
      { type: 'object', name: 'Item', edges: [] },
    ];
    const [item] = retainersOf(
      parseSnapshot(snapshotText(graph)),
      parseSnapshot(snapshotText(grown)),
      ['object Item'],
    );
    expect(item?.path?.map((step) => step.edge).slice(1, 3)).toEqual(['.leak', '[0]']);
    expect([item?.countBefore, item?.countAfter]).toEqual([1, 2]);
  });

  test('reports a node that only a weak edge or nothing holds as having no path', () => {
    const found = retainersOf(before, after, ['object Ghost', 'object Orphan']);
    expect(found.map((entry) => entry.path)).toEqual([undefined, undefined]);
    expect(formatRetainer(found[0] ?? fail())).toContain('no path from a GC root');
  });

  test('keeps the first and last steps of a long route', () => {
    const chain: TestNode[] = [root];
    for (let link = 1; link <= 20; link += 1) {
      chain.push({
        type: 'object',
        name: `Link${link}`,
        edges: link < 20 ? [{ type: 'property', name: 'next', to: link + 1 }] : [],
      });
    }
    chain[0] = { ...root, edges: [{ type: 'property', name: 'cache', to: 1 }] };
    const deep = parseSnapshot(snapshotText(chain));
    const [link] = retainersOf(deep, deep, ['object Link20']);
    const text = formatRetainer(link ?? fail());
    expect(text).toContain('synthetic (GC roots)');
    expect(text).toContain('more steps');
    expect(text).toContain('.next -> object Link20');
    expect(text).not.toContain('Link10');
  });
});
