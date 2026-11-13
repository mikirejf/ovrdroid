import { describe, expect, test } from 'bun:test';

import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { rewindPatches } from '../rewind-patches.ts';
import { occurrences } from './payload.ts';

const stock = Bun.file(backupPath(INSTALLED_DROID));
const modules = (await stock.exists())
  ? readApp(await stock.bytes()).map((module) => module.text)
  : undefined;

describe.skipIf(modules === undefined)('rewind patches on the stock binary', () => {
  const rebased = rebaseAll(rewindPatches, modules ?? []);

  test.each(rebased.map((patch) => [patch.name, patch] as const))(
    '%s rebases independently of the other shipped patches',
    (_name, patch) => {
      expect(applies(patch)).toBe(true);
      expect(
        (modules ?? []).reduce((count, text) => count + occurrences(text, patch.find), 0),
      ).toBe(1);
    },
  );
});
