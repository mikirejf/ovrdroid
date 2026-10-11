import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseLag } from '../../probe/lag.ts';
import { HEAP_ANCHOR, heapPatches } from '../heap-patches.ts';
import { LAG_TICK_MS, LAG_VARIABLE, lagPatches } from '../lag-patches.ts';
import { tokenize } from '../tokens.ts';
import { patchNamed } from './payload.ts';

const meter = patchNamed(lagPatches, 'lag-meter');
const BLOCK_MS = 400;
const RUN_MS = 1500;

function runPayload(file?: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'lag-patch-'));
  try {
    const script = path.join(dir, 'run.js');
    const payload = meter.replace.replace(HEAP_ANCHOR, '');
    writeFileSync(
      script,
      [
        payload,
        `setTimeout(()=>{const end=performance.now()+${BLOCK_MS};while(performance.now()<end);},200);`,
        `setTimeout(()=>{},${RUN_MS});`,
      ].join('\n'),
    );
    const env = Object.fromEntries(
      Object.entries(Bun.env).filter(([name]) => name !== LAG_VARIABLE),
    );
    const result = Bun.spawnSync([process.execPath, script], {
      env: file === undefined ? env : { ...env, [LAG_VARIABLE]: file },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the lag meter patch stays anchored and name-proof', () => {
  test('it anchors on the same literal as the heap sampler, which both keep in front of their code', () => {
    expect(meter.find).toBe(HEAP_ANCHOR);
    expect(meter.replace.startsWith(HEAP_ANCHOR)).toBe(true);
    expect(heapPatches[0]?.find).toBe(HEAP_ANCHOR);
  });

  test('it stays silent unless the file variable is set', () => {
    expect(meter.replace).toContain(`process.env.${LAG_VARIABLE}`);
    expect(meter.replace).toContain('if(!$ODfile)return 0');
  });

  test('its timer never keeps the process alive', () => {
    expect(meter.replace).toContain('.unref()');
    expect(meter.replace).toContain(`},${LAG_TICK_MS}).unref()`);
  });

  test('it has no short or free name for the rebase to chase: every name it owns starts with $OD', () => {
    const holes = tokenize(meter.replace.replace(HEAP_ANCHOR, ''))
      .filter((token) => token.kind === 'ident')
      .map((token) => token.text);
    expect(holes).toEqual([]);
    expect(meter.replace).toContain('$ODlates');
  });

  test('it does not use the free global Bun, which the rebase cannot resolve', () => {
    expect(meter.replace).not.toMatch(/(?<![.\w$])Bun\./u);
  });
});

describe('the lag meter payload run for real', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lag-rows-'));
  const file = path.join(dir, 'lag.jsonl');
  runPayload(file);
  const log = parseLag(readFileSync(file, 'utf-8'));
  rmSync(dir, { recursive: true, force: true });
  const rows = [...log.series.values()].flat();

  test("it writes a row for the second the loop was blocked in, under this machine's pid", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pid).toBeGreaterThan(0);
    expect(rows[0]?.n).toBeGreaterThan(5);
  });

  test('the block shows as lateness and as busy time', () => {
    const [row] = rows;
    expect(row?.max).toBeGreaterThan(BLOCK_MS * 0.7);
    expect(row?.max).toBeLessThan(BLOCK_MS * 2);
    expect(row?.p50).toBeLessThan(BLOCK_MS / 4);
    expect(row?.busy).toBeGreaterThan(0.3);
    expect(row?.busy).toBeLessThanOrEqual(1);
  });

  test('without the file variable nothing is written and nothing fails', () => {
    runPayload();
  });
});
