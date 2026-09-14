import { describe, expect, test } from 'bun:test';

import type { RmCommand } from '../rm-command.ts';
import type { PathFacts, Zone } from '../rm-facts.ts';
import { decide } from '../rm-policy.ts';

function fact(resolved: string, zone: Zone, over: Partial<PathFacts> = {}): PathFacts {
  return { resolved, zone, exists: true, directory: false, symlink: false, ...over };
}

function unzoned(resolved: string): PathFacts {
  return { resolved, zone: undefined, exists: true, directory: false, symlink: false };
}

const forced: RmCommand = { paths: [], flags: ['-rf'] };
const plain: RmCommand = { paths: [], flags: [] };

describe('decide', () => {
  test('rewrites temp deletions to the canonical paths', () => {
    const decision = decide(forced, [
      fact('/private/tmp/a', 'temp'),
      fact('/private/tmp/b', 'temp'),
    ]);

    expect(decision).toEqual({
      kind: 'allow',
      reason: 'deleting inside the temp directory',
      command: "rm -rf '/private/tmp/a' '/private/tmp/b'",
    });
  });

  test('preserves the original flag tokens and their order', () => {
    const verbose: RmCommand = { paths: [], flags: ['-v', '--recursive', '--force'] };
    const decision = decide(verbose, [fact('/private/tmp/a', 'temp')]);

    expect(decision.kind === 'allow' && decision.command).toBe(
      "rm -v --recursive --force '/private/tmp/a'",
    );
  });

  test('rewrites repo deletions to trash', () => {
    const decision = decide(forced, [fact('/repo/a', 'repo'), fact('/repo/b', 'repo')]);

    expect(decision.kind).toBe('allow');
    expect(decision.kind === 'allow' && decision.command).toStartWith('/usr/bin/trash ');
    expect(decision.kind === 'allow' && decision.command).toContain('/repo/a');
    expect(decision.kind === 'allow' && decision.command).toContain('/repo/b');
  });

  test('drops the rm flags from a trash command', () => {
    const decision = decide(forced, [fact('/repo/a', 'repo')]);

    expect(decision.kind === 'allow' && decision.command).toBe("/usr/bin/trash '/repo/a'");
  });

  test('passes on a symlink in the temp zone', () => {
    expect(decide(forced, [fact('/private/tmp/link', 'temp', { symlink: true })])).toEqual({
      kind: 'pass',
    });
  });

  test('passes on a symlink in the repo zone', () => {
    expect(decide(forced, [fact('/repo/link', 'repo', { symlink: true })])).toEqual({
      kind: 'pass',
    });
  });

  test('passes when only one of several paths is a symlink', () => {
    expect(
      decide(forced, [fact('/repo/a', 'repo'), fact('/repo/link', 'repo', { symlink: true })]),
    ).toEqual({ kind: 'pass' });
  });

  test('passes when zones are mixed', () => {
    expect(decide(forced, [fact('/private/tmp/a', 'temp'), fact('/repo/b', 'repo')])).toEqual({
      kind: 'pass',
    });
  });

  test('passes on an unknown zone', () => {
    expect(decide(forced, [unzoned('/elsewhere/a')])).toEqual({ kind: 'pass' });
  });

  test('passes on a directory without a recursive flag', () => {
    expect(decide(plain, [fact('/repo/dir', 'repo', { directory: true })])).toEqual({
      kind: 'pass',
    });
  });

  test('passes on a missing path without a force flag', () => {
    expect(decide(plain, [fact('/repo/gone', 'repo', { exists: false })])).toEqual({
      kind: 'pass',
    });
  });

  test('ignores a missing path when forced', () => {
    const decision = decide(forced, [
      fact('/repo/gone', 'repo', { exists: false }),
      fact('/repo/here', 'repo'),
    ]);

    expect(decision.kind === 'allow' && decision.command).toBe("/usr/bin/trash '/repo/here'");
  });

  test('leaves a missing temp path out of the rewritten command', () => {
    const decision = decide(forced, [
      fact('/private/tmp/gone', 'temp', { exists: false }),
      fact('/private/tmp/here', 'temp'),
    ]);

    expect(decision.kind === 'allow' && decision.command).toBe("rm -rf '/private/tmp/here'");
  });

  test('passes on a forced delete of nothing at all', () => {
    expect(decide(forced, [fact('/repo/gone', 'repo', { exists: false })])).toEqual({
      kind: 'pass',
    });
  });

  test('passes on no facts', () => {
    expect(decide(forced, [])).toEqual({ kind: 'pass' });
  });

  test('quotes a path containing a single quote', () => {
    const decision = decide(forced, [fact("/repo/it's", 'repo')]);

    expect(decision.kind === 'allow' && decision.command).toBe(
      String.raw`/usr/bin/trash '/repo/it'\''s'`,
    );
  });
});
