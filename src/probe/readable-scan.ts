import * as t from '@babel/types';

import { hooksIn } from './hooks.ts';
import type { Mod } from './readable-model.ts';
import { propName, sourceFile, specifierName } from './readable-model.ts';
import { seedOfFunction } from './readable-seeds.ts';

interface Scan {
  mod: Mod;
  pending: (readonly t.Statement[])[];
}

const FRAGMENT_SYMBOLS = new Map([
  ['react.fragment', 'Fragment'],
  ['react.profiler', 'Profiler'],
  ['react.strict_mode', 'StrictMode'],
  ['react.suspense', 'Suspense'],
]);

function symbolForName(node: t.Node | null | undefined): string | undefined {
  if (!t.isCallExpression(node) || !t.isMemberExpression(node.callee)) {
    return undefined;
  }
  const [first] = node.arguments;
  return t.isIdentifier(node.callee.object, { name: 'Symbol' }) &&
    t.isIdentifier(node.callee.property, { name: 'for' }) &&
    t.isStringLiteral(first)
    ? first.value
    : undefined;
}

function importedName(
  spec: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier,
): string {
  if (t.isImportSpecifier(spec)) {
    return specifierName(spec.imported);
  }
  return t.isImportDefaultSpecifier(spec) ? 'default' : '*';
}

function noteImport(mod: Mod, stmt: t.ImportDeclaration): void {
  for (const spec of stmt.specifiers) {
    mod.imports.set(spec.local.name, {
      from: sourceFile(stmt.source.value),
      name: importedName(spec),
    });
  }
}

function noteExport(mod: Mod, stmt: t.ExportNamedDeclaration): void {
  for (const spec of stmt.specifiers) {
    if (t.isExportSpecifier(spec)) {
      const exported = specifierName(spec.exported);
      const local = specifierName(spec.local);
      if (stmt.source) {
        mod.reexports.set(exported, { from: sourceFile(stmt.source.value), name: local });
      } else {
        mod.exports.set(exported, local);
      }
    }
  }
}

function noteClassDisplay(
  mod: Mod,
  local: string,
  cls: t.ClassDeclaration | t.ClassExpression,
): void {
  for (const member of cls.body.body) {
    if (
      t.isClassProperty(member) &&
      member.static &&
      propName(member) === 'displayName' &&
      t.isStringLiteral(member.value)
    ) {
      mod.display.set(local, member.value.value);
    }
  }
}

function noteMemberAssignment(mod: Mod, left: t.MemberExpression, right: t.Expression): void {
  if (left.computed || !t.isIdentifier(left.property)) {
    return;
  }
  const prop = left.property.name;
  if (prop === 'displayName' && t.isIdentifier(left.object) && t.isStringLiteral(right)) {
    mod.display.set(left.object.name, right.value);
  }
  if (
    prop === 'isReactComponent' &&
    t.isMemberExpression(left.object) &&
    t.isIdentifier(left.object.property, { name: 'prototype' }) &&
    t.isIdentifier(left.object.object)
  ) {
    mod.seeds.set(left.object.object.name, { kind: 'react', name: 'Component' });
  }
  if (prop === 'isPureReactComponent' && t.isIdentifier(left.object)) {
    mod.pureHolders.add(left.object.name);
  }
}

function noteLazyInit(scan: Scan, call: t.CallExpression): void {
  const [fn] = call.arguments;
  if (
    t.isIdentifier(call.callee) &&
    call.arguments.length === 1 &&
    (t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn)) &&
    fn.params.length === 0 &&
    t.isBlockStatement(fn.body)
  ) {
    scan.pending.push(fn.body.body);
  }
}

