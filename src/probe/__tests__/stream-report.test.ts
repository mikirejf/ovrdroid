import { describe, expect, test } from 'bun:test';

import type { Sample } from '../idle.ts';
import type { StreamReading } from '../stream-report.ts';
import { formatRuns, readStream, treeCpuMs } from '../stream-report.ts';
import { STUB_END } from '../stub-model.ts';

function sample(pid: number, cpuMs: number): Sample {
  return { pid, atMs: 0, cpuMs, rssKib: 0 };
}

function reading(frames: number, bytes: number): StreamReading {
  return { cpuMs: 500, wallMs: 1000, askMs: 100, lagMs: 50, frames, bytes, streamMs: 900 };
}

describe('treeCpuMs', () => {
  test('adds what each process spent, counting a process born mid-run from zero', () => {
    const head = [sample(1, 1000), sample(2, 300)];
    const tail = [sample(1, 1400), sample(2, 350), sample(3, 20)];
    expect(treeCpuMs(head, tail)).toBe(470);
  });
});

describe('readStream', () => {
  test('times the run to the frame where the reply ends, not a later status redraw', () => {
    const result = readStream({
      frames: [
        { atMs: 10, text: 'Streaming...' },
        { atMs: 1200, text: `   ${STUB_END}` },
        { atMs: 1250, text: `   ${STUB_END}` },
        { atMs: 3000, text: '│ >' },
      ],
      bytes: 5000,
      head: [sample(1, 100)],
      tail: [sample(1, 400)],
      streamStartMs: 200,
      streamEndMs: 1100,
    });
    expect(result).toEqual({
      cpuMs: 300,
      wallMs: 1200,
      askMs: 200,
      lagMs: 100,
      frames: 4,
      bytes: 5000,
      streamMs: 900,
    });
  });

  test('fails when no frame shows the end of the reply', () => {
    expect(() =>
      readStream({
        frames: [{ atMs: 5, text: 'Streaming...' }],
        bytes: 10,
        head: [],
        tail: [],
        streamStartMs: 0,
        streamEndMs: 0,
      }),
    ).toThrow('never showed in a frame');
  });
});

describe('formatRuns', () => {
  test('prints one line per metric and the bytes each frame cost', () => {
    const text = formatRuns('/tmp/a', [reading(40, 81_920)]);
    expect(text).toContain('/tmp/a');
    expect(text).toContain('cpu');
    expect(text).toContain('frames');
    expect(text).toContain('80.0 KB in 40 frames, 2.0 KB per frame');
  });
});
