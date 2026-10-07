import { describe, expect, test } from 'bun:test';

import { errorPatches } from '../error-patches.ts';

interface ErrorKey {
  key: string;
  params: { message: string; detailSuffix: string; guidance?: string };
}

type PickKey = (status: string | undefined, message: string, suffix: string) => ErrorKey;

const patch = errorPatches.find(
  (candidate) => candidate.name === 'explain-thinking-replay-rejection',
);
if (patch === undefined) {
  throw new TypeError('explain-thinking-replay-rejection is missing from the error patches');
}

function buildPicker(): PickKey {
  // SAFETY: the body is the payload in front of the stock 400 return, followed by the stock tail of the shipped function.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion
  return new Function(
    'f',
    'l',
    'E',
    `${patch?.replace};return{key:"errors:agent.byokErrorGeneric",params:{message:l,detailSuffix:E}}`,
  ) as PickKey;
}

const pick = buildPicker();

const THINKING_ERROR =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.3.content.1: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified."}}';

describe('thinking replay rejection', () => {
  test('gets the plain explanation', () => {
    const result = pick('400', THINKING_ERROR, ' (x)');
    expect(result.key).toBe('errors:agent.byokErrorProviderMismatch');
    expect(result.params.message).toBe(THINKING_ERROR);
    expect(result.params.detailSuffix).toBe(' (x)');
    expect(result.params.guidance).toContain('/rewind-conversation');
    expect(result.params.guidance).toContain('server-side fallback');
  });

  test('wins even when the status is missing', () => {
    expect(pick(undefined, THINKING_ERROR, '').key).toBe('errors:agent.byokErrorProviderMismatch');
  });

  test('an ordinary 400 keeps the stock key', () => {
    expect(pick('400', 'messages: text content blocks must be non-empty', '').key).toBe(
      'errors:agent.byokError400',
    );
  });

  test('another status keeps the generic key', () => {
    expect(pick('500', 'overloaded', '').key).toBe('errors:agent.byokErrorGeneric');
  });
});
