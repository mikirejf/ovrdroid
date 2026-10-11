import type { LagRow, LagSummary } from './lag.ts';
import { lagText, rowsIn, summariseLag } from './lag.ts';
import type { Span } from './series.ts';
import { isExcluded } from './series.ts';
import type { Timeline } from './subagents-record.ts';
import { AFTER_FIRST_MS, AFTER_LAST_MS } from './subagents.ts';

export const LAG_BASELINE_MS = 10_000;

export interface LagPhases {
  baseline: LagSummary | undefined;
  running: LagSummary | undefined;
  after: LagSummary | undefined;
}

export function readLagPhases(rows: readonly LagRow[], timeline: Timeline): LagPhases {
  const { sendMs, doneMs, running } = timeline;
  const quiet = rows.filter((row) => !isExcluded(row.t, timeline.excluded));
  const over = (span: Span): LagSummary | undefined => summariseLag(rowsIn(quiet, span));
  return {
    baseline: over({ fromMs: sendMs - LAG_BASELINE_MS, toMs: sendMs }),
    running: over(running),
    after: over({ fromMs: doneMs + AFTER_FIRST_MS, toMs: doneMs + AFTER_LAST_MS }),
  };
}

function phaseLine(label: string, summary: LagSummary | undefined): string {
  const rows = summary === undefined ? '' : ` (${summary.rows} rows)`;
  return `  ${label.padEnd(20)} ${lagText(summary)}${rows}`;
}

export function formatLagPhases(phases: LagPhases): string {
  return [
    'event-loop lag of the parent process (a 50ms timer on its one JS thread; busy is the share of time the loop was blocked for more than 50ms)',
    phaseLine('before sending', phases.baseline),
    phaseLine('while running', phases.running),
    phaseLine('after they finished', phases.after),
  ].join('\n');
}
