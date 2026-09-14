import { describe, expect, test } from 'bun:test';

import { FOOTER_TEXT, LOADING_TEXT, readFrames } from '../menu.ts';
import { plain } from '../session.ts';

function frame(text: string, atMs = 0) {
  return { atMs, text };
}

describe('readFrames counts what the eye would see', () => {
  test('loading frames are counted once the colour codes are stripped', () => {
    const frames = [
      frame(plain(`\u001B[2m${LOADING_TEXT} and skills\u001B[0m`)),
      frame('quiet'),
      frame(LOADING_TEXT),
    ];
    expect(readFrames(frames).loadingFrames).toBe(2);
  });

  test('a lingering footer in the first frame of an open is caught', () => {
    const reading = readFrames([frame(`something ${FOOTER_TEXT}`), frame('menu')]);
    expect(reading.footerFirstFrame).toBe(true);
    expect(reading.footerLastFrame).toBe(false);
  });

  test('a footer restored by the last frame of a close is caught', () => {
    const reading = readFrames([frame('menu'), frame(`something ${FOOTER_TEXT}`)]);
    expect(reading.footerFirstFrame).toBe(false);
    expect(reading.footerLastFrame).toBe(true);
  });

  test('an empty frame list makes no claims either way', () => {
    const reading = readFrames([]);
    expect(reading.footerFirstFrame).toBe(false);
    expect(reading.footerLastFrame).toBe(false);
    expect(reading.totalFrames).toBe(0);
  });

  test('the menu listing a known command is detected', () => {
    expect(readFrames([frame('/delegate  Carve the task')]).listsCommands).toBe(true);
    expect(readFrames([frame('empty')]).listsCommands).toBe(false);
  });
});
