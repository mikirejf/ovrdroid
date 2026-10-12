import type { Category, Graph, Mod, SeedKind } from './readable-model.ts';
import { capitalize, componentName, headId, nodeId, resolveHead } from './readable-model.ts';

export interface NameInfo {
  name: string;
  category: Category;
}

export interface Names {
  byId: Map<string, NameInfo>;
  components: Set<string>;
  hooks: Set<string>;
}

const SEED_CATEGORY: Record<SeedKind, Category> = {
  hook: 'react-hook',
  jsxrt: 'jsx-runtime',
  ink: 'ink-component',
  react: 'react-api',
};

const DISPLAY_NAME = /^[A-Za-z_$][\w$]*$/u;
const HOOK_NAME = /^use[A-Z0-9]/u;
const LETTER_START = /^[A-Za-z]/u;

function hookName(local: string): string {
  return LETTER_START.test(local) ? `use${capitalize(local)}` : `useH${local}`;
}
const JSX_RUNTIME_PLURAL = 1;

function markComponents(graph: Graph, names: Names): void {
  for (const mod of graph.values()) {
    for (const local of mod.typeNames) {
      const head = resolveHead(graph, mod, local);
      if (head) {
        names.components.add(headId(head));
      }
    }
    for (const owner of mod.directJsx) {
      names.components.add(nodeId(mod, owner));
    }
  }
}

function calleeIds(graph: Graph, mod: Mod, callees: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const callee of callees) {
    const head = resolveHead(graph, mod, callee);
    if (head) {
      ids.push(headId(head));
    }
  }
  return ids;
}

function callGraphOf(graph: Graph, names: Names): [string, string[]][] {
  const edges: [string, string[]][] = [];
  for (const mod of graph.values()) {
    for (const [owner, callees] of mod.calls) {
      const id = nodeId(mod, owner);
      if (!names.components.has(id) && !mod.seeds.has(owner)) {
        edges.push([id, calleeIds(graph, mod, callees)]);
      }
    }
  }
  return edges;
}

function markHooks(graph: Graph, names: Names): void {
  for (const mod of graph.values()) {
    for (const [local, seed] of mod.seeds) {
      if (seed.kind === 'hook') {
        names.hooks.add(nodeId(mod, local));
      }
    }
  }
  const edges = callGraphOf(graph, names);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, heads] of edges) {
      if (!names.hooks.has(id) && heads.some((head) => names.hooks.has(head))) {
        names.hooks.add(id);
        changed = true;
      }
    }
  }
}

function homeName(names: Names, mod: Mod, local: string): NameInfo | undefined {
  const seed = mod.seeds.get(local);
  if (seed) {
    return { name: seed.name, category: SEED_CATEGORY[seed.kind] };
  }
  const id = nodeId(mod, local);
  const display = mod.display.get(local);
  if (display !== undefined && DISPLAY_NAME.test(display)) {
    const shown = names.components.has(id) ? componentName(display) : display;
    return { name: shown, category: 'display-name' };
  }
  if (names.components.has(id) && componentName(local) !== local) {
    return { name: componentName(local), category: 'component' };
  }
  if (names.hooks.has(id) && !HOOK_NAME.test(local)) {
    return { name: hookName(local), category: 'custom-hook' };
  }
  return undefined;
}

function nameHomes(graph: Graph, names: Names): void {
  for (const mod of graph.values()) {
    const locals = new Set([...mod.seeds.keys(), ...mod.display.keys(), ...mod.calls.keys()]);
    for (const local of locals) {
      const info = homeName(names, mod, local);
      if (info) {
        names.byId.set(nodeId(mod, local), info);
      }
    }
  }
}

function nameTypes(graph: Graph, names: Names): void {
  for (const mod of graph.values()) {
    for (const local of mod.typeNames) {
      const head = resolveHead(graph, mod, local);
      if (
        head &&
        !names.byId.has(headId(head)) &&
        componentName(head.local) !== head.local &&
        !head.mod.alias.has(head.local)
      ) {
        names.byId.set(headId(head), { name: componentName(head.local), category: 'component' });
      }
    }
  }
}

export function computeNames(graph: Graph): Names {
  const names: Names = { byId: new Map(), components: new Set(), hooks: new Set() };
  markComponents(graph, names);
  markHooks(graph, names);
  nameHomes(graph, names);
  nameTypes(graph, names);
  return names;
}

export function nameForLocal(
  graph: Graph,
  names: Names,
  at: { mod: Mod; local: string },
): NameInfo | undefined {
  const head = resolveHead(graph, at.mod, at.local);
  const info = head && names.byId.get(headId(head));
  if (!head || !info) {
    return undefined;
  }
  const { hop } = head;
  if (head.mod.seeds.get(head.local)?.kind !== 'jsxrt' || hop === undefined) {
    return info;
  }
  const aliases = [...hop.src.exports.keys()].filter((exported) => {
    const target = hop.src.exports.get(exported);
    const other = target === undefined ? undefined : resolveHead(graph, hop.src, target);
    return other !== undefined && headId(other) === headId(head);
  });
  const plural = aliases.indexOf(hop.exported) === JSX_RUNTIME_PLURAL;
  return { name: plural ? 'jsxs' : 'jsx', category: info.category };
}
