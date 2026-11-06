import { describe, expect, test } from 'bun:test';

import {
  CONFLICT_COMMIT,
  describeConflict,
  judgeConflict,
  readShield,
  SHIELD_COMMIT,
  shieldPrompt,
} from '../shield.ts';

function stream(...events: object[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

function failedCommit(message: string): string {
  return stream(
    { type: 'tool_call', id: 'c', toolName: 'Execute', parameters: { command: CONFLICT_COMMIT } },
    { type: 'tool_result', id: 'c', isError: true, error: { type: 'tool_error', message } },
  );
}

describe('the merge-conflict staging commit', () => {
  const unscannable = readShield(
    failedCommit('Droid-Shield could not verify the staged changes: git write-tree failed'),
  );
  const gitRefused = readShield(
    failedCommit('error: Committing is not possible because you have unmerged files.'),
  );

  test('the command still contains the commit the reader looks for', () => {
    expect(CONFLICT_COMMIT).toContain(SHIELD_COMMIT);
    expect(shieldPrompt(CONFLICT_COMMIT)).toContain(CONFLICT_COMMIT);
  });

  test('Droid-Shield failing to scan is a false alarm', () => {
    expect(unscannable.outcome).toBe('unscannable');
    expect(judgeConflict(unscannable)).toBe('false alarm');
  });

  test('git running and refusing for its own reason is not a false alarm', () => {
    expect(gitRefused.outcome).toBe('failed');
    expect(judgeConflict(gitRefused)).toBe('git ran');
  });

  test('a command that never ran gives no verdict', () => {
    expect(judgeConflict(readShield(stream({ type: 'completion' })))).toBe('no verdict');
  });

  test('the report names each binary with its verdict', () => {
    const text = describeConflict([
      { label: 'stock', reading: unscannable },
      { label: 'patched', reading: gitRefused },
    ]);
    expect(text).toContain('stock: false alarm');
    expect(text).toContain('patched: git ran');
  });
});
