import { readFileSync } from 'node:fs';

import type { App, AppModule } from '../binary/graph.ts';
import { embedName, readApp } from '../binary/graph.ts';
import { say } from '../cli.ts';
import { moduleHolding } from './search.ts';

export interface Hook {
  hook: string;
  exported: string;
}

export interface HookModule {
  module: string;
  hooks: Hook[];
}

export interface SeenHook {
  hook: string;
  local: string | undefined;
}

const WRAPPER =
  /(?<![\w$.])(?<local>[\w$]+)=function\([\w$,]*\)\{return [\w$]+\.H\.(?<hook>use[A-Za-z]*)\(/gu;

const EXPORT = /export\{(?<names>[^}]*)\}/gu;

const IMPORT = /import\{(?<names>[^}]*)\}from"(?<from>[^"]+)"/gu;

function pairs(list: string): [string, string][] {
  return list
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [left = '', right = left] = entry.split(' as ');
      return [left.trim(), right.trim()];
    });
}

function exportNames(text: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const match of text.matchAll(EXPORT)) {
    for (const [local, exported] of pairs(match.groups?.['names'] ?? '')) {
      names.set(local, exported);
    }
  }
  return names;
}

export function hooksIn(text: string): Hook[] {
  const exported = exportNames(text);
  const found: Hook[] = [];
  for (const match of text.matchAll(WRAPPER)) {
    const local = match.groups?.['local'] ?? '';
    const name = exported.get(local);
    if (name !== undefined) {
      found.push({ hook: match.groups?.['hook'] ?? '', exported: name });
    }
  }
  return found.toSorted((a, b) => a.hook.localeCompare(b.hook));
}

export function hookModules(app: App): HookModule[] {
  return app
    .map((module) => ({ module: embedName(module.name), hooks: hooksIn(module.text) }))
    .filter((found) => found.hooks.length > 0);
}

export function hooksSeenBy(module: AppModule, source: HookModule): SeenHook[] {
  const locals = new Map<string, string>();
  for (const match of module.text.matchAll(IMPORT)) {
    if (embedName(match.groups?.['from'] ?? '') === source.module) {
      for (const [exported, local] of pairs(match.groups?.['names'] ?? '')) {
        locals.set(exported, local);
      }
    }
  }
  return source.hooks.map(({ hook, exported }) => ({ hook, local: locals.get(exported) }));
}

const COLUMN = 22;

export function describeHookModule(source: HookModule): string[] {
  return [
    `React's hooks are exported from ${source.module}, each under this name:`,
    ...source.hooks.map(({ hook, exported }) => `  ${hook.padEnd(COLUMN)}${exported}`),
  ];
}

export function describeSeenHooks(module: string, seen: readonly SeenHook[]): string[] {
  const used = seen.filter((entry) => entry.local !== undefined);
  if (used.length === 0) {
    return [`${module} imports no React hook directly`];
  }
  return [
    `React's hooks as ${module} names them (a hook not listed is not imported there):`,
    ...used.map(({ hook, local }) => `  ${hook.padEnd(COLUMN)}${local ?? ''}`),
  ];
}

export function hooks(binary: string, anchor: string | undefined): void {
  const app = readApp(readFileSync(binary));
  const sources = hookModules(app);
  if (sources.length === 0) {
    throw new Error(
      "no module wraps React's hooks as `X=function(…){return Y.H.useZ(…)`: React's internals changed, so read the react chunk by hand and fix src/probe/hooks.ts",
    );
  }

  if (anchor === undefined) {
    say(sources.flatMap((source) => describeHookModule(source)).join('\n'));
    return;
  }

  const module = moduleHolding(app, anchor);
  if (module === undefined) {
    throw new Error(`no module carries that anchor, so its hooks cannot be named: ${anchor}`);
  }
  for (const source of sources) {
    say(describeSeenHooks(embedName(module.name), hooksSeenBy(module, source)).join('\n'));
  }
}
