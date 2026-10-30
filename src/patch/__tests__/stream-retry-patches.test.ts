import { describe, expect, test } from 'bun:test';

import { streamRetryPatches } from '../stream-retry-patches.ts';

interface StreamEnd {
  sawTerminalEvent: boolean;
  isCustomModel: boolean;
  wasAborted: boolean;
}

type FinishStream = (end: StreamEnd) => void;
type BuildFinish = (oF: () => string, LT: typeof NetworkError) => FinishStream;

const patch = streamRetryPatches.find(
  (candidate) => candidate.name === 'retry-cut-off-custom-replies',
);
if (patch === undefined) {
  throw new TypeError('retry-cut-off-custom-replies is missing from the stream retry patches');
}

class NetworkError extends Error {
  override name = 'NetworkError';

  constructor(init: { cause: string }) {
    super('stream ended early', init);
  }
}

function buildFinish(): FinishStream {
  // SAFETY: the body is the patched guard followed by the stock tail of the shipped function.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion
  const build = new Function('oF', 'LT', `${patch?.replace}return Om`) as BuildFinish;
  return build(() => 'stream ended early', NetworkError);
}

const finish = buildFinish();

function returns(end: StreamEnd): string {
  finish(end);
  return 'returned';
}

function streamEnd(overrides: Partial<StreamEnd>): StreamEnd {
  return { sawTerminalEvent: false, isCustomModel: true, wasAborted: false, ...overrides };
}

describe('retry-cut-off-custom-replies', () => {
  test('a custom model stream that ends without a terminal event throws', () => {
    expect(() => {
      finish(streamEnd({}));
    }).toThrow(NetworkError);
  });

  test('a Factory model stream that ends without a terminal event still throws', () => {
    expect(() => {
      finish(streamEnd({ isCustomModel: false }));
    }).toThrow(NetworkError);
  });

  test('a stream that reached its terminal event returns', () => {
    expect(returns(streamEnd({ sawTerminalEvent: true }))).toBe('returned');
    expect(returns(streamEnd({ sawTerminalEvent: true, isCustomModel: false }))).toBe('returned');
  });

  test('an aborted stream returns', () => {
    expect(returns(streamEnd({ wasAborted: true }))).toBe('returned');
    expect(returns(streamEnd({ wasAborted: true, isCustomModel: false }))).toBe('returned');
  });
});
