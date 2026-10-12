import { generate } from '@babel/generator';
import * as t from '@babel/types';

import type { AppModule } from '../binary/graph.ts';
import { messageOf } from '../cli.ts';
import { applyModule, lowercaseTags } from './readable-apply.ts';
import type { Rename } from './readable-apply.ts';
import type { Category, JsxCounts, Mod } from './readable-model.ts';
import { importTarget, loadModule, outputName } from './readable-model.ts';
import { computeNames } from './readable-names.ts';
import { computeRoles, passModule } from './readable-pass.ts';
import { scanModule } from './readable-scan.ts';

export interface Failure {
  module: string;
  what: string;
}

export interface Readable {
  modules: Map<string, string>;
  renames: Map<string, Rename[]>;
  restored: Map<Category, number>;
  jsx: JsxCounts;
  failures: Failure[];
}

function retarget(ast: t.File, known: ReadonlySet<string>): void {
  const point = (literal: t.StringLiteral): void => {
    const to = importTarget(literal.value, known);
    if (to !== literal.value) {
      literal.value = to;
      literal.extra = { raw: JSON.stringify(to), rawValue: to };
    }
  };
  t.traverseFast(ast, (node) => {
    if (
      (t.isImportDeclaration(node) ||
        t.isExportNamedDeclaration(node) ||
        t.isExportAllDeclaration(node)) &&
      node.source
    ) {
      point(node.source);
    } else if (t.isImportExpression(node) && t.isStringLiteral(node.source)) {
      point(node.source);
    }
  });
}

function tally(counts: Map<Category, number>, renames: readonly Rename[]): void {
  for (const { category } of renames) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
}

const SHOWN_PROBLEMS = 20;

export function describeReadable(result: Readable, out: string): string[] {
  const restored = [...result.restored].toSorted((a, b) => b[1] - a[1]);
  const total = restored.reduce((sum, [, count]) => sum + count, 0);
  const width = Math.max(0, ...restored.map(([category]) => category.length));
  const { calls, converted, leftover } = result.jsx;
  const kept = [...leftover].map(([reason, count]) => `${count} ${reason}`);
  return [
    `${out}: ${result.modules.size} readable modules, and renames.json listing every rename`,
    `names restored: ${total}`,
    ...restored.map(([category, count]) => `  ${category.padEnd(width)}  ${count}`),
    `${converted} of ${calls} jsx calls became JSX${kept.length > 0 ? ` (kept as calls: ${kept.join(', ')})` : ''}`,
  ];
}

export function describeProblems(failures: readonly Failure[], modules: number): string[] {
  const shown = failures.slice(0, SHOWN_PROBLEMS);
  const hidden = failures.length - shown.length;
  return [
    `${failures.length} problems across ${modules} modules; the files are written, so inspect them`,
    ...shown.map(({ module, what }) => `  ${module}: ${what}`),
    ...(hidden > 0 ? [`  … and ${hidden} more`] : []),
  ];
}

export function makeReadable(sources: readonly AppModule[]): Readable {
  const failures: Failure[] = [];
  const graph = new Map<string, Mod>();
  const known = new Set(sources.map((source) => source.name));

  const eachModule = (phase: string, work: (mod: Mod) => void): void => {
    for (const mod of graph.values()) {
      try {
        work(mod);
      } catch (error) {
        failures.push({ module: mod.file, what: `${phase}: ${messageOf(error)}` });
        graph.delete(mod.file);
      }
    }
  };

  for (const { name, text } of sources) {
    try {
      graph.set(name, loadModule(name, text));
    } catch (error) {
      failures.push({ module: name, what: `parse: ${messageOf(error)}` });
    }
  }
  eachModule('scan', scanModule);
  eachModule('roles', (mod) => {
    computeRoles(graph, mod);
  });
  eachModule('convert', (mod) => {
    passModule(mod);
  });
  const names = computeNames(graph);

  const renames = new Map<string, Rename[]>();
  const restored = new Map<Category, number>();
  eachModule('rename', (mod) => {
    const done = applyModule(graph, names, mod);
    tally(restored, done);
    if (done.length > 0) {
      renames.set(outputName(mod.file), done);
    }
    const tags = lowercaseTags(mod);
    if (tags > 0) {
      failures.push({
        module: mod.file,
        what: `${tags} JSX tags kept a lowercase name, so they read as HTML elements`,
      });
    }
  });

  const modules = new Map<string, string>();
  eachModule('generate', (mod) => {
    retarget(mod.ast, known);
    modules.set(
      outputName(mod.file),
      generate(mod.ast, { compact: true, jsescOption: { minimal: true } }).code,
    );
  });
  for (const { name, text } of sources) {
    if (!modules.has(outputName(name))) {
      modules.set(outputName(name), text);
    }
  }

  const jsx: JsxCounts = { calls: 0, converted: 0, leftover: new Map() };
  for (const mod of graph.values()) {
    jsx.calls += mod.jsx.calls;
    jsx.converted += mod.jsx.converted;
    for (const [reason, count] of mod.jsx.leftover) {
      jsx.leftover.set(reason, (jsx.leftover.get(reason) ?? 0) + count);
    }
  }
  return { modules, renames, restored, jsx, failures };
}
