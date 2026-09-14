import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_FILES } from '../../paths.ts';
import { makeTempDir } from '../../temp.ts';
import { CHURN_KINDS, churnOne, describeChurn, induceChurn } from '../churn.ts';

describe('the churn kinds are complete and described', () => {
  test('every kind has a plain-words description', () => {
    for (const kind of CHURN_KINDS) {
      expect(describeChurn(kind).length).toBeGreaterThan(10);
    }
  });

  test('the config files watched are settings and mcp', () => {
    expect(CONFIG_FILES.map((file) => path.basename(file))).toEqual(['settings.json', 'mcp.json']);
  });
});

describe('churnOne tells a missing file from a failing one', () => {
  test('a missing file is skipped quietly', () => {
    expect(churnOne(path.join(makeTempDir('churn'), 'gone.json'))).toBe(false);
  });

  test('a real chmod is reported as churned', () => {
    const file = path.join(makeTempDir('churn'), 'settings.json');
    writeFileSync(file, '{}', { mode: 0o600 });
    expect(churnOne(file)).toBe(true);
  });

  test('a chmod that cannot work fails loudly instead of faking a churn', () => {
    const notADirectory = path.join(makeTempDir('churn'), 'settings.json');
    writeFileSync(notADirectory, '{}', { mode: 0o600 });
    expect(() => churnOne(path.join(notADirectory, 'nested.json'))).toThrow('churned nothing');
  });
});

describe('induceChurn honours its control kind', () => {
  test('the quiet control waits without touching anything', async () => {
    const started = performance.now();
    await induceChurn('none', { rounds: 2, gapMs: 20, binary: '' });
    expect(performance.now() - started).toBeGreaterThanOrEqual(35);
  });
});
