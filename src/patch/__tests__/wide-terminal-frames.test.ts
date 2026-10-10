import { describe, expect, test } from 'bun:test';

import { freeNames } from '../tokens.ts';
import { wideTerminalPatches } from '../wide-terminal-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { helpersWith, patched } from './wide-terminal-harness.ts';

interface InkFrame {
  output: string;
  outputHeight: number;
  staticOutput: string;
}

interface Rendered {
  centered: InkFrame;
  seen: unknown[];
}

type Render = (root: unknown, screenReader: unknown) => InkFrame;

const FRAME_STOCK = 'return ep(this.rootNode,this.isScreenReaderEnabled)';

function frameThrough(setting: string, columns: number, frame: InkFrame): Rendered {
  const seen: unknown[] = [];
  const helpers = helpersWith(setting, { columns });
  const render: Render = (...args) => {
    seen.push(...args);
    return frame;
  };
  const centered = payloadFunction<[Render, object], InkFrame>(
    ['ep', 'globalThis'],
    patched(FRAME_STOCK, 'wide-terminal-center-frame'),
  ).call({ rootNode: 'root', isScreenReaderEnabled: false }, render, {
    __odCenterText: helpers.centerText,
  });
  return { centered, seen };
}

describe('the Ink frame', () => {
  test('the output and the scrollback text both move right', () => {
    const { centered } = frameThrough('100', 200, {
      output: 'a\n\nb',
      outputHeight: 3,
      staticOutput: 'old\n',
    });
    expect(centered.output).toBe(`${' '.repeat(50)}a\n\n${' '.repeat(50)}b`);
    expect(centered.staticOutput).toBe(`${' '.repeat(50)}old\n`);
  });

  test('the frame height is unchanged and the renderer still gets its two arguments', () => {
    const { centered, seen } = frameThrough('100', 200, {
      output: 'a\nb',
      outputHeight: 2,
      staticOutput: '\n',
    });
    expect(centered.outputHeight).toBe(2);
    expect(seen).toEqual(['root', false]);
  });

  test('a terminal at or under the width leaves the frame text alone', () => {
    const { centered } = frameThrough('100', 100, {
      output: 'a',
      outputHeight: 1,
      staticOutput: 'old\n',
    });
    expect([centered.output, centered.staticOutput]).toEqual(['a', 'old\n']);
  });
});

const PAINT_STOCK =
  'let e=sne({handoff:i,width:Math.max(1,r.columns??80),height:Math.max(1,r.rows??36),tuiDebug:g?.tuiDebug,windowsLike:F}),' +
  `t=u?L1(s):\`\${Me.HIDE_CURSOR}\\x1B[J\`;r.write(\`\${t}\${e.output}\`),s=e.rows`;

const COMPOSER_STOCK =
  'let e=dj({handoff:i,width:Math.max(1,r.columns??80),windowsLike:F}),t=Math.max(0,s-R-S);' +
  `r.write(\`\${L1(s-R)}\${Rj(e,!0)}\${\`\n\`.repeat(t)}\`)`;

interface Stream {
  columns: number;
  rows: number;
  write: (text: string) => void;
}

interface Run {
  written: string[];
  widths: number[];
}

interface Layout {
  width: number;
}

interface Started {
  stream: Stream;
  run: Run;
}

interface SplashGlobals {
  __odBoxWidth: (cols: number) => number;
  __odCenterText: (text: string) => string;
}

function streamRun(columns: number): Started {
  const run: Run = { written: [], widths: [] };
  const stream: Stream = {
    columns,
    rows: 40,
    write: (text) => {
      run.written.push(text);
    },
  };
  return { stream, run };
}

function globalsFor(setting: string, columns: number): SplashGlobals {
  const helpers = helpersWith(setting, { columns });
  return { __odBoxWidth: helpers.boxWidth, __odCenterText: helpers.centerText };
}

function paintWith(setting: string, columns: number): Run {
  const { stream, run } = streamRun(columns);
  payloadFunction<
    [(options: Layout) => { output: string; rows: number }, Stream, object, object],
    unknown
  >(
    ['sne', 'r', 'Me', 'globalThis'],
    `var i,g,F,u=!1,L1=()=>"",s=0;${patched(PAINT_STOCK, 'wide-terminal-early-shell-paint')}`,
  )(
    (options) => {
      run.widths.push(options.width);
      return { output: 'logo\ninput', rows: 2 };
    },
    stream,
    { HIDE_CURSOR: '<hide>' },
    globalsFor(setting, columns),
  );
  return run;
}

function composerWith(setting: string, columns: number): Run {
  const { stream, run } = streamRun(columns);
  payloadFunction<
    [(options: Layout) => string[], Stream, (rows: string[], flag: boolean) => string, object],
    unknown
  >(
    ['dj', 'r', 'Rj', 'globalThis'],
    `var i,F,s=4,R=1,S=2,L1=(n)=>"<up"+n+">";${patched(COMPOSER_STOCK, 'wide-terminal-early-shell-composer')}`,
  )(
    (options) => {
      run.widths.push(options.width);
      return ['typed'];
    },
    stream,
    (rows) => rows.join('|'),
    globalsFor(setting, columns),
  );
  return run;
}

describe('the early startup shell', () => {
  test('the box is laid out at the capped width', () => {
    expect(paintWith('140', 220).widths).toEqual([140]);
  });

  test('a narrow terminal is laid out at its own width', () => {
    expect(paintWith('140', 100).widths).toEqual([100]);
  });

  test('the painted box moves right by half the spare room', () => {
    expect(paintWith('140', 220).written).toEqual([
      `<hide>\u001B[J${' '.repeat(40)}logo\n${' '.repeat(40)}input`,
    ]);
  });

  test('the painted box stays put when centering is off', () => {
    expect(paintWith('0', 220).written).toEqual(['<hide>\u001B[Jlogo\ninput']);
  });

  test('the composer redraw is laid out at the capped width and moves right too', () => {
    const run = composerWith('140', 220);
    expect(run.widths).toEqual([140]);
    expect(run.written).toEqual([`<up3>${' '.repeat(40)}typed\n`]);
  });
});

describe('every wide terminal patch', () => {
  test.each(wideTerminalPatches.map((patch) => patch.name))(
    '%s captures or owns each name of three characters or fewer',
    (name) => {
      const { find, until, lookups, replace } = patchNamed(wideTerminalPatches, name);
      const captured = new Set(freeNames([find, until ?? '', ...(lookups ?? [])].join(';')));
      const stray = freeNames(replace).filter(
        (word) => !word.startsWith('$OD') && !captured.has(word),
      );
      expect(stray).toEqual([]);
    },
  );
});
