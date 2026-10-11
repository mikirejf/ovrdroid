import { KIB, megabytes, MS_PER_SECOND, whole } from '../cli.ts';
import type { HeapRow, TypeGrowth } from './heap.ts';
import type { Tick } from './sampler.ts';
import type { Point } from './series.ts';
import { isExcluded, maxOf, meanOf, median, sumOf } from './series.ts';
import type { CpuReading } from './subagents-cpu.ts';
import { formatCpu, readCpu } from './subagents-cpu.ts';
import type { Timeline, Work } from './subagents-record.ts';
import { sleepCommand } from './subagents-record.ts';

export const AFTER_FIRST_MS = 12_000;
export const AFTER_LAST_MS = 22_000;
export const DONE_WORD = 'ALLDONE';
const SETTLED_TICKS = 6;
const SETTLED_RATIO = 1.1;

export interface SubagentPromptOptions {
  count: number;
  work: Work;
  sleep: number;
  files: readonly string[];
  type: string;
}

export interface Phase {
  baseline: number;
  peak: number | undefined;
  running: number | undefined;
  after: number | undefined;
}

export interface RunReading {
  count: number;
  runningSeconds: number;
  aliveSeconds: number;
  rss: Phase | undefined;
  footprint: Phase | undefined;
  childRss: Phase | undefined;
  childFootprint: Phase | undefined;
  threads: Phase | undefined;
  cpu: CpuReading;
}

export interface HeapPhases {
  jsHeap: Phase | undefined;
  external: Phase | undefined;
  objects: Phase | undefined;
}

export interface TypeChoice {
  type: string;
  wanted: string;
  fellBack: boolean;
}

const SUMMARY_WORDS = 150;

function workInstruction(options: SubagentPromptOptions): string {
  if (options.work === 'sleep') {
    return `Run the shell command \`${sleepCommand(options.sleep)}\` with the Execute tool, then reply with the single word DONE. Do nothing else.`;
  }
  return `Use the Read tool to read these files in full: ${options.files.join(', ')}. Then reply with a ${SUMMARY_WORDS}-word summary of what they do, then the word DONE. Do nothing else.`;
}

export function subagentPrompt(options: SubagentPromptOptions): string {
  const { count, type } = options;
  const noun = options.work === 'sleep' ? 'sleeper' : 'reader';
  return [
    `Launch exactly ${count} Task tool calls in ONE message, so they run in parallel.`,
    `Every call uses subagent_type "${type}" and its own short description ("${noun} 1" to "${noun} ${count}").`,
    `Every subagent prompt is: ${workInstruction(options)}`,
    `Wait for all ${count} to return. Then reply with the word ALL immediately followed by the word DONE, joined as one word with no space, and nothing else.`,
    'Use no other tools.',
  ].join(' ');
}

export function isFinished(screen: string): boolean {
  return screen.includes(DONE_WORD);
}

export function parseDroidName(markdown: string): string | undefined {
  const header = /^---\n(?<body>[\s\S]*?)\n---/u.exec(markdown)?.groups?.['body'];
  return /^name:\s*(?<name>\S+)\s*$/mu.exec(header ?? '')?.groups?.['name'];
}

export function chooseType(
  wanted: string,
  offered: readonly string[],
  fallback: string,
): TypeChoice {
  if (offered.includes(wanted)) {
    return { type: wanted, wanted, fellBack: false };
  }
  const type = offered.includes(fallback) ? fallback : (offered[0] ?? fallback);
  return { type, wanted, fellBack: true };
}

export function hasSettled(series: readonly number[], target: number): boolean {
  return (
    series.length >= SETTLED_TICKS &&
    series.slice(-SETTLED_TICKS).every((value) => value <= target * SETTLED_RATIO)
  );
}

function phaseOf(points: readonly Point[], timeline: Timeline): Phase | undefined {
  const { sendMs, doneMs, excluded } = timeline;
  const read = (fromMs: number, toMs: number): number[] =>
    points
      .filter((point) => point.t >= fromMs && point.t < toMs && !isExcluded(point.t, excluded))
      .map((point) => point.value);
  const baseline = meanOf(read(0, sendMs));
  if (baseline === undefined) {
    return undefined;
  }
  const spawned = read(sendMs, doneMs);
  const after =
    median(read(doneMs + AFTER_FIRST_MS, doneMs + AFTER_LAST_MS)) ??
    read(doneMs, doneMs + AFTER_LAST_MS).at(-1);
  return {
    baseline,
    peak: spawned.length === 0 ? undefined : maxOf(spawned),
    running: median(read(timeline.running.fromMs, timeline.running.toMs)),
    after,
  };
}

function pointsOf(ticks: readonly Tick[], pick: (tick: Tick) => number | undefined): Point[] {
  return ticks.flatMap((tick) => {
    const value = pick(tick);
    return value === undefined ? [] : [{ t: tick.atMs, value }];
  });
}

function rootOf(tick: Tick) {
  return tick.processes.find((process) => process.pid === tick.root);
}

export function rssSeries(ticks: readonly Tick[]): Point[] {
  return pointsOf(ticks, (tick) => rootOf(tick)?.rssKib);
}

function childRssOf(tick: Tick): number {
  return sumOf(
    tick.processes.filter((process) => process.pid !== tick.root).map((process) => process.rssKib),
  );
}

