import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { EMBED_PREFIX } from '../../binary/graph.ts';
import type { Rebase } from '../rebase.ts';
import { rebaseAll } from '../rebase.ts';
import { streamRenderPatches } from '../stream-render-patches.ts';
import { sourceApp, STOCK, textOf } from './ink-frame-harness.ts';
import { payloadFunction } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';

const IMPORT_STATEMENT = /import\{(?<names>[^}]*)\}from"(?<from>[^"]+)";?/gu;
const SIDE_EFFECT_IMPORT = /import"[^"]*";?/gu;
const EXPORT_STATEMENT = /export\{(?<names>[^}]*)\};?/u;
const ALIAS = /\s+as\s+/u;

const rebases = rebaseAll(
  streamRenderPatches,
  (STOCK ?? []).map((module) => module.text),
);

export function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the stream render patches`);
  }
  return found;
}

export function patchedApp(): App {
  return patchSource(sourceApp(), streamRenderPatches);
}

interface Binding {
  from: string;
  exported: string;
}

function importBindings(text: string): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const match of text.matchAll(IMPORT_STATEMENT)) {
    const from = match.groups?.['from'] ?? '';
    for (const entry of (match.groups?.['names'] ?? '').split(',')) {
      const [exported = '', local = exported] = entry.trim().split(ALIAS);
      bindings.set(local, { from, exported });
    }
  }
  return bindings;
}

function emptyScope() {
  const scope = Object.fromEntries<Stand>([]);
  Object.setPrototypeOf(scope, null);
  return scope;
}

type Scope = ReturnType<typeof emptyScope>;

class Chunks {
  private readonly evaluated = new Map<string, Record<string, Stand>>();

  exportsOf(chunk: string): Record<string, Stand> {
    const cached = this.evaluated.get(chunk);
    if (cached !== undefined) {
      return cached;
    }
    const text = textOf(sourceApp(), chunk);
    const outputs = (EXPORT_STATEMENT.exec(text)?.groups?.['names'] ?? '')
      .split(',')
      .map((entry) => {
        const [local = '', outside = local] = entry.trim().split(ALIAS);
        return `${JSON.stringify(outside)}:${local}`;
      });
    const body = text
      .replaceAll(IMPORT_STATEMENT, '')
      .replaceAll(SIDE_EFFECT_IMPORT, '')
      .replace(EXPORT_STATEMENT, '')
      .replaceAll('import.meta', '$ODmeta');
    const meta = new Map<string, Stand>([['$ODmeta', { url: import.meta.url }]]);
    const result = payloadFunction<[Scope], Record<string, Stand>>(
      ['$ODscope'],
      `with($ODscope){${body}\nreturn{${outputs.join(',')}}}`,
    )(this.scopeOver(text, meta));
    this.evaluated.set(chunk, result);
    return result;
  }

  valueOf(text: string, name: string): Stand {
    const binding = importBindings(text).get(name);
    if (binding === undefined) {
      throw new Error(`${name} is not imported by the module`);
    }
    if (!binding.from.startsWith(EMBED_PREFIX)) {
      throw new Error(`${name} comes from ${binding.from}, which the tests do not load`);
    }
    return this.exportsOf(binding.from)[binding.exported];
  }

  scopeOver(text: string, overrides: ReadonlyMap<string, Stand>) {
    const scope = emptyScope();
    for (const name of importBindings(text).keys()) {
      Object.defineProperty(scope, name, {
        configurable: true,
        get: () => {
          const value = this.valueOf(text, name);
          Object.defineProperty(scope, name, { value, configurable: true });
          return value;
        },
      });
    }
    for (const [name, value] of overrides) {
      Object.defineProperty(scope, name, { value, configurable: true });
    }
    return scope;
  }
}

const chunks = new Chunks();

export function importedValue(text: string, name: string): Stand {
  return chunks.valueOf(text, name);
}

export interface Program {
  moduleText: string;
  source: string;
  returns: readonly string[];
  overrides: ReadonlyMap<string, Stand>;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function evaluateProgram<Result>(program: Program): Result {
  return payloadFunction<[Scope], Result>(
    ['$ODscope'],
    `with($ODscope){${program.source};return{${program.returns.join(',')}}}`,
  )(chunks.scopeOver(program.moduleText, program.overrides));
}

function writeRefused(): never {
  throw new Error('a shared object was written to');
}

export type Plain =
  | string
  | number
  | boolean
  | null
  | undefined
  | Plain[]
  | { [key: string]: Plain };

export function guarded<Value extends Plain>(value: Value): Value {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const copy = Array.isArray(value)
    ? value.map((inner: Plain) => guarded(inner))
    : Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, guarded(inner)]));
  const proxy = new Proxy(copy, {
    set: writeRefused,
    deleteProperty: writeRefused,
    defineProperty: writeRefused,
  });
  // SAFETY: the copy keeps the keys and values of the original, so it has the same shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return proxy as Value;
}
