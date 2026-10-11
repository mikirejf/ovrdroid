import { MS_PER_SECOND } from '../cli.ts';
import type { CpuPart, Tick } from './sampler.ts';
import { cpuSeries } from './sampler.ts';
import type { Span } from './series.ts';
import { isExcluded } from './series.ts';
import type { Timeline } from './subagents-record.ts';

export const SPAWN_WINDOW_MS = 10_000;
const SECONDS_PER_MINUTE = 60;

export interface CpuPhase {
  spawnSeconds: number;
  idleCores: number;
  runningCores: number | undefined;
}

export interface CpuReading {
  parent: CpuPhase;
  children: CpuPhase;
}

interface Cpu {
  cpuMs: number;
  coveredMs: number;
}

interface CpuWindow {
  span: Span;
  excluded: readonly Span[];
}

function cpuBetween(ticks: readonly Tick[], part: CpuPart, window: CpuWindow): Cpu {
  const { span, excluded } = window;
  const cpu = cpuSeries(ticks, part);
  const total: Cpu = { cpuMs: 0, coveredMs: 0 };
  for (const [index, end] of cpu.entries()) {
    const start = cpu[index - 1];
    if (
      start !== undefined &&
      start.t >= span.fromMs &&
      end.t <= span.toMs &&
      !isExcluded(start.t, excluded) &&
      !isExcluded(end.t, excluded)
    ) {
      total.cpuMs += end.value - start.value;
      total.coveredMs += end.t - start.t;
    }
  }
  return total;
}

function coresOf(cpu: Cpu): number | undefined {
  return cpu.coveredMs === 0 ? undefined : cpu.cpuMs / cpu.coveredMs;
}

function phaseOf(ticks: readonly Tick[], part: CpuPart, timeline: Timeline): CpuPhase {
  const { sendMs, excluded } = timeline;
  const { fromMs, toMs } = timeline.running;
  const at = (span: Span): Cpu => cpuBetween(ticks, part, { span, excluded });
  const spawn = at({ fromMs, toMs: fromMs + SPAWN_WINDOW_MS });
  return {
    spawnSeconds: spawn.cpuMs / MS_PER_SECOND,
    idleCores: coresOf(at({ fromMs: 0, toMs: sendMs })) ?? 0,
    runningCores: coresOf(at({ fromMs: fromMs + SPAWN_WINDOW_MS, toMs })),
  };
}

export function readCpu(ticks: readonly Tick[], timeline: Timeline): CpuReading {
  return {
    parent: phaseOf(ticks, 'parent', timeline),
    children: phaseOf(ticks, 'children', timeline),
  };
}

function formatCpuPhase(title: string, phase: CpuPhase, count: number): string[] {
  const idleSpawn = (phase.idleCores * SPAWN_WINDOW_MS) / MS_PER_SECOND;
  const lines = [
    title,
    `  first ${SPAWN_WINDOW_MS / MS_PER_SECOND}s of the subagents' lives: ${phase.spawnSeconds.toFixed(1)} cpu-seconds, ${((phase.spawnSeconds - idleSpawn) / count).toFixed(2)} above idle per subagent (idle would use ${idleSpawn.toFixed(1)})`,
  ];
  if (phase.runningCores === undefined) {
    lines.push('  while running: no samples, the subagents finished within the spawn window');
  } else {
    const above = Math.max(0, phase.runningCores - phase.idleCores) * SECONDS_PER_MINUTE;
    lines.push(
      `  while running: ${(phase.runningCores * SECONDS_PER_MINUTE).toFixed(1)} cpu-seconds per minute, ${above.toFixed(1)} above idle, ${(above / count).toFixed(2)} per subagent per minute`,
    );
  }
  return lines;
}

export function formatCpu(cpu: CpuReading, count: number): string {
  return [
    ...formatCpuPhase('cpu of the parent process', cpu.parent, count),
    ...formatCpuPhase(
      'cpu of the child processes (every descendant, shell commands included)',
      cpu.children,
      count,
    ),
  ].join('\n');
}
