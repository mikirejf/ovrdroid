import { describe, expect, test } from 'bun:test';

import { MESSAGES_HOOK, STATE_HOOK } from '../../patch/render-profile-patches.ts';
import type { DayComponent, DayFile } from '../renders-log.ts';
import { formatLog, parseDayFile, recentDays, sumDays } from '../renders-log.ts';

function component(over: Partial<DayComponent>): DayComponent {
  return {
    name: 'Row',
    source: 'function(){return 1}',
    renders: 0,
    selfMs: 0,
    reasons: {},
    props: {},
    ...over,
  };
}

function dayFile(over: Partial<DayFile>): DayFile {
  return { pid: 1, day: '2026-10-11', commits: 0, renderMs: 0, walkMs: 0, components: [], ...over };
}

describe('reading a day file', () => {
  test('reads what the daily sink writes', () => {
    const written = {
      ...dayFile({ commits: 2, components: [component({ renders: 3, reasons: { mount: 3 } })] }),
      first: 1,
      last: 2,
    };
    expect(parseDayFile(JSON.stringify(written))?.components[0]?.renders).toBe(3);
  });

  test('a half-written or foreign file is not a day file', () => {
    expect(parseDayFile('{"pid":1')).toBeUndefined();
    expect(parseDayFile(JSON.stringify({ ...dayFile({}), components: [{ name: 'Row' }] }))).toBe(
      undefined,
    );
    expect(parseDayFile('[]')).toBeUndefined();
  });
});

describe('the days to read', () => {
  test('counts back in local days from today, oldest first, across a month end', () => {
    expect(recentDays(new Date(2026, 10, 2, 0, 30), 3)).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});

describe('summing day files', () => {
  const list = component({
    name: 'List',
    source: 'function(){return list}',
    renders: 4,
    selfMs: 9,
    reasons: { props: 3, parent: 1 },
    props: { items: 3 },
  });
  const files = [
    dayFile({
      pid: 10,
      commits: 5,
      renderMs: 20,
      walkMs: 1,
      components: [list, component({ renders: 6, selfMs: 2, reasons: { parent: 6 } })],
    }),
    dayFile({
      pid: 11,
      day: '2026-10-10',
      commits: 3,
      renderMs: 10,
      walkMs: 0.5,
      components: [{ ...list, renders: 2, selfMs: 4, reasons: { parent: 2 }, props: {} }],
    }),
  ];

  test('adds the same component across processes and days, keyed by its code', () => {
    const summary = sumDays(files);
    expect(summary.days).toEqual(['2026-10-10', '2026-10-11']);
    expect(summary.processes).toBe(2);
    expect(summary.commits).toBe(8);
    expect(summary.renders).toBe(12);
    expect(summary.unchanged).toBe(9);
    expect(summary.components.map(({ name, renders, selfMs }) => [name, renders, selfMs])).toEqual([
      ['List', 6, 13],
      ['Row', 6, 2],
    ]);
    expect(summary.components[0]?.reasons).toEqual({ props: 3, parent: 3 });
  });

  test('two components with one name but different code stay apart', () => {
    const other = component({ source: 'function(){return 2}', renders: 1, selfMs: 1 });
    const summary = sumDays([
      dayFile({ commits: 1, components: [component({ renders: 1 }), other] }),
    ]);
    expect(summary.components).toHaveLength(2);
  });

  test('the printout states what it covers, then ranks by self time with shares and causes', () => {
    const places = new Map([['function(){return list}', { place: 'chunk-a.js:3', others: 0 }]]);
    expect(formatLog(sumDays(files), places, 1)).toEqual([
      '2 days with recordings from 2026-10-10 to 2026-10-11: 2 Droid processes, 8 commits, 12 component renders',
      '9 of the renders (75%) had nothing changed: the parent rendered and props, state and context stayed equal',
      'React measured 30.0ms of render time; walking the tree to record it cost 1.5ms more',
      '  1. List (chunk-a.js:3): 6 renders, 3 (50%) with nothing changed but the parent, 13.0ms self; causes: props 3 (items 3), parent 3',
    ]);
  });

  test('no files say there is nothing recorded', () => {
    expect(formatLog(sumDays([]), new Map(), 5)).toEqual(['no recorded renders in these days']);
  });
});

describe('activities, state hooks and message snapshot causes', () => {
  const READER =
    '()=>{if(!f||!y)return t3;let D=f.getSessionManager(y);if(!D)return t3;let{snapshotVersion:O}';
  const root = component({
    name: 'App',
    source: 'function App(){return root}',
    renders: 10,
    selfMs: 20,
    reasons: { state: 10 },
    activities: { streaming: [8, 16], idle: [2, 4] },
    hooks: { 37: 9, 2: 1 },
    hookLabels: { 37: [MESSAGES_HOOK, READER], 2: [STATE_HOOK, 'object {prState,url}'] },
    snapshots: {
      message_thread_updated: 5,
      metadata_updated: 3,
      'settings_updated+working_state_changed': 1,
    },
    sameSnapshots: { metadata_updated: 3 },
  });
  const file = dayFile({
    commits: 10,
    renderMs: 25,
    activities: {
      streaming: { commits: 8, renderMs: 20, renders: 40 },
      idle: { commits: 2, renderMs: 5, renders: 4 },
    },
    components: [root],
  });

  test('a file written before these fields still reads, and a malformed new field does not', () => {
    expect(parseDayFile(JSON.stringify(dayFile({ components: [component({})] })))).toBeDefined();
    expect(parseDayFile(JSON.stringify(file))?.components[0]?.hookLabels?.[37]).toEqual([
      MESSAGES_HOOK,
      READER,
    ]);
    const broken = { ...file, components: [{ ...root, hookLabels: { 37: 'store' } }] };
    expect(parseDayFile(JSON.stringify(broken))).toBeUndefined();
  });

  test('sums activities across files, and keeps old files out of the activity count', () => {
    const summary = sumDays([file, file, dayFile({ commits: 4, components: [] })]);
    expect(summary.activities.get('streaming')).toEqual({ commits: 16, renderMs: 40, renders: 80 });
    expect(summary.components[0]?.hooks).toEqual({ 37: 18, 2: 2 });
    expect(summary.components[0]?.activityRenders).toEqual({ streaming: 16, idle: 4 });
  });

  test('the printout breaks commits down by activity and the root down by hook and cause', () => {
    const places = new Map([[READER, { place: 'chunk-b.js:40', others: 0 }]]);
    const lines = formatLog(sumDays([file]), places, 1);
    expect(lines.slice(3)).toEqual([
      'commits by what Droid was doing: streaming 8 (80%) with 20.0ms of render time and 40 component renders; idle 2 (20%) with 5.0ms of render time and 4 component renders',
      '  1. App (not found in the bundle): 10 renders, 0 (0%) with nothing changed but the parent, 20.0ms self; causes: state 10',
      '     renders by activity: streaming 8 (16.0ms self), idle 2 (4.0ms self)',
      `     state hooks that changed, by place in the hook list: hook 37 (the message snapshot, a useSyncExternalStore reading ${JSON.stringify(`${READER.slice(0, 60)}…`)} at chunk-b.js:40) 9; hook 2 (useState or useReducer holding object {prState,url}) 1`,
      '     message snapshot changes: 9, by the store events since the one before: message_thread_updated 5, metadata_updated 3, settings_updated + working_state_changed 1',
      '     4 of them (44%) came with no message event (no message_thread_updated, no reply text), and 3 of those held the same messages by a cheap check (same ids, same blocks or block text lengths)',
    ]);
  });
});
