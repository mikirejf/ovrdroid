import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

import { messageOf } from '../cli.ts';
import { importTarget, specifierName } from './readable-model.ts';

export interface Interface {
  exports: string[];
  imports: string[];
  globals: string[];
  bindings: number;
}

type Retarget = (source: string) => string;

function exportsOf(node: t.Statement, retarget: Retarget): string[] {
  if (t.isExportAllDeclaration(node)) {
    return [`${retarget(node.source.value)}:*`];
  }
  if (t.isExportDefaultDeclaration(node)) {
    return [':default'];
  }
  if (!t.isExportNamedDeclaration(node)) {
    return [];
  }
  const from = node.source ? retarget(node.source.value) : '';
  const declared = node.declaration ? Object.keys(t.getBindingIdentifiers(node.declaration)) : [];
  return [
    ...declared.map((name) => `:${name}`),
    ...node.specifiers.map((spec) =>
      t.isExportSpecifier(spec) ? `${from}:${specifierName(spec.exported)}` : `${from}:*`,
    ),
  ];
}

function importedName(spec: t.ImportDeclaration['specifiers'][number]): string {
  if (t.isImportSpecifier(spec)) {
    return specifierName(spec.imported);
  }
  return t.isImportDefaultSpecifier(spec) ? 'default' : '*';
}

function importsOf(node: t.Statement, retarget: Retarget): string[] {
  if (!t.isImportDeclaration(node)) {
    return [];
  }
  const from = retarget(node.source.value);
  return node.specifiers.length === 0
    ? [`${from}:`]
    : node.specifiers.map((spec) => `${from}:${importedName(spec)}`);
}

export function interfaceOf(code: string, jsx: boolean, retarget: Retarget): Interface {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: jsx ? ['jsx'] : [],
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  });
  const found: Interface = {
    exports: ast.program.body.flatMap((node) => exportsOf(node, retarget)).toSorted(),
    imports: ast.program.body.flatMap((node) => importsOf(node, retarget)).toSorted(),
    globals: [],
    bindings: 0,
  };
  traverse(ast, {
    Program(path) {
      found.globals = Object.keys(path.scope.globals).toSorted();
      found.bindings = Object.keys(path.scope.bindings).length;
      path.stop();
    },
  });
  return found;
}

const SHOWN_NAMES = 5;

function differences(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
): string[] {
  const had = new Set(expected);
  const has = new Set(actual);
  const missing = expected.filter((entry) => !has.has(entry));
  const extra = actual.filter((entry) => !had.has(entry));
  if (missing.length === 0 && extra.length === 0) {
    return [];
  }
  const list = (entries: readonly string[]): string =>
    entries.slice(0, SHOWN_NAMES).join(', ') + (entries.length > SHOWN_NAMES ? ', …' : '');
  return [`${label} differ: missing [${list(missing)}], unexpected [${list(extra)}]`];
}

export function compareInterfaces(original: Interface, output: Interface): string[] {
  const problems = [
    ...differences('exports', original.exports, output.exports),
    ...differences('imports', original.imports, output.imports),
    ...differences('unresolved globals', original.globals, output.globals),
  ];
  if (original.bindings !== output.bindings) {
    problems.push(`top-level bindings ${original.bindings} became ${output.bindings}`);
  }
  return problems;
}

export function checkReadable(
  original: string,
  output: string,
  known: ReadonlySet<string>,
): string[] {
  try {
    const before = interfaceOf(original, false, (source) => importTarget(source, known));
    const after = interfaceOf(output, true, (source) => source);
    return compareInterfaces(before, after);
  } catch (error) {
    return [`does not parse: ${messageOf(error)}`];
  }
}
