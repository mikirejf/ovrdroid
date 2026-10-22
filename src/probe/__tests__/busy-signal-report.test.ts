import { describe, expect, test } from 'bun:test';

import {
  anyFailed,
  BUSY,
  busyVerdicts,
  chipVerdict,
  describeTimeline,
  describeVerdicts,
  IDLE,
  progressEvents,
} from '../busy-signal-report.ts';
import type { BusyEvidence, Chunk, Recording } from '../busy-signal-report.ts';

const MODEL = 'Stub Stream';
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);

function osc(payload: string): string {
  return `${ESC}]9;${payload}${BEL}`;
}

function chunk(atMs: number, text: string): Chunk {
  return { atMs, text };
}

const MARKS = { prompt: 100, turnEnded: 2000, viewOpen: 3000, finished: 5000, exited: 5500 };

function healthy(): Recording {
  return {
    chunks: [
      chunk(110, `paint ${osc(BUSY)}`),
      chunk(1500, osc(BUSY)),
      chunk(4000, osc(BUSY)),
      chunk(4800, osc(IDLE)),
      chunk(5400, 'bye'),
    ],
    marks: MARKS,
  };
}

function evidence(overrides: Partial<BusyEvidence> = {}): BusyEvidence {
  return {
    finish: healthy(),
    switched: undefined,
    quit: undefined,
    view: ['Droids View', '› Kept · Stub Stream (Dynamic)'],
    ...overrides,
  };
}

const OPTIONAL = { requireView: false };

describe('progressEvents', () => {
  test('reads each progress payload with the time of the chunk that carried it', () => {
    expect(progressEvents(healthy().chunks)).toEqual([
      { atMs: 110, payload: BUSY },
      { atMs: 1500, payload: BUSY },
      { atMs: 4000, payload: BUSY },
      { atMs: 4800, payload: IDLE },
    ]);
  });

  test('joins a payload that was split across two chunks', () => {
    const chunks = [chunk(5, `x${ESC}]9;4;`), chunk(9, `3;${BEL}y`)];
    expect(progressEvents(chunks)).toEqual([{ atMs: 5, payload: BUSY }]);
  });

  test('ignores other OSC 9 messages and other sequences', () => {
    const chunks = [chunk(1, `${osc('notify me')}${ESC}[0m${ESC}]0;title${BEL}`)];
    expect(progressEvents(chunks)).toEqual([]);
  });
});

describe('anyFailed decides the exit code', () => {
  test('a healthy run has no failure', () => {
    expect(anyFailed(busyVerdicts(evidence(), MODEL, OPTIONAL))).toBe(false);
  });

  test('one FAIL among passes is a failure', () => {
    const finish = {
      ...healthy(),
      chunks: [chunk(110, osc(BUSY)), chunk(4900, osc(BUSY))],
    };
    expect(anyFailed(busyVerdicts(evidence({ finish }), MODEL, OPTIONAL))).toBe(true);
  });

  test('a step the probe never reached is a failure, not a skip', () => {
    const finish = { ...healthy(), marks: { prompt: 100 } };
    expect(anyFailed(busyVerdicts(evidence({ finish }), MODEL, OPTIONAL))).toBe(true);
  });
});

describe('busyVerdicts', () => {
  test('passes when the progress stays busy until the sub-agent ends and clears after', () => {
    const verdicts = busyVerdicts(evidence(), MODEL, OPTIONAL);
    expect(verdicts.map((entry) => entry.pass)).toEqual([true, true, true, true, true, true, true]);
  });

  test('fails when no busy payload arrived during the turn', () => {
    const finish = { ...healthy(), chunks: [chunk(4800, osc(IDLE))] };
    const [first] = busyVerdicts(evidence({ finish }), MODEL, OPTIONAL);
    expect(first?.pass).toBe(false);
  });

  test('fails when the turn ending cleared the pane while a sub-agent still ran', () => {
    const finish = {
      ...healthy(),
      chunks: [chunk(110, osc(BUSY)), chunk(1900, osc(IDLE)), chunk(4800, osc(IDLE))],
    };
    const verdicts = busyVerdicts(evidence({ finish }), MODEL, OPTIONAL);
    expect(verdicts[1]?.pass).toBe(false);
    expect(verdicts[1]?.text).toContain('ESC ]9;4;0;');
  });

  test('fails when opening the droids view cleared the pane', () => {
    const finish = {
      ...healthy(),
      chunks: [chunk(110, osc(BUSY)), chunk(2500, osc(IDLE)), chunk(4800, osc(IDLE))],
    };
    const verdicts = busyVerdicts(evidence({ finish }), MODEL, OPTIONAL);
    expect(verdicts[1]?.pass).toBe(true);
    expect(verdicts[2]?.pass).toBe(false);
  });

  test('fails when the pane stays busy after the sub-agent finished', () => {
    const finish = {
      ...healthy(),
      chunks: [chunk(110, osc(BUSY)), chunk(4900, osc(BUSY))],
    };
    const verdicts = busyVerdicts(evidence({ finish }), MODEL, OPTIONAL);
    expect(verdicts.at(-2)?.pass).toBe(false);
    expect(verdicts.at(-1)?.pass).toBe(false);
  });

  test('reports a step the probe never reached instead of passing it', () => {
    const finish = { ...healthy(), marks: { prompt: 100 } };
    const verdicts = busyVerdicts(evidence({ finish }), MODEL, OPTIONAL);
    expect(verdicts.some((entry) => entry.text.includes('never reached'))).toBe(true);
    expect(verdicts.every((entry) => entry.pass)).toBe(false);
  });

  test('skips the droids-view checks when the view is optional and did not open', () => {
    const verdicts = busyVerdicts(evidence({ view: undefined }), MODEL, OPTIONAL);
    expect(verdicts).toHaveLength(5);
  });

  test('fails the droids-view checks when the view is required and did not open', () => {
    const verdicts = busyVerdicts(evidence({ view: undefined }), MODEL, { requireView: true });
    expect(verdicts.filter((entry) => !entry.pass)).toHaveLength(1);
    expect(verdicts.at(3)?.text).toContain('did not open');
  });

  test('adds the session switch check only when that run exists', () => {
    const switched: Recording = {
      chunks: [chunk(110, osc(BUSY)), chunk(2100, osc(IDLE))],
      marks: { prompt: 100, turnEnded: 2000, switched: 2500, exited: 3000 },
    };
    const verdicts = busyVerdicts(evidence({ switched }), MODEL, OPTIONAL);
    expect(verdicts.at(-1)?.pass).toBe(true);
    expect(verdicts.at(-1)?.text).toContain('switching');
  });

  test('fails the switch check when the old session left the pane busy', () => {
    const switched: Recording = {
      chunks: [chunk(110, osc(BUSY))],
      marks: { prompt: 100, turnEnded: 2000, switched: 2500, exited: 3000 },
    };
    expect(busyVerdicts(evidence({ switched }), MODEL, OPTIONAL).at(-1)?.pass).toBe(false);
  });
});

