import { describe, expect, test } from 'bun:test';

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
const sonnetPatch = named('script-mode-every-model');

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
  'function dQ(t){let r=Ta(B3)?.models,o=_t(t.modelId)?At(t.modelId,C().getCustomModels()):void 0,i=o?Wl(o):void 0;if(!(r?.some((u)=>u===t.modelId||u===i)??!1))return"direct_only";return t.override??"script_only"}';

const RESOLVER_BINDINGS = `
const B3="script_tool_models";
const Ta=(flag)=>flag===B3?{models:["claude-opus-5-5"]}:void 0;
const _t=(id)=>id.startsWith("custom:");
const registry=[
  {id:"custom:droidproxy:sonnet-5-5",model:"claude-sonnet-5-5"},
  {id:"custom:droidproxy:haiku-5-5",model:"claude-haiku-5-5"},
  {id:"custom:droidproxy:api-haiku-5-5",model:"claude-haiku-5-5"},
  {id:"custom:droidproxy:opus-5-5",model:"claude-opus-5-5"},
  {id:"custom:droidproxy:gpt",model:"gpt-6.1-sol"},
  {id:"custom:mine:fast",model:"claude-sonnet-5-5"},
];
const At=(id,models)=>models.find((m)=>m.id===id);
const C=()=>({getCustomModels:()=>registry});
const Wl=(m)=>m.model;
`;

function buildResolver(source: string): Resolve {
  // SAFETY: the body is the shipped mode resolver with its flag store, custom model registry and id helpers stubbed.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(`${RESOLVER_BINDINGS}${source};return dQ`)() as Resolve;
}

const stockMode = buildResolver(STOCK_RESOLVER);
const patchedMode = buildResolver(STOCK_RESOLVER.replace(sonnetPatch.find, sonnetPatch.replace));

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
