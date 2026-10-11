import { describe, expect, test } from 'bun:test';

import type { App } from '../../binary/graph.ts';
import { EMBED_PREFIX } from '../../binary/graph.ts';
import { busiestProcess } from '../counters.ts';
import type { CommitLine, Location, RenderTuple } from '../renders.ts';
import {
  formatComponent,
  formatWindow,
  parseRenders,
  placeSource,
  placeSources,
  renderWindow,
  renderWindows,
  summariseWindows,
  typesOf,
} from '../renders.ts';

const APP = 'function App(){return h(Main)}';
const LIST = 'function yc(A){return A.items.map(Row)}';
const ROW = 'function Row(A){return h(Box,A)}';
const OTHER_YC = 'function yc(A){return h(Text,{children:A.label})}';
const LATE = 'function Late(){return null}';

const APP_ID = 1;
const LIST_ID = 2;
const ROW_ID = 3;
const OTHER_YC_ID = 4;
const LATE_ID = 5;

function commit(
  t: number,
  renders: readonly RenderTuple[],
  over: Partial<CommitLine> = {},
): CommitLine {
  return { t, pid: 7, renderMs: 2, walkMs: 0.5, renders, ...over };
}

function text(lines: readonly CommitLine[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

const STREAM: readonly CommitLine[] = [
  commit(100, [[APP_ID, 1, 'mount']], {
    types: [
      [APP_ID, 'App', APP],
      [LIST_ID, 'yc', LIST],
      [ROW_ID, 'Row', ROW],
      [OTHER_YC_ID, 'yc', OTHER_YC],
    ],
  }),
  commit(1000, [
    [LIST_ID, 4, 'props', ['items']],
    [ROW_ID, 1, 'parent'],
    [ROW_ID, 1, 'parent'],
    [OTHER_YC_ID, 2, 'state'],
  ]),
  commit(1100, [
    [LIST_ID, 6, 'props+state', ['items', 'width']],
    [ROW_ID, 1, 'parent'],
  ]),
  commit(5000, [[LATE_ID, 9, 'state']], { types: [[LATE_ID, 'Late', LATE]] }),
];

describe('reading the render file', () => {
  test('keeps whole commit lines and drops a torn or foreign one', () => {
    const torn = `${text(STREAM)}\n{"t":1,"pid":7,"renderMs":1,"walkMs":0,"renders":[["A",1,"mount"]]}\n{"t":2,"pi`;
    expect(parseRenders(torn)).toEqual([...STREAM]);
  });

  test('drops a line whose type descriptions are malformed', () => {
    const bad = '{"t":1,"pid":7,"renderMs":1,"walkMs":0,"renders":[],"types":[[1,"App"]]}';
    expect(parseRenders(bad)).toEqual([]);
  });

  test('takes the process that committed most, not the second Droid', () => {
    const other = commit(1000, [], { pid: 8 });
    expect(busiestProcess([other, ...STREAM]).every((line) => line.pid === 7)).toBe(true);
  });

  test('collects each type description from whichever line first carried it', () => {
    const types = typesOf(STREAM);
    expect(types.get(LATE_ID)).toEqual({ name: 'Late', source: LATE });
    expect(types.size).toBe(5);
  });
});

describe('a render window', () => {
  test('counts only commits inside it, per component type, with its causes and changed props', () => {
    const window = renderWindow(STREAM, { from: 900, to: 1200 });
    expect(window.commits).toBe(2);
    expect(window.renderMs).toBe(4);
    expect(window.walkMs).toBe(1);
    expect(window.components.get(LIST_ID)).toEqual({
      renders: 2,
      selfMs: 10,
      reasons: { props: 2, state: 1 },
      props: { items: 2, width: 1 },
    });
    expect(window.components.get(ROW_ID)).toEqual({
      renders: 3,
      selfMs: 3,
      reasons: { parent: 3 },
      props: {},
    });
    expect(window.components.has(APP_ID)).toBe(false);
  });

  test('two types with the same minified name stay apart', () => {
    const window = renderWindow(STREAM, { from: 900, to: 1200 });
    expect(window.components.get(LIST_ID)?.renders).toBe(2);
    expect(window.components.get(OTHER_YC_ID)?.renders).toBe(1);
  });

  test('a window reads types described before it started', () => {
    const windows = renderWindows(STREAM, {
      stream: { from: 900, to: 1200 },
      late: { from: 4000, to: 6000 },
    });
    expect([...(windows['late']?.components.keys() ?? [])]).toEqual([LATE_ID]);
    expect(windows['stream']?.types.get(ROW_ID)?.name).toBe('Row');
  });

  test('a render of a type nobody described fails loud', () => {
    expect(() => renderWindow([commit(10, [[99, 1, 'mount']])], { from: 0, to: 100 })).toThrow(
      'component type 99',
    );
  });
});

describe('summing runs up', () => {
  const first = renderWindow(STREAM, { from: 900, to: 1200 });
  const second = renderWindow(
    [
      commit(10, [[20, 20, 'props', ['items']]], {
        types: [
          [20, 'yc', LIST],
          [21, 'Other', 'function Other(){}'],
        ],
      }),
      commit(20, [[21, 1, 'mount']]),
    ],
    { from: 0, to: 100 },
  );
  const third = renderWindow([commit(10, [[30, 2, 'parent']], { types: [[30, 'yc', LIST]] })], {
    from: 0,
    to: 100,
  });
  const summary = summariseWindows('stream', [first, second, third]);

  test('matches a component across runs by its code, though its id differs per run', () => {
    const list = summary.components.find((entry) => entry.source === LIST);
    expect(list?.renders).toBe(1);
    expect(list?.selfMs).toBe(10);
    expect(list?.reasons).toEqual({ props: 1, state: 0, parent: 0 });
  });

  test('keeps two components with the same name as two rows', () => {
    const rows = summariseWindows('stream', [first]).components.filter(
      (entry) => entry.name === 'yc',
    );
    expect(rows.map((entry) => entry.source).toSorted()).toEqual([OTHER_YC, LIST].toSorted());
  });

  test('drops a component that rendered in fewer than half the runs', () => {
    expect(summary.components.map((entry) => entry.source)).toEqual([LIST]);
  });

  test('ranks by self time', () => {
    expect(summariseWindows('stream', [first]).components.map((entry) => entry.source)).toEqual([
      LIST,
      ROW,
      OTHER_YC,
    ]);
  });

  test('counts the renders where nothing changed across the whole window', () => {
    expect(summary.runs).toBe(3);
    expect(summary.renders).toBe(2);
    expect(summary.unchanged).toBe(1);
    expect(summariseWindows('stream', [first]).unchanged).toBe(3);
  });

  test('sums separate function objects with the same code, and counts them', () => {
    const recreated = renderWindow(
      [
        commit(10, [[1, 1, 'mount']], { types: [[1, 'Inline', 'function Inline(){}']] }),
        commit(20, [[2, 1, 'mount']], { types: [[2, 'Inline', 'function Inline(){}']] }),
      ],
      { from: 0, to: 100 },
    );
    const [inline] = summariseWindows('stream', [recreated]).components;
    expect(inline?.renders).toBe(2);
    expect(inline?.copies).toBe(2);
  });

  test('refuses to summarise no runs', () => {
    expect(() => summariseWindows('stream', [])).toThrow(
      'the stream summary needs at least one run',
    );
  });
});

describe('placing components by their code', () => {
  const app: App = [
    { name: `${EMBED_PREFIX}entry-a.js`, text: `var x=1;\n${APP}\nvar y=2;` },
    { name: `${EMBED_PREFIX}chunk-b.js`, text: `${ROW};\n\n${ROW}` },
    { name: `${EMBED_PREFIX}chunk-c.js`, text: `\n${ROW}` },
  ];

  test('names the module and line of the one place the code sits', () => {
    expect(placeSource(app, APP)).toEqual({ place: 'entry-a.js:2', others: 0 });
  });

  test('gives the first place and counts the others when the code repeats', () => {
    expect(placeSource(app, ROW)).toEqual({ place: 'chunk-b.js:1', others: 2 });
  });

  test('finds nothing for code the bundle does not hold', () => {
    expect(placeSource(app, LATE)).toBeUndefined();
  });

  test('looks each distinct source up once', () => {
    expect([...placeSources(app, [APP, APP, LATE]).keys()]).toEqual([APP, LATE]);
  });
});

describe('the printed list', () => {
  const summary = summariseWindows('stream', [renderWindow(STREAM, { from: 900, to: 1200 })]);
  const places = new Map<string, Location | undefined>([
    [LIST, { place: 'chunk-a.js:12', others: 0 }],
    [ROW, { place: 'chunk-b.js:9', others: 2 }],
  ]);

  test('says what share of renders had nothing changed, in words', () => {
    const [head, cost] = formatWindow(summary, places, 15);
    expect(head).toBe(
      'stream: median of 1 run, 2 commits, 6 component renders, 3 of them (50%) with nothing changed: the parent rendered and props, state and context stayed equal',
    );
    expect(cost).toBe(
      'React measured 4.0ms of render time; walking the tree to record it cost 1.0ms more',
    );
  });

  test('prints each component with its place, counts, self time and causes', () => {
    const [list, row] = summary.components;
    if (list === undefined || row === undefined) {
      throw new Error('expected two components');
    }
    expect(formatComponent(list, places)).toBe(
      'yc (chunk-a.js:12): 2 renders, 0 (0%) with nothing changed but the parent, 10.0ms self; causes: props 2 (items 2, width 1), state 1',
    );
    expect(formatComponent(row, places)).toBe(
      'Row (chunk-b.js:9, or one of 2 other places with the same code): 3 renders, 3 (100%) with nothing changed but the parent, 3.0ms self; causes: parent 3',
    );
  });

  test('says when the code was not found, and when the component was created anew', () => {
    const [first] = summary.components;
    if (first === undefined) {
      throw new Error('expected a component');
    }
    expect(formatComponent({ ...first, name: 'Inline', source: 'x', copies: 3 }, new Map())).toBe(
      'Inline (not found in the bundle): 2 renders, 0 (0%) with nothing changed but the parent, 10.0ms self; causes: props 2 (items 2, width 1), state 1; 3 separate functions with this code rendered, so the component is created anew',
    );
  });

  test('stops at the top count', () => {
    const lines = formatWindow(summary, places, 1);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toStartWith('  1. yc (chunk-a.js:12): 2 renders');
  });

  test('says plainly when a window rendered nothing', () => {
    const idle = summariseWindows('idle', [renderWindow(STREAM, { from: 2000, to: 3000 })]);
    expect(formatWindow(idle, places, 15)).toEqual([
      'idle: median of 1 run, 0 commits, 0 component renders; nothing rendered',
    ]);
  });
});
