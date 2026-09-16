import { describe, expect, test } from 'bun:test';

import { readHighlight } from '../highlight.ts';
import type { Frame } from '../session.ts';

function frames(...texts: string[]): Frame[] {
  return texts.map((text, atMs) => ({ atMs, text }));
}

describe('readHighlight', () => {
  test('reads a rendered code block as a reply without a crash', () => {
    expect(readHighlight(frames('thinking', '  console.log(1);'))).toEqual({
      replied: true,
      crashed: false,
      missing: [],
    });
  });

  test('names each chunk the crash could not load, once', () => {
    const reading = readHighlight(
      frames(
        "  ERROR  Cannot find module './chunk-rtvffc3p.js'",
        "Startup failed: Cannot find module './chunk-rtvffc3p.js'",
        "Cannot find module './chunk-wf88n156.js'",
      ),
    );

    expect(reading.crashed).toBe(true);
    expect(reading.missing).toEqual(['./chunk-rtvffc3p.js', './chunk-wf88n156.js']);
  });

  test('reports neither a reply nor a crash while the model is still working', () => {
    expect(readHighlight(frames('⛬ Working'))).toEqual({
      replied: false,
      crashed: false,
      missing: [],
    });
  });
});
