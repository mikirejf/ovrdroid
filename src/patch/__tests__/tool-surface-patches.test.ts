import { describe, expect, test } from 'bun:test';

import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { holePattern } from '../tokens.ts';
import { toolSurfacePatches } from '../tool-surface-patches.ts';

type Mode = 'direct_only' | 'script_only' | 'mixed';
type Surface = 'direct' | 'script';
type Gate = (call: {
  toolName: string;
  surface: Surface;
  policy: { mode: Mode; allowSubagentsInScripts: boolean };
}) => boolean;

const STOCK_GATE =
  'function Bh({toolName:e,surface:o,policy:t}){if(o==="direct")return t.mode!=="script_only"||I.has(e)||b.has(e)||!t.allowSubagentsInScripts&&e===nr.llmId;if(t.mode==="direct_only")return!1;if(I.has(e)||b.has(e))return!1;return e!==nr.llmId||t.allowSubagentsInScripts}';

const OUTER_BINDINGS = 'let I=new Set(["Skill"]),b=new Set(["Execute"]),nr={llmId:"Task"};';

function named(name: string) {
  const found = toolSurfacePatches.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new TypeError(`${name} is missing from the tool surface patches`);
  }
  return found;
}

const patch = named('todo-write-direct');
const modelPatch = named('script-mode-every-model');

function buildGate(source: string): Gate {
  // SAFETY: the body is the shipped surface gate with its outer sets bound: the always-direct set, the script-bound set and the subagent tool.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(`${OUTER_BINDINGS}${source};return Bh`)() as Gate;
}

type Admits = (toolName: string, surface: Surface, mode: Mode) => boolean;

function admitsWith(gate: Gate): Admits {
  return (toolName, surface, mode) =>
    gate({ toolName, surface, policy: { mode, allowSubagentsInScripts: true } });
}

const stock = admitsWith(buildGate(STOCK_GATE));
const patched = admitsWith(buildGate(STOCK_GATE.replace(patch.find, patch.replace)));

const MODES: readonly Mode[] = ['script_only', 'direct_only', 'mixed'];
const SURFACES: readonly Surface[] = ['direct', 'script'];

const TODO = 'TodoWrite';

describe('TodoWrite in script_only mode', () => {
  test('the stock gate hides it from the direct list', () => {
    expect(stock(TODO, 'direct', 'script_only')).toBe(false);
  });

  test('is exposed directly', () => {
    expect(patched(TODO, 'direct', 'script_only')).toBe(true);
  });

  test('stays bound inside Script', () => {
    expect(patched(TODO, 'script', 'script_only')).toBe(true);
  });
});

describe('TodoWrite in the other modes', () => {
  test('direct_only keeps it on the direct list and out of Script', () => {
    expect(patched(TODO, 'direct', 'direct_only')).toBe(true);
    expect(patched(TODO, 'script', 'direct_only')).toBe(false);
  });

  test('mixed matches the stock answer on both surfaces', () => {
    for (const surface of SURFACES) {
      expect(patched(TODO, surface, 'mixed')).toBe(stock(TODO, surface, 'mixed'));
    }
  });
});

describe('every other tool is gated as before', () => {
  test('an ordinary tool stays off the direct list and on the script list', () => {
    expect(patched('Glob', 'direct', 'script_only')).toBe(false);
    expect(patched('Glob', 'script', 'script_only')).toBe(true);
  });

  test.each([
    'Skill',
    'Execute',
    'Task',
    'Read',
    'Grep',
    'TodoWriteX',
    'todowrite',
    'grep',
    'ReadX',
  ])('%s matches the stock answer on every mode and surface', (toolName) => {
    for (const mode of MODES) {
      for (const surface of SURFACES) {
        expect(patched(toolName, surface, mode)).toBe(stock(toolName, surface, mode));
      }
    }
  });
});

type Resolve = (session: { modelId: string; override?: Mode }) => Mode;

const STOCK_RESOLVER =
  'function tI(t){if(t.override!==void 0)return t.override;let n=uo(AP)?.models,o=yt(t.modelId)?Hp(t.modelId,f().getCustomModels()):t.modelId;return n?.some((s)=>s===t.modelId||s===o)?"script_only":"direct_only"}';

