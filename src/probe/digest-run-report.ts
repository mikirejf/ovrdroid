import { isSummary, summaryBody } from '../patch/summary-format.ts';
import { compactRowsFor } from './compaction-fallback-report.ts';
import { gradeReply, ITEM_COUNT } from './digest-grade.ts';
import type { DigestKey } from './digest-key.ts';
import type { Transcript } from './live-transcript.ts';
import { childOf, finalReply } from './live-transcript.ts';
import { compactionsOf } from './summaries-report.ts';

const DECIMALS = 2;

export interface StoredSummary {
  chars: number;
  isSummary: boolean;
}

export interface RunResult {
  binary: string;
  run: number;
  parentId: string;
  gruntId: string;
  scores: number[];
  total: number | undefined;
  compactions: number;
  paths: string[];
  summaries: StoredSummary[];
  timedOut: boolean;
  seconds: number;
}

export interface RunEvidence {
  binary: string;
  run: number;
  parent: Transcript;
  transcripts: readonly Transcript[];
  log: string;
  key: DigestKey;
  timedOut: boolean;
  seconds: number;
}

export interface BinarySummary {
  binary: string;
  runs: number;
  scored: number;
  mean: number | undefined;
  min: number | undefined;
  max: number | undefined;
  compactions: number;
  paths: ReadonlyMap<string, number>;
  nonSummaries: number;
  timeouts: number;
  uncompacted: readonly number[];
}

export function runResult(evidence: RunEvidence): RunResult {
  const { binary, run, parent, transcripts, log, key, timedOut, seconds } = evidence;
  const child = childOf(transcripts, parent.id);
  if (child === undefined && !timedOut) {
    throw new Error(
      `${binary} run ${run}: the parent replied but no transcript names session ${parent.id} as its caller, so the grunt ran somewhere the probe cannot see`,
    );
  }
  const gruntId = child?.id ?? '';
  const stored = child === undefined ? [] : compactionsOf(child.id, child.text);
  const grade =
    child === undefined || timedOut ? undefined : gradeReply(key, finalReply(child.text));
  return {
    binary,
    run,
    parentId: parent.id,
    gruntId,
    scores: grade?.items.map(({ score }) => score) ?? [],
    total: grade?.total,
    compactions: stored.length,
    paths: gruntId === '' ? [] : compactRowsFor(log, gruntId).map((row) => row.path),
    summaries: stored.map(({ text }) => ({
      chars: text.length,
      isSummary: isSummary(summaryBody(text)),
    })),
    timedOut,
    seconds,
  };
}

function totals(results: readonly RunResult[]): number[] {
  return results.flatMap(({ total }) => (total === undefined ? [] : [total]));
}

export function summariseBinary(binary: string, results: readonly RunResult[]): BinarySummary {
  const scored = totals(results);
  const paths = new Map<string, number>();
  for (const path of results.flatMap((result) => result.paths)) {
    paths.set(path, (paths.get(path) ?? 0) + 1);
  }
  return {
    binary,
    runs: results.length,
    scored: scored.length,
    mean:
      scored.length === 0
        ? undefined
        : scored.reduce((sum, value) => sum + value, 0) / scored.length,
    min: scored.length === 0 ? undefined : Math.min(...scored),
    max: scored.length === 0 ? undefined : Math.max(...scored),
    compactions: results.reduce((sum, result) => sum + result.compactions, 0),
    paths,
    nonSummaries: results.flatMap((result) => result.summaries).filter((s) => !s.isSummary).length,
    timeouts: results.filter((result) => result.timedOut).length,
    uncompacted: results
      .filter((result) => result.compactions === 0 && result.paths.length === 0)
      .map((result) => result.run),
  };
}

function fixed(value: number): string {
  return value.toFixed(DECIMALS);
}

function pathCounts(paths: ReadonlyMap<string, number>): string {
  if (paths.size === 0) {
    return 'none logged';
  }
  return [...paths]
    .toSorted(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
}

export function describeRun(result: RunResult): string {
  const score =
    result.total === undefined
      ? 'no score'
      : `${fixed(result.total)} of ${ITEM_COUNT} (${result.scores.map(fixed).join(' ')})`;
  const paths = result.paths.length === 0 ? 'none logged' : result.paths.join(', ');
  const flags = result.summaries.filter((summary) => !summary.isSummary).length;
  return [
    `${result.binary} run ${result.run}: ${score}`,
    `${result.compactions} stored (${flags} not summaries), paths: ${paths}`,
    result.timedOut ? 'TIMED OUT' : `${Math.round(result.seconds)}s`,
  ].join('; ');
}

export function describeBinary(summary: BinarySummary): string[] {
  const score =
    summary.mean === undefined || summary.min === undefined || summary.max === undefined
      ? 'none scored'
      : `mean ${fixed(summary.mean)} of ${ITEM_COUNT} (min ${fixed(summary.min)}, max ${fixed(summary.max)})`;
  return [
    summary.binary,
    `  runs: ${summary.runs}, scored: ${summary.scored}`,
    `  score: ${score}`,
    `  compactions: ${summary.compactions}`,
    `  compact paths: ${pathCounts(summary.paths)}`,
    `  stored non-summaries: ${summary.nonSummaries}`,
    `  timeouts: ${summary.timeouts}`,
    ...summary.uncompacted.map(
      (run) => `  run ${run} compacted zero times, so it tests nothing about compaction`,
    ),
  ];
}
