import { describe, expect, test } from 'bun:test';

import { cutFrames, plain } from '../src/session.ts';

const END = '\u001B[?2026l';

describe('cutFrames splits on the synchronised-update marker', () => {
  test('a whole frame is returned and the buffer drained', () => {
    const cut = cutFrames(`one${END}`);
    expect(cut.frames).toEqual(['one']);
    expect(cut.rest).toBe('');
  });

  test('a partial frame is held back for the next chunk', () => {
    const cut = cutFrames(`one${END}two`);
    expect(cut.frames).toEqual(['one']);
    expect(cut.rest).toBe('two');
  });

  test('several frames in one chunk all come out', () => {
    expect(cutFrames(`a${END}b${END}c${END}`).frames).toEqual(['a', 'b', 'c']);
  });

  test('a chunk with no marker yields nothing yet', () => {
    const cut = cutFrames('still drawing');
    expect(cut.frames).toEqual([]);
    expect(cut.rest).toBe('still drawing');
  });
});

describe('plain strips terminal control sequences', () => {
  test('colour codes go and the words stay', () => {
    expect(plain('\u001B[31mred\u001B[0m')).toBe('red');
  });

  test('window title sequences go too', () => {
    expect(plain('\u001B]0;title\u0007body')).toBe('body');
  });
});
