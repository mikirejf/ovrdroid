import { fieldsOf, isObject } from './fields.ts';
import type { Fields } from './fields.ts';

const PREFIX_CHARS = 40;
const STRING_GROUP = 'string';
const STRING_TYPES: ReadonlySet<string> = new Set([
  'string',
  'concatenated string',
  'sliced string',
]);

export interface Layout {
  stride: number;
  type: number;
  name: number;
  size: number;
  edgeCount: number;
  edgeStride: number;
  edgeType: number;
  edgeName: number;
  edgeTo: number;
}

export interface Snapshot {
  layout: Layout;
  nodes: readonly number[];
  edges: readonly number[];
  strings: readonly string[];
  nodeTypes: readonly string[];
  edgeTypes: readonly string[];
}

export interface Tally {
  count: number;
  size: number;
}

export interface Summary {
  nodes: number;
  size: number;
  groups: Map<string, Tally>;
  strings: Map<string, Tally>;
  prefixes: Map<string, Tally>;
}

function isNumbers(value: unknown): value is number[] {
  return Array.isArray(value) && (value.length === 0 || typeof value[0] === 'number');
}

function namesAt(fields: Fields, name: string): string[] {
  const value = fields.get(name);
  if (!Array.isArray(value)) {
    throw new TypeError(`not a V8 heap snapshot: ${name} is missing`);
  }
  return value.map(String);
}

function numbersAt(fields: Fields, name: string): number[] {
  const value = fields.get(name);
  if (!isNumbers(value)) {
    throw new TypeError(`not a V8 heap snapshot: ${name} is missing`);
  }
  return value;
}

function fieldAt(names: readonly string[], name: string): number {
  const at = names.indexOf(name);
  if (at === -1) {
    throw new Error(`not a V8 heap snapshot: meta has no ${name} field`);
  }
  return at;
}

function typeNamesAt(fields: Fields, name: string): string[] {
  const value = fields.get(name);
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  if (!Array.isArray(first)) {
    throw new TypeError(`not a V8 heap snapshot: meta.${name} has no type list`);
  }
  return first.map(String);
}

export function parseSnapshot(text: string): Snapshot {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) {
    throw new Error('not a V8 heap snapshot: the file is not a JSON object');
  }
  const root = fieldsOf(parsed);
  const meta = fieldsOf(fieldsOf(root.get('snapshot')).get('meta'));
  const nodeFields = namesAt(meta, 'node_fields');
  const edgeFields = namesAt(meta, 'edge_fields');
  const layout: Layout = {
    stride: nodeFields.length,
    type: fieldAt(nodeFields, 'type'),
    name: fieldAt(nodeFields, 'name'),
    size: fieldAt(nodeFields, 'self_size'),
    edgeCount: fieldAt(nodeFields, 'edge_count'),
    edgeStride: edgeFields.length,
    edgeType: fieldAt(edgeFields, 'type'),
    edgeName: fieldAt(edgeFields, 'name_or_index'),
    edgeTo: fieldAt(edgeFields, 'to_node'),
  };
  const nodes = numbersAt(root, 'nodes');
  const edges = numbersAt(root, 'edges');
  if (nodes.length % layout.stride !== 0 || edges.length % layout.edgeStride !== 0) {
    throw new Error('not a V8 heap snapshot: nodes or edges do not fill whole records');
  }
  return {
    layout,
    nodes,
    edges,
    strings: namesAt(root, 'strings'),
    nodeTypes: typeNamesAt(meta, 'node_types'),
    edgeTypes: typeNamesAt(meta, 'edge_types'),
  };
}

export function nodeCount(snapshot: Snapshot): number {
  return snapshot.nodes.length / snapshot.layout.stride;
}

export function nodeTypeOf(snapshot: Snapshot, node: number): string {
  const { stride, type } = snapshot.layout;
  return snapshot.nodeTypes[snapshot.nodes[node * stride + type] ?? -1] ?? '';
}

export function nodeNameOf(snapshot: Snapshot, node: number): string {
  const { stride, name } = snapshot.layout;
  return snapshot.strings[snapshot.nodes[node * stride + name] ?? -1] ?? '';
}

export function nodeSizeOf(snapshot: Snapshot, node: number): number {
  const { stride, size } = snapshot.layout;
  return snapshot.nodes[node * stride + size] ?? 0;
}

export function isStringNode(snapshot: Snapshot, node: number): boolean {
  return STRING_TYPES.has(nodeTypeOf(snapshot, node));
}

export function groupOf(snapshot: Snapshot, node: number): string {
  return isStringNode(snapshot, node)
    ? STRING_GROUP
    : `${nodeTypeOf(snapshot, node)} ${nodeNameOf(snapshot, node)}`;
}

function tallyInto(map: Map<string, Tally>, key: string, size: number): void {
  const tally = map.get(key);
  if (tally === undefined) {
    map.set(key, { count: 1, size });
    return;
  }
  tally.count += 1;
  tally.size += size;
}

export function summarise(snapshot: Snapshot): Summary {
  const summary: Summary = {
    nodes: nodeCount(snapshot),
    size: 0,
    groups: new Map(),
    strings: new Map(),
    prefixes: new Map(),
  };
  for (let node = 0; node < summary.nodes; node += 1) {
    const size = nodeSizeOf(snapshot, node);
    summary.size += size;
    tallyInto(summary.groups, groupOf(snapshot, node), size);
    if (isStringNode(snapshot, node)) {
      const content = nodeNameOf(snapshot, node);
      tallyInto(summary.strings, content, size);
      tallyInto(summary.prefixes, content.slice(0, PREFIX_CHARS), size);
    }
  }
  return summary;
}
