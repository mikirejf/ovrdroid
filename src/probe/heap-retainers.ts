import { shown } from './heapdiff.ts';
import type { Snapshot } from './heapsnapshot.ts';
import { groupOf, isStringNode, nodeCount, nodeNameOf, nodeTypeOf } from './heapsnapshot.ts';

export const MAX_STEPS = 12;
const ROOT_TYPE = 'synthetic';
const WEAK_EDGE = 'weak';
const INDEXED_EDGES: ReadonlySet<string> = new Set(['element', 'hidden']);
const STRING_SHOWN = 40;
const NO_PARENT = -1;

export interface Tree {
  parent: Int32Array;
  edge: Int32Array;
  seen: Uint8Array;
}

export interface Step {
  edge: string;
  node: string;
}

export interface Retainer {
  group: string;
  countBefore: number;
  countAfter: number;
  path: readonly Step[] | undefined;
}

interface Route {
  count: number;
  sample: number;
}

function edgeStarts(snapshot: Snapshot): Uint32Array {
  const { stride, edgeCount } = snapshot.layout;
  const total = nodeCount(snapshot);
  const starts = new Uint32Array(total + 1);
  for (let node = 0; node < total; node += 1) {
    starts[node + 1] = (starts[node] ?? 0) + (snapshot.nodes[node * stride + edgeCount] ?? 0);
  }
  return starts;
}

export function shortestTree(snapshot: Snapshot): Tree {
  const { stride, edgeStride, edgeType, edgeTo } = snapshot.layout;
  const total = nodeCount(snapshot);
  const starts = edgeStarts(snapshot);
  const parent = new Int32Array(total).fill(NO_PARENT);
  const edge = new Int32Array(total).fill(NO_PARENT);
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let tail = 0;
  for (let node = 0; node < total; node += 1) {
    if (nodeTypeOf(snapshot, node) === ROOT_TYPE) {
      seen[node] = 1;
      queue[tail] = node;
      tail += 1;
    }
  }
  for (let head = 0; head < tail; head += 1) {
    const node = queue[head] ?? 0;
    for (let e = starts[node] ?? 0; e < (starts[node + 1] ?? 0); e += 1) {
      const kind = snapshot.edgeTypes[snapshot.edges[e * edgeStride + edgeType] ?? -1];
      const target = (snapshot.edges[e * edgeStride + edgeTo] ?? 0) / stride;
      if (kind !== WEAK_EDGE && seen[target] === 0) {
        seen[target] = 1;
        parent[target] = node;
        edge[target] = e;
        queue[tail] = target;
        tail += 1;
      }
    }
  }
  return { parent, edge, seen };
}

function nodeLabel(snapshot: Snapshot, node: number): string {
  const group = groupOf(snapshot, node);
  return isStringNode(snapshot, node)
    ? `${group} "${shown(nodeNameOf(snapshot, node), STRING_SHOWN)}"`
    : group;
}

function edgeLabel(snapshot: Snapshot, edge: number, indexed: boolean): string {
  const { edgeStride, edgeType, edgeName } = snapshot.layout;
  const kind = snapshot.edgeTypes[snapshot.edges[edge * edgeStride + edgeType] ?? -1] ?? '';
  const name = snapshot.edges[edge * edgeStride + edgeName] ?? 0;
  if (INDEXED_EDGES.has(kind)) {
    return indexed ? `[${name}]` : '[]';
  }
  const text = snapshot.strings[name] ?? '';
  if (kind === 'property') {
    return `.${text}`;
  }
  return text === '' ? `(${kind})` : `${text} (${kind})`;
}

function pathOf(snapshot: Snapshot, tree: Tree, target: number): Step[] {
  const steps: Step[] = [];
  for (let node = target; node !== NO_PARENT; node = tree.parent[node] ?? NO_PARENT) {
    const via = tree.edge[node] ?? NO_PARENT;
    steps.push({
      edge: via === NO_PARENT ? '' : edgeLabel(snapshot, via, true),
      node: nodeLabel(snapshot, node),
    });
  }
  return steps.toReversed();
}

function routesOf(
  snapshot: Snapshot,
  tree: Tree,
  groups: ReadonlySet<string>,
): Map<string, Map<string, Route>> {
  const memo = new Map<number, string>();
  const routeOf = (node: number): string => {
    const pending: number[] = [];
    let at = node;
    let route = memo.get(at);
    while (route === undefined && at !== NO_PARENT) {
      pending.push(at);
      at = tree.parent[at] ?? NO_PARENT;
      route = at === NO_PARENT ? '' : memo.get(at);
    }
    let text = route ?? '';
    for (const step of pending.toReversed()) {
      const via = tree.edge[step] ?? NO_PARENT;
      const edge = via === NO_PARENT ? '' : edgeLabel(snapshot, via, false);
      text = `${text} ${edge} ${groupOf(snapshot, step)}`;
      memo.set(step, text);
    }
    return text;
  };
  const found = new Map<string, Map<string, Route>>();
  for (let node = 0; node < nodeCount(snapshot); node += 1) {
    const group = groupOf(snapshot, node);
    if (groups.has(group) && tree.seen[node] === 1) {
      const routes = found.get(group) ?? new Map<string, Route>();
      const route = routeOf(node);
      const known = routes.get(route);
      if (known === undefined) {
        routes.set(route, { count: 1, sample: node });
      } else {
        known.count += 1;
      }
      found.set(group, routes);
    }
  }
  return found;
}

function biggestGrowth(
  before: ReadonlyMap<string, Route> | undefined,
  after: ReadonlyMap<string, Route> | undefined,
): { route: Route; was: number } | undefined {
  let best: { route: Route; was: number } | undefined;
  let bestDelta = Number.NEGATIVE_INFINITY;
  for (const [key, route] of after ?? []) {
    const was = before?.get(key)?.count ?? 0;
    if (route.count - was > bestDelta) {
      bestDelta = route.count - was;
      best = { route, was };
    }
  }
  return best;
}

export function retainersOf(
  before: Snapshot,
  after: Snapshot,
  groups: readonly string[],
): Retainer[] {
  const wanted = new Set(groups);
  const afterTree = shortestTree(after);
  const afterRoutes = routesOf(after, afterTree, wanted);
  const beforeRoutes = routesOf(before, shortestTree(before), wanted);
  return groups.map((group) => {
    const best = biggestGrowth(beforeRoutes.get(group), afterRoutes.get(group));
    return {
      group,
      countBefore: best?.was ?? 0,
      countAfter: best?.route.count ?? 0,
      path: best === undefined ? undefined : pathOf(after, afterTree, best.route.sample),
    };
  });
}

export function formatRetainer(retainer: Retainer): string {
  const head = `  ${retainer.group}`;
  if (retainer.path === undefined) {
    return `${head}\n    no path from a GC root`;
  }
  const edges = retainer.path.length - 1;
  const half = MAX_STEPS / 2;
  const kept =
    edges > MAX_STEPS
      ? [...retainer.path.slice(0, half + 1), undefined, ...retainer.path.slice(-half)]
      : retainer.path;
  const lines = kept.map((step) =>
    step === undefined
      ? `    ... ${edges - MAX_STEPS} more steps ...`
      : `    ${step.edge === '' ? '' : `${step.edge} -> `}${step.node}`,
  );
  const share = `    (${retainer.countBefore} -> ${retainer.countAfter} nodes reach it along this route)`;
  return [head, ...lines, share].join('\n');
}
