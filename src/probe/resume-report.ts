import type { Series } from './ab.ts';
import { summarise } from './ab.ts';
import type { Measure } from './regressions.ts';
import type { Frame } from './session.ts';

const TRUST_PROMPT = 'Trust this folder?';
const BOX_BOTTOM_LEFT = '╰';

export interface ResumeReading {
  paintMs: number;
  landedMs: number;
  settledMs: number;
  frames: number;
  bytes: number;
}

export interface RedrawReading {
  settledMs: number;
  frames: number;
  bytes: number;
  cpuMs: number;
}

export interface ResumeRun extends ResumeReading {
  cpuMs: number;
  redraw: RedrawReading;
}

export interface ResumeInputs {
  marker: string;
  spawnOffsetMs: number;
  bytes: number;
}

export function asksForTrust(frames: readonly Frame[]): boolean {
  return frames.some((frame) => frame.text.includes(TRUST_PROMPT));
}

export function readResume(frames: readonly Frame[], inputs: ResumeInputs): ResumeReading {
  const paint = frames.find((frame) => frame.text.includes(BOX_BOTTOM_LEFT));
  const landed = frames.find((frame) => frame.text.includes(inputs.marker));
  const last = frames.at(-1);
  if (paint === undefined || landed === undefined || last === undefined) {
    throw new Error(
      `the last fixture reply (${inputs.marker}) never showed in ${frames.length} frames`,
    );
  }
  return {
    paintMs: paint.atMs - inputs.spawnOffsetMs,
    landedMs: landed.atMs - inputs.spawnOffsetMs,
    settledMs: last.atMs - inputs.spawnOffsetMs,
    frames: frames.length,
    bytes: inputs.bytes,
  };
}

export interface RedrawInputs {
  marker: string;
  cols: number;
  bytes: number;
  cpuMs: number;
}

function boxBottom(cols: number): string {
  return `${BOX_BOTTOM_LEFT}${'─'.repeat(cols - 2)}╯`;
}

export function redrawn(frames: readonly Frame[], marker: string, cols: number): boolean {
  const border = boxBottom(cols);
  return frames.some((frame) => frame.text.includes(marker) && frame.text.includes(border));
}

export function readRedraw(frames: readonly Frame[], inputs: RedrawInputs): RedrawReading {
  const last = frames.at(-1);
  if (last === undefined || !redrawn(frames, inputs.marker, inputs.cols)) {
    throw new Error(
      `no frame at ${inputs.cols} columns reached the last fixture reply (${inputs.marker}) in ${frames.length} frames`,
    );
  }
  return { settledMs: last.atMs, frames: frames.length, bytes: inputs.bytes, cpuMs: inputs.cpuMs };
}

export interface ResumeLayout {
  turns: number;
  quietMs: number;
  resizeCols: number;
}

export function formatResume(runs: readonly ResumeRun[], layout: ResumeLayout): string {
  const pick = (choose: (run: ResumeRun) => number) => summarise(runs.map((run) => choose(run)));
  const pickRedraw = (choose: (redraw: RedrawReading) => number) =>
    summarise(runs.map((run) => choose(run.redraw)));
  return [
    `  input box   ${pick((run) => run.paintMs)}  ms after spawn`,
    `  transcript  ${pick((run) => run.landedMs)}  ms after spawn, when the last of ${layout.turns} turns showed`,
    `  settled     ${pick((run) => run.settledMs)}  ms after spawn, the last output before ${layout.quietMs}ms of quiet`,
    `  frames      ${pick((run) => run.frames)}  frames drawn up to settled`,
    `  written     ${pick((run) => run.bytes)}  bytes written to the terminal up to settled`,
    `  cpu         ${pick((run) => run.cpuMs)}  ms of Droid CPU from spawn to settled`,
    `  resize      ${pickRedraw((redraw) => redraw.settledMs)}  ms from the resize to ${layout.resizeCols} columns until the redrawn transcript went quiet`,
    `              ${pickRedraw((redraw) => redraw.frames)}  frames in that redraw`,
    `              ${pickRedraw((redraw) => redraw.bytes)}  bytes in that redraw`,
    `              ${pickRedraw((redraw) => redraw.cpuMs)}  ms of Droid CPU for that redraw`,
  ].join('\n');
}

export function seriesOf(
  results: Series<ResumeRun>,
  choose: (run: ResumeRun) => number,
): Series<number> {
  return results.map(([binary, runs]) => [binary, runs.map((run) => choose(run))]);
}

export const RESUME_WALL_FLOOR_MS = 20;
export const RESUME_CPU_FLOOR_MS = 50;

export function resumeMeasures(results: Series<ResumeRun>): Measure[] {
  return [
    {
      label: 'input box',
      series: seriesOf(results, (run) => run.paintMs),
      floor: RESUME_WALL_FLOOR_MS,
    },
    {
      label: 'transcript shown',
      series: seriesOf(results, (run) => run.landedMs),
      floor: RESUME_WALL_FLOOR_MS,
    },
    {
      label: 'settled',
      series: seriesOf(results, (run) => run.settledMs),
      floor: RESUME_WALL_FLOOR_MS,
    },
    {
      label: 'resume cpu',
      series: seriesOf(results, (run) => run.cpuMs),
      floor: RESUME_CPU_FLOOR_MS,
    },
    {
      label: 'resize redraw',
      series: seriesOf(results, (run) => run.redraw.settledMs),
      floor: RESUME_WALL_FLOOR_MS,
    },
  ];
}
