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

const OUTER_BINDINGS = 'let I=new Set(["Read"]),b=new Set(["Execute"]),nr={llmId:"Task"};';

const patch = toolSurfacePatches.find((candidate) => candidate.name === 'todo-write-direct');
if (patch === undefined) {
  throw new TypeError('todo-write-direct is missing from the tool surface patches');
}

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

describe('TodoWrite in script_only mode', () => {
  test('the stock gate hides it from the direct list', () => {
    expect(stock('TodoWrite', 'direct', 'script_only')).toBe(false);
  });

  test('is exposed directly', () => {
    expect(patched('TodoWrite', 'direct', 'script_only')).toBe(true);
  });

  test('stays bound inside Script', () => {
    expect(patched('TodoWrite', 'script', 'script_only')).toBe(true);
  });
});

describe('direct_only mode', () => {
  test('keeps TodoWrite on the direct list and out of Script', () => {
    expect(patched('TodoWrite', 'direct', 'direct_only')).toBe(true);
    expect(patched('TodoWrite', 'script', 'direct_only')).toBe(false);
  });
});

describe('every other tool is gated as before', () => {
  test('an ordinary tool stays off the direct list and on the script list', () => {
    expect(patched('Grep', 'direct', 'script_only')).toBe(false);
    expect(patched('Grep', 'script', 'script_only')).toBe(true);
  });

  test.each(['Read', 'Execute', 'Task', 'Grep', 'TodoWriteX', 'todowrite'])(
    '%s matches the stock answer on every mode and surface',
    (toolName) => {
      for (const mode of MODES) {
        for (const surface of SURFACES) {
          expect(patched(toolName, surface, mode)).toBe(stock(toolName, surface, mode));
        }
      }
    },
  );
});
