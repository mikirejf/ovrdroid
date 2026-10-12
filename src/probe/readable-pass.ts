import type { Binding, NodePath } from '@babel/traverse';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

import { buildElement } from './readable-element.ts';
import type { Graph, Mod, Role, Seed } from './readable-model.ts';
import { bump, resolveHead } from './readable-model.ts';

function roleOfSeed(seed: Seed | undefined): Role | undefined {
  if (seed?.kind === 'jsxrt') {
    return 'jsx';
  }
  if (seed?.kind !== 'react') {
    return undefined;
  }
  if (seed.name === 'createElement') {
    return 'create';
  }
  return seed.name === 'Fragment' ? 'fragment' : undefined;
}

export function computeRoles(graph: Graph, mod: Mod): void {
  for (const local of mod.imports.keys()) {
    const head = resolveHead(graph, mod, local);
    const role = head && roleOfSeed(head.mod.seeds.get(head.local));
    if (role !== undefined) {
      mod.roles.set(local, role);
    }
  }
}

function topLevelOwner(fnPath: NodePath<t.Function> | null): string | undefined {
  if (!fnPath) {
    return undefined;
  }
  if (fnPath.isFunctionDeclaration() && fnPath.parentPath.isProgram()) {
    return fnPath.node.id?.name;
  }
  const { parentPath } = fnPath;
  if (
    (fnPath.isFunctionExpression() || fnPath.isArrowFunctionExpression()) &&
    parentPath.isVariableDeclarator() &&
    parentPath.parentPath.parentPath.isProgram() &&
    t.isIdentifier(parentPath.node.id)
  ) {
    return parentPath.node.id.name;
  }
  return undefined;
}

interface Visit {
  mod: Mod;
  seen: WeakSet<t.Node>;
}

function noteType(mod: Mod, typeBinding: Binding | undefined): void {
  if (!typeBinding) {
    return;
  }
  if (typeBinding.scope === mod.prog) {
    mod.typeNames.add(typeBinding.identifier.name);
  } else {
    mod.localTypes.add(typeBinding);
  }
}

function convertCall(
  path: NodePath<t.CallExpression>,
  role: 'jsx' | 'create',
  { mod }: Visit,
): void {
  const built = buildElement(path, role, mod);
  if ('reason' in built) {
    bump(mod.jsx.leftover, built.reason);
    return;
  }
  noteType(mod, built.typeBinding);
  mod.jsx.converted += 1;
  for (const [binding, node] of built.refs) {
    mod.jsxRefs.set(binding, [...(mod.jsxRefs.get(binding) ?? []), node]);
  }
  path.replaceWith(built.node);
  path.skip();
}

function visitCall(path: NodePath<t.CallExpression>, visit: Visit): void {
  const { mod, seen } = visit;
  const { callee } = path.node;
  if (!t.isIdentifier(callee)) {
    return;
  }
  const binding = path.scope.getBinding(callee.name);
  if (!binding || binding.scope !== mod.prog) {
    return;
  }
  const owner = topLevelOwner(path.getFunctionParent());
  if (owner !== undefined) {
    mod.calls.get(owner)?.add(callee.name);
  }
  const role = mod.roles.get(callee.name);
  if ((role !== 'jsx' && role !== 'create') || seen.has(path.node)) {
    return;
  }
  seen.add(path.node);
  mod.jsx.calls += 1;
  if (owner !== undefined) {
    mod.directJsx.add(owner);
  }
  convertCall(path, role, visit);
}

export function passModule(mod: Mod): void {
  const visit: Visit = { mod, seen: new WeakSet<t.Node>() };
  traverse(mod.ast, {
    Program(path) {
      mod.prog = path.scope;
    },
    Scopable(path) {
      for (const name of Object.keys(path.scope.bindings)) {
        bump(mod.taken, name);
      }
    },
    Function(path) {
      const owner = topLevelOwner(path);
      if (owner !== undefined && !mod.calls.has(owner)) {
        mod.calls.set(owner, new Set());
      }
    },
    CallExpression: {
      exit(path) {
        visitCall(path, visit);
      },
    },
  });
  for (const name of Object.keys(mod.prog?.globals ?? {})) {
    bump(mod.taken, name);
  }
}
