import type { Binding } from '@babel/traverse';
import * as t from '@babel/types';

import type { Category, Graph, Mod } from './readable-model.ts';
import { componentName, needsCapital, resolveHead } from './readable-model.ts';
import type { Names } from './readable-names.ts';
import { nameForLocal } from './readable-names.ts';

export interface Rename {
  from: string;
  to: string;
  category: Category;
}

interface Plan {
  name: string;
  category: Category;
}

function unshorthand(binding: Binding): void {
  const { path: decl } = binding;
  const declaresItself =
    decl.isImportSpecifier() ||
    decl.isImportDefaultSpecifier() ||
    decl.isFunctionDeclaration() ||
    decl.isClassDeclaration() ||
    (decl.isVariableDeclarator() && decl.node.id === binding.identifier);
  if (declaresItself) {
    return;
  }
  t.traverseFast(decl.node, (node) => {
    if (t.isObjectProperty(node) && node.shorthand) {
      const { value } = node;
      if (
        value === binding.identifier ||
        (t.isAssignmentPattern(value) && value.left === binding.identifier)
      ) {
        node.shorthand = false;
      }
    }
  });
}

function setName(binding: Binding, jsxRefs: t.JSXIdentifier[] | undefined, next: string): void {
  const old = binding.identifier.name;
  binding.identifier.name = next;
  unshorthand(binding);
  for (const ref of binding.referencePaths) {
    const { node, parent } = ref;
    if (t.isIdentifier(node) && node.name === old) {
      node.name = next;
    }
    if (t.isObjectProperty(parent) && parent.shorthand && parent.value === node) {
      parent.shorthand = false;
    }
    if (t.isExportSpecifier(parent) && parent.exported === node) {
      parent.exported = t.identifier(old);
    }
  }
  for (const node of jsxRefs ?? []) {
    node.name = next;
  }
}

function canRename(binding: Binding): boolean {
  return binding.constantViolations.length === 0;
}

function planHomes(graph: Graph, names: Names, mod: Mod): Map<Binding, Plan> {
  const plan = new Map<Binding, Plan>();
  for (const [local, binding] of Object.entries(mod.prog?.bindings ?? {})) {
    const head = resolveHead(graph, mod, local);
    const isImport = mod.imports.has(local);
    const isHome = head?.mod === mod && head.local === local;
    const info = isImport || isHome ? nameForLocal(graph, names, { mod, local }) : undefined;
    if (info && (isImport || canRename(binding))) {
      plan.set(binding, info);
    }
  }
  return plan;
}

function planTypes(mod: Mod, plan: Map<Binding, Plan>): void {
  for (const local of mod.typeNames) {
    const binding = mod.prog?.bindings[local];
    if (binding && !plan.has(binding) && componentName(local) !== local && canRename(binding)) {
      plan.set(binding, {
        name: componentName(local),
        category: mod.imports.has(local) ? 'jsx-type-external' : 'component',
      });
    }
  }
  for (const binding of mod.localTypes) {
    const local = binding.identifier.name;
    if (componentName(local) !== local && canRename(binding)) {
      plan.set(binding, { name: componentName(local), category: 'jsx-type-local' });
    }
  }
}

function freeName(mod: Mod, { name }: Plan): string {
  let next = name;
  for (let attempt = 2; mod.taken.has(next); attempt += 1) {
    next = `${name}_${attempt}`;
  }
  return next;
}

function release(mod: Mod, name: string): void {
  const left = (mod.taken.get(name) ?? 1) - 1;
  if (left === 0) {
    mod.taken.delete(name);
  } else {
    mod.taken.set(name, left);
  }
}

export function applyModule(graph: Graph, names: Names, mod: Mod): Rename[] {
  const plan = planHomes(graph, names, mod);
  planTypes(mod, plan);

  const renames: Rename[] = [];
  for (const [binding, wanted] of plan) {
    const from = binding.identifier.name;
    if (from !== wanted.name) {
      const to = freeName(mod, wanted);
      release(mod, from);
      mod.taken.set(to, 1);
      setName(binding, mod.jsxRefs.get(binding), to);
      renames.push({ from, to, category: wanted.category });
    }
  }
  return renames;
}

export function lowercaseTags(mod: Mod): number {
  let count = 0;
  for (const nodes of mod.jsxRefs.values()) {
    for (const node of nodes) {
      if (needsCapital(node.name) && !mod.memberRoots.has(node)) {
        count += 1;
      }
    }
  }
  return count;
}
