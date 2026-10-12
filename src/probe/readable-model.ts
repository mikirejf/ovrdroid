import path from 'node:path';

import { parse } from '@babel/parser';
import type { Binding, Scope } from '@babel/traverse';
import * as t from '@babel/types';

export type SeedKind = 'hook' | 'react' | 'jsxrt' | 'ink';

export type Role = 'jsx' | 'create' | 'fragment';

export type Category =
  | 'react-hook'
  | 'jsx-runtime'
  | 'ink-component'
  | 'react-api'
  | 'display-name'
  | 'component'
  | 'custom-hook'
  | 'jsx-type-external'
  | 'jsx-type-local';

export interface Seed {
  kind: SeedKind;
  name: string;
}

export interface Ref {
  from: string;
  name: string;
}

export interface JsxCounts {
  calls: number;
  converted: number;
  leftover: Map<string, number>;
}

export interface Mod {
  file: string;
  ast: t.File;
  text: string;
  hasInk: boolean;
  imports: Map<string, Ref>;
  exports: Map<string, string>;
  reexports: Map<string, Ref>;
  alias: Map<string, string>;
  funcs: Map<string, t.Function>;
  symFor: Map<string, string>;
  display: Map<string, string>;
  protoOf: Map<string, string>;
  pureHolders: Set<string>;
  seeds: Map<string, Seed>;
  calls: Map<string, Set<string>>;
  directJsx: Set<string>;
  typeNames: Set<string>;
  localTypes: Set<Binding>;
  jsxRefs: Map<Binding, t.JSXIdentifier[]>;
  memberRoots: WeakSet<t.Node>;
  taken: Map<string, number>;
  roles: Map<string, Role>;
  jsx: JsxCounts;
  prog?: Scope;
}

export type Graph = ReadonlyMap<string, Mod>;

export interface Head {
  mod: Mod;
  local: string;
  hop?: { src: Mod; exported: string };
}

const MAX_ALIAS_HOPS = 60;
const MAX_REEXPORT_HOPS = 20;

export function loadModule(file: string, text: string): Mod {
  return {
    file,
    ast: parse(text, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    }),
    text,
    hasInk: text.includes('"ink-box"'),
    imports: new Map(),
    exports: new Map(),
    reexports: new Map(),
    alias: new Map(),
    funcs: new Map(),
    symFor: new Map(),
    display: new Map(),
    protoOf: new Map(),
    pureHolders: new Set(),
    seeds: new Map(),
    calls: new Map(),
    directJsx: new Set(),
    typeNames: new Set(),
    localTypes: new Set(),
    jsxRefs: new Map(),
    memberRoots: new WeakSet(),
    taken: new Map(),
    roles: new Map(),
    jsx: { calls: 0, converted: 0, leftover: new Map() },
  };
}

export function sourceFile(source: string): string {
  return path.basename(source);
}

export function outputName(file: string): string {
  return `${file.replace(/\.js$/u, '')}.jsx`;
}

export function importTarget(source: string, known: ReadonlySet<string>): string {
  return known.has(sourceFile(source)) ? `./${outputName(sourceFile(source))}` : source;
}

export function propName(
  property: t.ObjectProperty | t.ObjectMethod | t.ClassProperty,
): string | undefined {
  if (property.computed) {
    return undefined;
  }
  if (t.isIdentifier(property.key)) {
    return property.key.name;
  }
  return t.isStringLiteral(property.key) ? property.key.value : undefined;
}

export function specifierName(node: t.Identifier | t.StringLiteral): string {
  return t.isIdentifier(node) ? node.name : node.value;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function componentName(local: string): string {
  if (/^[A-Z]/u.test(local)) {
    return local;
  }
  return /^[a-z]/u.test(local) ? capitalize(local) : `C${local}`;
}

export function needsCapital(name: string): boolean {
  return /^[a-z]/u.test(name);
}

export function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function nodeId(mod: Mod, local: string): string {
  return `${mod.file}\u0000${local}`;
}

export function headId(head: Head): string {
  return nodeId(head.mod, head.local);
}

function exportedFrom(
  graph: Graph,
  ref: Ref,
): { src: Mod; exported: string; local: string } | undefined {
  let src = graph.get(ref.from);
  let exported = ref.name;
  for (let hop = 0; hop < MAX_REEXPORT_HOPS && src !== undefined; hop += 1) {
    const local = src.exports.get(exported);
    if (local !== undefined) {
      return { src, exported, local };
    }
    const reexport = src.reexports.get(exported);
    if (reexport === undefined) {
      return undefined;
    }
    src = graph.get(reexport.from);
    exported = reexport.name;
  }
  return undefined;
}

export function resolveHead(graph: Graph, start: Mod, startLocal: string): Head | undefined {
  let mod = start;
  let local = startLocal;
  let hop: Head['hop'];
  for (let step = 0; step < MAX_ALIAS_HOPS; step += 1) {
    const imported = mod.imports.get(local);
    if (imported !== undefined) {
      const found = exportedFrom(graph, imported);
      if (found === undefined) {
        return undefined;
      }
      hop = { src: found.src, exported: found.exported };
      mod = found.src;
      local = found.local;
      continue;
    }
    const next = mod.alias.get(local);
    if (next === undefined || next === local) {
      return hop === undefined ? { mod, local } : { mod, local, hop };
    }
    local = next;
  }
  return undefined;
}
