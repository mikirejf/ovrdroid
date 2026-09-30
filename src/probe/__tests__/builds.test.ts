import { describe, expect, test } from 'bun:test';

import type { Rebase, RebaseStatus } from '../../patch/rebase.ts';
import { judgeBuild } from '../builds.ts';

function rebase(name: string, status: RebaseStatus, extra: Partial<Rebase> = {}): Rebase {
  return {
    name,
    status,
    renames: {},
    find: 'x',
    replace: 'y',
    unresolved: [],
    collisions: [],
    matches: 1,
    ...extra,
  };
}

describe('judgeBuild', () => {
  test('says every patch applies when each one rebased or was unchanged', () => {
    const verdict = judgeBuild('darwin-arm64', '0.228.0', [
      rebase('a', 'unchanged'),
      rebase('b', 'rebased', { renames: { x: 'z' } }),
    ]);

    expect(verdict).toEqual({
      line: 'darwin-arm64  0.228.0  all 2 patches apply',
      drifts: false,
    });
  });

  test('names each patch that drifted with the reason apply would give', () => {
    const verdict = judgeBuild('linux-x64', '0.230.0', [
      rebase('a', 'unchanged'),
      rebase('gone', 'missing', { matches: 0 }),
      rebase('loose', 'unresolved', { unresolved: ['q', 'r'] }),
      rebase('twice', 'ambiguous', { matches: 2 }),
    ]);

    expect(verdict).toEqual({
      line: 'linux-x64  0.230.0  3 patches drift: gone (missing), loose (free names: q r), twice (2 places match)',
      drifts: true,
    });
  });

  test('says one patch drifts in the singular', () => {
    const verdict = judgeBuild('linux-x64', '0.228.0', [rebase('gone', 'no-tail')]);

    expect(verdict.line).toBe('linux-x64  0.228.0  1 patch drifts: gone (no-tail)');
    expect(verdict.drifts).toBe(true);
  });
});