function childFootprintOf(tick: Tick): number | undefined {
  if (rootOf(tick)?.footprintKib === undefined) {
    return undefined;
  }
  return sumOf(
    tick.processes
      .filter((process) => process.pid !== tick.root)
      .map((process) => process.footprintKib ?? 0),
  );
}

export function readRun(ticks: readonly Tick[], timeline: Timeline, count: number): RunReading {
  const { sendMs, doneMs } = timeline;
  const { fromMs, toMs } = timeline.running;

  return {
    count,
    runningSeconds: Math.max(0, doneMs - sendMs) / MS_PER_SECOND,
    aliveSeconds: Math.max(0, toMs - fromMs) / MS_PER_SECOND,
    rss: phaseOf(rssSeries(ticks), timeline),
    footprint: phaseOf(
      pointsOf(ticks, (tick) => rootOf(tick)?.footprintKib),
      timeline,
    ),
    childRss: phaseOf(pointsOf(ticks, childRssOf), timeline),
    childFootprint: phaseOf(pointsOf(ticks, childFootprintOf), timeline),
    threads: phaseOf(
      pointsOf(ticks, (tick) => tick.threads),
      timeline,
    ),
    cpu: readCpu(ticks, timeline),
  };
}

export function readHeapPhases(rows: readonly HeapRow[], timeline: Timeline): HeapPhases {
  const points = (pick: (row: HeapRow) => number | undefined): Point[] =>
    rows.flatMap((row) => {
      const value = pick(row);
      return value === undefined ? [] : [{ t: row.t, value }];
    });
  return {
    jsHeap: phaseOf(
      points((row) => row.jscHeap),
      timeline,
    ),
    external: phaseOf(
      points((row) => row.external),
      timeline,
    ),
    objects: phaseOf(
      points((row) => row.objects),
      timeline,
    ),
  };
}

export function kibText(kib: number): string {
  return megabytes(kib);
}

export function bytesText(bytes: number): string {
  return megabytes(bytes / KIB);
}

export function countText(value: number): string {
  return Number.isInteger(value) ? whole(value) : value.toFixed(1);
}

export function objectText(value: number): string {
  return whole(Math.round(value));
}

export interface PhaseView {
  phase: Phase | undefined;
  count: number;
  text: (value: number) => string;
}

function signed(value: number, text: (n: number) => string): string {
  return `${value < 0 ? '-' : '+'}${text(Math.abs(value))}`;
}

export function formatPhase(title: string, view: PhaseView): string {
  const { phase, count, text } = view;
  if (phase === undefined) {
    return `${title}: not measured`;
  }
  const line = (label: string, value: number | undefined): string => {
    if (value === undefined) {
      return `  ${label.padEnd(20)} not measured`;
    }
    const grown = value - phase.baseline;
    return `  ${label.padEnd(20)} ${text(value).padStart(12)}   ${signed(grown, text)} over baseline, ${signed(grown / count, text)} per subagent`;
  };
  return [
    title,
    `  ${'baseline'.padEnd(20)} ${text(phase.baseline).padStart(12)}`,
    line('peak after sending', phase.peak),
    line('while running', phase.running),
    line('after they finished', phase.after),
  ].join('\n');
}

function aliveLine(seconds: number, work: Work): string {
  const span = seconds.toFixed(0);
  return work === 'sleep'
    ? `the subagents' sleep commands were running for ${span}s (the "while running" and cpu figures are read in that span)`
    : `read mode has no sleep command to mark the work: the "while running" and cpu figures cover all ${span}s from sending to the final reply`;
}

export function formatRun(reading: RunReading, work: Work): string {
  const { count } = reading;
  return [
    formatPhase('memory of the parent process (rss)', {
      phase: reading.rss,
      count,
      text: kibText,
    }),
    formatPhase('memory of the parent process (real footprint)', {
      phase: reading.footprint,
      count,
      text: kibText,
    }),
    formatPhase('memory of all child processes (rss), the subagents and their shell commands', {
      phase: reading.childRss,
      count,
      text: kibText,
    }),
    formatPhase('memory of all child processes (real footprint)', {
      phase: reading.childFootprint,
      count,
      text: kibText,
    }),
    formatCpu(reading.cpu, count),
    formatPhase('threads of the parent process', {
      phase: reading.threads,
      count,
      text: countText,
    }),
    `time between sending and the final reply: ${reading.runningSeconds.toFixed(0)}s`,
    aliveLine(reading.aliveSeconds, work),
  ].join('\n');
}

export function formatHeapPhases(phases: HeapPhases, count: number): string {
  return [
    formatPhase('js heap (bytes JSC holds)', { phase: phases.jsHeap, count, text: bytesText }),
    formatPhase('external memory (buffers outside the js heap)', {
      phase: phases.external,
      count,
      text: bytesText,
    }),
    formatPhase('live objects (read every few seconds)', {
      phase: phases.objects,
      count,
      text: objectText,
    }),
  ].join('\n');
}

export function perSubagent(growth: readonly TypeGrowth[], count: number): string {
  if (growth.length === 0) {
    return '  no object type grew';
  }
  return growth
    .map(
      (entry) =>
        `  ${entry.type.padEnd(28)} +${whole(Math.round(entry.delta / count)).padStart(9)} per subagent  (+${whole(entry.delta)} in all)`,
    )
    .join('\n');
}
