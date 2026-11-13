import { describe, expect, test } from 'bun:test';

import {
  readScrollView,
  SCROLL_HEADER,
  TAIL_TALLY,
  TALLY,
  TURN_REQUESTS,
} from '../stacked-report.ts';

const HEADER_ROW = ` ${SCROLL_HEADER} · page 1 · Start of history · Alt/Option+↓ newer · Esc to live`;
const STATUS = ['  >', ' Auto (High)                                          Stub Stream'];
const EDIT = ['   Edit a.txt', '    ↳ Succeeded. File edited. (+1 added, -1 removed)'];

const STACKED_VIEW = [
  '   Go through the files.',
  '   Read 1 file › Grep 1 search › Read 1 file › Skill stacked-first › Skill stacked-second ›',
  '   Execute 2 commands (1 failed)',
  ...EDIT,
  `   ${TAIL_TALLY}`,
  HEADER_ROW,
  ...STATUS,
];

const EXPANDED_VIEW = [
  '   Go through the files.',
  '   Read /tmp/work/a.txt',
  '    ↳ Read 1 line',
  '   Grep needle',
  '   Read /tmp/work/b.txt',
  '   Execute true',
  '   Execute false',
  ...EDIT,
  HEADER_ROW,
  ...STATUS,
];

const LIVE_CHAT = [...STACKED_VIEW.slice(0, -4), ...STATUS];

function capture(scrollView?: string[], afterScroll: string[] = LIVE_CHAT) {
  return {
    served: TURN_REQUESTS,
    screen: LIVE_CHAT,
    ...(scrollView !== undefined && { scrollView }),
    afterScroll,
  };
}

function failures(scrollView?: string[], afterScroll?: string[]): string[] {
  return readScrollView(capture(scrollView, afterScroll))
    .filter((finding) => !finding.pass)
    .map((finding) => finding.says);
}

describe('readScrollView', () => {
  test('passes a scroll view that stacks the turn and a live chat after Esc', () => {
    const findings = readScrollView(capture(STACKED_VIEW));
    expect(findings.filter((finding) => !finding.pass)).toEqual([]);
    expect(findings).toHaveLength(4);
  });

  test('fails when the scroll view draws every call expanded', () => {
    const [says] = failures(EXPANDED_VIEW);
    expect(says).toContain(`should draw the turn as one line reading '${TALLY}'`);
    const all = failures(EXPANDED_VIEW).join(' ');
    expect(all).toContain("'Read /tmp/work/a.txt'");
    expect(all).toContain("'Execute true'");
  });

  test('fails a scroll view that draws the stacked line and one expanded row besides', () => {
    const mixed = [...STACKED_VIEW.slice(0, 3), '   Execute true', ...STACKED_VIEW.slice(3)];
    const [says] = failures(mixed);
    expect(says).toBe(
      "the scroll view draws calls expanded, each with its own header: 'Execute true'",
    );
  });

  test('fails when the header never shows, without trusting the live chat behind it', () => {
    const [says, ...rest] = failures(LIVE_CHAT);
    expect(says).toContain(`'${SCROLL_HEADER}' header`);
    expect(rest).toEqual([]);
  });

  test('fails when Esc leaves the header on screen', () => {
    const [says] = failures(STACKED_VIEW, STACKED_VIEW);
    expect(says).toContain('still shows');
  });

  test('fails when Esc leaves no live chat line behind', () => {
    const [says] = failures(STACKED_VIEW, STATUS);
    expect(says).toContain('has no stacked line');
  });

  test('says so when no scroll view frame was captured', () => {
    expect(failures()).toEqual(['no scroll view frame was captured, so it was not tested']);
  });

  test('reports nothing when the turn never ran', () => {
    expect(readScrollView({ served: 0, screen: [] })).toEqual([]);
  });
});
