import { describe, expect, test } from 'bun:test';

import { copyMenuPatches } from '../copy-menu-patches.ts';
import { patchNamed, payloadFunction, strayNames } from './payload.ts';

const PATCH = patchNamed(copyMenuPatches, 'copy-menu-session-id-first');

interface Row {
  item: string;
  disabled: boolean;
  label: string;
}

function rowsAfterPatch(): Row[] {
  const labels = {
    lastAssistant: 'assistant',
    lastUser: 'user',
    sessionId: 'session',
    fullTranscript: 'transcript',
  };
  const source = `${PATCH.replace}{kind:"quick",item:"full-transcript",disabled:!D,label:O.fullTranscript}]`;
  return payloadFunction<[boolean, boolean, boolean, boolean, typeof labels], Row[]>(
    ['y', 'E', 'A', 'D', 'O'],
    source,
  )(true, true, true, true, labels);
}

describe('the copy menu patch', () => {
  test('captures or owns every short name in the payload', () => {
    expect(strayNames(PATCH)).toEqual([]);
  });

  test('puts the session ID row first and keeps the other rows in order', () => {
    expect(rowsAfterPatch().map((row) => row.item)).toEqual([
      'session-id',
      'last-assistant',
      'last-user',
      'full-transcript',
    ]);
  });
});