function noteValue(scan: Scan, local: string, init: t.Node | null | undefined): void {
  const symbol = symbolForName(init);
  if (t.isFunction(init)) {
    scan.mod.funcs.set(local, init);
  } else if (t.isIdentifier(init)) {
    scan.mod.alias.set(local, init.name);
  } else if (symbol !== undefined) {
    scan.mod.symFor.set(local, symbol);
  } else if (t.isClassExpression(init)) {
    noteClassDisplay(scan.mod, local, init);
  } else if (t.isCallExpression(init)) {
    noteLazyInit(scan, init);
  }
}

function noteChain(scan: Scan, first: t.AssignmentExpression): void {
  for (
    let expr: t.Expression = first;
    t.isAssignmentExpression(expr) && expr.operator === '=';
    expr = expr.right
  ) {
    const { left, right } = expr;
    if (t.isIdentifier(left)) {
      noteValue(scan, left.name, right);
      if (
        t.isAssignmentExpression(right) &&
        t.isMemberExpression(right.left) &&
        t.isIdentifier(right.left.property, { name: 'prototype' }) &&
        t.isIdentifier(right.left.object)
      ) {
        scan.mod.protoOf.set(left.name, right.left.object.name);
      }
    } else if (t.isMemberExpression(left)) {
      noteMemberAssignment(scan.mod, left, right);
    }
  }
}

function noteExpression(scan: Scan, expr: t.Expression): void {
  if (t.isSequenceExpression(expr)) {
    for (const inner of expr.expressions) {
      noteExpression(scan, inner);
    }
  } else if (t.isAssignmentExpression(expr)) {
    noteChain(scan, expr);
  }
}

function noteDeclaration(scan: Scan, decl: t.VariableDeclarator): void {
  if (t.isIdentifier(decl.id)) {
    noteValue(scan, decl.id.name, decl.init);
    if (t.isAssignmentExpression(decl.init)) {
      noteChain(scan, decl.init);
    }
  }
}

function noteStatement(scan: Scan, stmt: t.Statement): void {
  const { mod } = scan;
  if (t.isImportDeclaration(stmt)) {
    noteImport(mod, stmt);
  } else if (t.isExportNamedDeclaration(stmt)) {
    noteExport(mod, stmt);
  } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
    mod.funcs.set(stmt.id.name, stmt);
  } else if (t.isClassDeclaration(stmt) && stmt.id) {
    noteClassDisplay(mod, stmt.id.name, stmt);
  } else if (t.isVariableDeclaration(stmt)) {
    for (const decl of stmt.declarations) {
      noteDeclaration(scan, decl);
    }
  } else if (t.isExpressionStatement(stmt)) {
    noteExpression(scan, stmt.expression);
  }
}

function noteStatements(mod: Mod): void {
  const scan: Scan = { mod, pending: [mod.ast.program.body] };
  for (let body = scan.pending.pop(); body !== undefined; body = scan.pending.pop()) {
    for (const stmt of body) {
      noteStatement(scan, stmt);
    }
  }
}

function seedHooks(mod: Mod): void {
  for (const { hook, exported } of hooksIn(mod.text)) {
    const local = mod.exports.get(exported);
    if (local !== undefined) {
      mod.seeds.set(local, { kind: 'hook', name: hook });
    }
  }
}

function seedReactSymbols(mod: Mod): void {
  for (const [holder, target] of mod.protoOf) {
    if (mod.pureHolders.has(holder)) {
      mod.seeds.set(target, { kind: 'react', name: 'PureComponent' });
    }
  }
  for (const [local, symbol] of mod.symFor) {
    const name = FRAGMENT_SYMBOLS.get(symbol);
    if (name !== undefined) {
      mod.seeds.set(local, { kind: 'react', name });
    }
  }
}

export function scanModule(mod: Mod): void {
  noteStatements(mod);
  seedHooks(mod);
  seedReactSymbols(mod);
  for (const [local, fn] of mod.funcs) {
    const seed = mod.seeds.has(local) ? undefined : seedOfFunction(fn, mod);
    if (seed !== undefined) {
      mod.seeds.set(local, seed);
    }
  }
}