describe('the single clear when the sub-agent finishes', () => {
  const clearsIn = (chunks: readonly Chunk[]) => {
    const verdicts = busyVerdicts(evidence({ finish: { chunks, marks: MARKS } }), MODEL, OPTIONAL);
    return verdicts.find((entry) => entry.text.includes('exactly one'));
  };

  test('passes with one clear and nothing after it', () => {
    expect(clearsIn(healthy().chunks)?.pass).toBe(true);
  });

  test('fails on the idle blip: clear, busy again, clear', () => {
    const blip = [
      chunk(110, osc(BUSY)),
      chunk(4800, osc(IDLE)),
      chunk(5300, osc(BUSY)),
      chunk(5400, osc(IDLE)),
    ];
    const found = clearsIn(blip);
    expect(found?.pass).toBe(false);
    expect(found?.text).toContain('4;3; 4;0; 4;3; 4;0;');
  });

  test('fails when the pane is busy again after the clear', () => {
    expect(
      clearsIn([chunk(110, osc(BUSY)), chunk(4800, osc(IDLE)), chunk(5300, osc(BUSY))])?.pass,
    ).toBe(false);
  });

  test('fails when no clear arrived', () => {
    expect(clearsIn([chunk(110, osc(BUSY))])?.pass).toBe(false);
  });
});

describe('the exit while a sub-agent still runs', () => {
  const marks = { prompt: 100, turnEnded: 2000, exited: 3000 };

  test('passes when the exit wrote a clear', () => {
    const quit: Recording = { chunks: [chunk(110, osc(BUSY)), chunk(2900, osc(IDLE))], marks };
    const last = busyVerdicts(evidence({ quit }), MODEL, OPTIONAL).at(-1);
    expect(last?.pass).toBe(true);
    expect(last?.text).toContain('exited while a sub-agent');
  });

  test('fails when the exit left the pane busy', () => {
    const quit: Recording = { chunks: [chunk(110, osc(BUSY))], marks };
    expect(busyVerdicts(evidence({ quit }), MODEL, OPTIONAL).at(-1)?.pass).toBe(false);
  });
});

describe('chipVerdict', () => {
  test('passes when a row carries the model', () => {
    expect(chipVerdict(['Droids View', `› Kept · ${MODEL} (Dynamic)`], MODEL).pass).toBe(true);
  });

  test('fails when no row does', () => {
    expect(chipVerdict(['Droids View', '› Kept'], MODEL).pass).toBe(false);
  });

  test('fails when the view did not open', () => {
    expect(chipVerdict(undefined, MODEL).pass).toBe(false);
  });
});

describe('describeVerdicts and describeTimeline', () => {
  test('marks each verdict pass or FAIL on its own line', () => {
    const text = describeVerdicts([
      { pass: true, text: 'ok' },
      { pass: false, text: 'bad' },
    ]);
    expect(text).toBe('pass  ok\nFAIL  bad');
  });

  test('lists payloads and phase marks in time order from the prompt', () => {
    const lines = describeTimeline('title', healthy()).split('\n');
    expect(lines[0]).toBe('# title');
    expect(lines[1]).toContain('-- prompt');
    expect(lines[2]).toContain('ESC ]9;4;3;');
    expect(lines.at(-1)).toContain('-- exited');
    expect(lines.some((line) => line.includes('-- viewOpen'))).toBe(true);
  });
});