const RESOLVER_BINDINGS = `
const AP="script_tool_models";
const uo=(flag)=>flag===AP&&models!==undefined?{models}:void 0;
const yt=(id)=>id.startsWith("custom:");
const registry=[
  {id:"custom:droidproxy:sonnet-5-5",model:"claude-sonnet-5-5"},
  {id:"custom:droidproxy:haiku-5-5",model:"claude-haiku-5-5"},
  {id:"custom:droidproxy:api-haiku-5-5",model:"claude-haiku-5-5"},
  {id:"custom:droidproxy:opus-5-5",model:"claude-opus-5-5"},
  {id:"custom:droidproxy:gpt",model:"gpt-6.1-sol"},
  {id:"custom:mine:fast",model:"claude-sonnet-5-5"},
];
const Hp=(id,registry)=>registry.find((m)=>m.id===id)?.model;
const f=()=>({getCustomModels:()=>registry});
`;

function buildResolver(source: string, models: readonly string[] | undefined): Resolve {
  // SAFETY: the body is the shipped mode resolver with its flag store, custom model registry and id helpers stubbed.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function('models', `${RESOLVER_BINDINGS}${source};return tI`)(models) as Resolve;
}

const PATCHED_RESOLVER = STOCK_RESOLVER.replace(modelPatch.find, modelPatch.replace);
const stockMode = buildResolver(STOCK_RESOLVER, ['claude-opus-5-5']);
const patchedMode = buildResolver(PATCHED_RESOLVER, ['claude-opus-5-5']);

const SCRIPT_ONLY_PATCHED = [
  'claude-sonnet-5-5',
  'claude-Sonnet-4-20250514',
  'custom:droidproxy:sonnet-5-5',
  'custom:mine:fast',
  'custom:droidproxy:haiku-5-5',
  'custom:droidproxy:api-haiku-5-5',
  'claude-haiku-5-5',
  'claude-Haiku-4-5-20251001',
  'custom:droidproxy:gpt',
  'gpt-6.1-sol',
  'custom:droidproxy:gpt-6-luna',
  'custom:openrouter:inkling-free',
];

describe('script mode', () => {
  test.each([{ models: undefined }, { models: [] }] as const)(
    'ignores an absent or empty model list: %j',
    ({ models }) => {
      expect(buildResolver(STOCK_RESOLVER, models)({ modelId: 'claude-opus-5-5' })).toBe(
        'direct_only',
      );
      expect(buildResolver(PATCHED_RESOLVER, models)({ modelId: 'claude-opus-5-5' })).toBe(
        'script_only',
      );
    },
  );

  test.each(SCRIPT_ONLY_PATCHED)(
    '%s runs script_only patched and direct_only on stock',
    (modelId) => {
      expect(stockMode({ modelId })).toBe('direct_only');
      expect(patchedMode({ modelId })).toBe('script_only');
    },
  );

  test.each(['claude-opus-5-5', 'custom:droidproxy:opus-5-5'])(
    '%s on the remote list stays script_only',
    (modelId) => {
      expect(stockMode({ modelId })).toBe('script_only');
      expect(patchedMode({ modelId })).toBe('script_only');
    },
  );

  test.each<[string, Mode]>([
    ['custom:droidproxy:sonnet-5-5', 'direct_only'],
    ['claude-sonnet-5-5', 'mixed'],
    ['claude-haiku-5-5', 'mixed'],
    ['gpt-6.1-sol', 'direct_only'],
    ['claude-opus-5-5', 'mixed'],
  ])('the override still wins on %s: %s', (modelId, override) => {
    expect(patchedMode({ modelId, override })).toBe(override);
  });
});

const stockBinary = Bun.file(backupPath(INSTALLED_DROID));
const modules = (await stockBinary.exists())
  ? readApp(await stockBinary.bytes()).map((module) => module.text)
  : undefined;

describe.skipIf(modules === undefined)('tool surface patches on the stock binary', () => {
  const rebased = rebaseAll(toolSurfacePatches, modules ?? []);

  test.each(rebased.map((entry) => [entry.name, entry] as const))(
    '%s rebases independently of the other shipped patches',
    (_name, entry) => {
      expect(applies(entry)).toBe(true);
      expect(entry.matches).toBe(1);
    },
  );

  test('the resolver fixture matches stock up to minified names', () => {
    const pattern = new RegExp(holePattern(STOCK_RESOLVER).source, 'gu');
    expect(
      (modules ?? []).reduce((count, text) => count + [...text.matchAll(pattern)].length, 0),
    ).toBe(1);
  });
});
