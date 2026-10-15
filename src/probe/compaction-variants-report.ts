import type { Usage } from './anthropic.ts';
import type { Outcome } from './compaction-outcome.ts';
import { readReply } from './compaction-outcome.ts';
import type { Arm } from './compaction-replay-plan.ts';
import { ARMS } from './compaction-replay-plan.ts';
import type { SavedReply } from './compaction-saved.ts';
import { fisherTwoSided, wilson } from './compaction-stats.ts';
import type { ModelPrice } from './prices.ts';
import { costOf } from './prices.ts';

interface Judged {
  row: number;
  arm: Arm;
  run: number;
  outcome: Outcome;
  viaTool: boolean;
  usage: Usage | undefined;
  cost: number | undefined;
}

interface Tally {
  arm: Arm;
  n: number;
  summaries: number;
  ownLayout: number;
  refusals: number;
  viaTool: number;
  errors: number;
  answered: number;
  cost: number | undefined;
  expected: number | undefined;
  cacheShare: number | undefined;
  outputTokens: number | undefined;
}

export const NO_REPLIES = 'no replies were saved';

const BASELINE: Arm = 'reuse';
const RETRY_ARM = 'reuse+retry';
const STOCK_ARMS = new Set<Arm>(['stock', 'stock-captured']);
const ARM_ORDER: readonly Arm[] = [...ARMS, 'stock-captured'];
const GAP = '  ';
const HEADING = [
  'arm',
  'n',
  'summary',
  'own-layout',
  'refusal',
  'by tool',
  'error',
  'refusal rate',
  '95% interval',
  'p vs reuse',
  'cache share',
  'out tokens',
  '$/request',
  '$/compaction',
];
const TEXT_COLUMNS = 1;
const PERCENT = 100;
const COST_DECIMALS = 5;
const SMALL_P = 0.001;
const P_DECIMALS = 3;
const PAIR = 2;

function percentOf(share: number): string {
  return `${Math.round(share * PERCENT)}%`;
}

function rangeOf(hits: number, total: number): string {
  const { low, high } = wilson(hits, total);
  return `${Math.round(low * PERCENT)}-${percentOf(high)}`;
}

function pText(p: number): string {
  return p < SMALL_P ? `p<${SMALL_P}` : `p=${p.toFixed(P_DECIMALS)}`;
}

function money(value: number | undefined): string {
  return value === undefined ? '-' : `$${value.toFixed(COST_DECIMALS)}`;
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
}

function costOfUsage(price: ModelPrice, usage: Usage): number {
  return costOf(price, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheRead,
    cacheWrite5mTokens: usage.cacheWrite - usage.write1h,
    cacheWrite1hTokens: usage.write1h,
  });
}

export function asCold(usage: Usage): Usage {
  const written = usage.cacheRead + usage.cacheWrite;
  return { ...usage, cacheRead: 0, cacheWrite: written, write5m: 0, write1h: written };
}

function judge(reply: SavedReply, price: ModelPrice): Judged {
  const { row, arm, run } = reply;
  const usage =
    reply.usage !== undefined && STOCK_ARMS.has(arm) ? asCold(reply.usage) : reply.usage;
  const cost = usage === undefined ? undefined : costOfUsage(price, usage);
  if (reply.error !== undefined) {
    return { row, arm, run, outcome: 'error', viaTool: false, usage, cost };
  }
  const reading = readReply(reply.content);
  return {
    row,
    arm,
    run,
    outcome: reading.outcome,
    viaTool: reading.tools.length > 0,
    usage,
    cost,
  };
}

function costs(replies: readonly Judged[]): number[] {
  return replies.flatMap((reply) => (reply.cost === undefined ? [] : [reply.cost]));
}

function stockCost(replies: readonly Judged[]): number | undefined {
  return mean(costs(replies.filter((reply) => STOCK_ARMS.has(reply.arm))));
}

function cacheShareOf(replies: readonly Judged[]): number | undefined {
  const usages = replies.flatMap((reply) => (reply.usage === undefined ? [] : [reply.usage]));
  const read = usages.reduce((sum, usage) => sum + usage.cacheRead, 0);
  const prompt = usages.reduce(
    (sum, usage) => sum + usage.inputTokens + usage.cacheRead + usage.cacheWrite,
    0,
  );
  return prompt === 0 ? undefined : read / prompt;
}

function expectedCost(
  arm: Arm,
  replies: readonly Judged[],
  fallback: number | undefined,
): number | undefined {
  const own = mean(costs(replies));
  if (own === undefined || STOCK_ARMS.has(arm)) {
    return own;
  }
  if (fallback === undefined) {
    return undefined;
  }
  const missed = replies.filter((reply) => reply.outcome !== 'summary').length;
  return own + (missed / replies.length) * fallback;
}

function count(replies: readonly Judged[], outcome: Outcome): number {
  return replies.filter((reply) => reply.outcome === outcome).length;
}

function tallyOf(arm: Arm, replies: readonly Judged[], fallback: number | undefined): Tally {
  const errors = count(replies, 'error');
  const outputs = replies.flatMap((reply) =>
    reply.usage === undefined ? [] : [reply.usage.outputTokens],
  );
  return {
    arm,
    n: replies.length,
    summaries: count(replies, 'summary'),
    ownLayout: count(replies, 'own-layout'),
    refusals: count(replies, 'refusal'),
    viaTool: replies.filter((reply) => reply.outcome === 'refusal' && reply.viaTool).length,
    errors,
    answered: replies.length - errors,
    cost: mean(costs(replies)),
    expected: expectedCost(arm, replies, fallback),
    cacheShare: cacheShareOf(replies),
    outputTokens: mean(outputs),
  };
}

function tallies(replies: readonly Judged[], fallback: number | undefined): Tally[] {
  return ARM_ORDER.flatMap((arm) => {
    const mine = replies.filter((reply) => reply.arm === arm);
    return mine.length === 0 ? [] : [tallyOf(arm, mine, fallback)];
  });
}

function pAgainst(tally: Tally, base: Tally | undefined): number | undefined {
  if (base === undefined || tally.arm === base.arm || tally.answered === 0) {
    return undefined;
  }
  return fisherTwoSided(
    { hits: tally.refusals, misses: tally.answered - tally.refusals },
    { hits: base.refusals, misses: base.answered - base.refusals },
  );
}

function cellsOf(tally: Tally, base: Tally | undefined): string[] {
  const p = pAgainst(tally, base);
  return [
    tally.arm,
    String(tally.n),
    String(tally.summaries),
    String(tally.ownLayout),
    String(tally.refusals),
    String(tally.viaTool),
    String(tally.errors),
    tally.answered === 0 ? '-' : percentOf(tally.refusals / tally.answered),
    tally.answered === 0 ? '-' : rangeOf(tally.refusals, tally.answered),
    p === undefined ? '-' : pText(p),
    tally.cacheShare === undefined ? '-' : percentOf(tally.cacheShare),
    tally.outputTokens === undefined ? '-' : String(Math.round(tally.outputTokens)),
    money(tally.cost),
    money(tally.expected),
  ];
}

function aligned(rows: readonly (readonly string[])[]): string[] {
  const widths = HEADING.map((_heading, column) =>
    Math.max(...rows.map((cells) => cells[column]?.length ?? 0)),
  );
  return rows.map((cells) =>
    cells
      .map((cell, column) =>
        column < TEXT_COLUMNS
          ? cell.padEnd(widths[column] ?? 0)
          : cell.padStart(widths[column] ?? 0),
      )
      .join(GAP),
  );
}

interface Section {
  lines: string[];
  all: Tally[];
}

interface Pair {
  first: Judged;
  second: Judged;
}

function pairsOf(replies: readonly Judged[]): Pair[] {
  const rows = [...new Set(replies.map((reply) => reply.row))].toSorted((a, b) => a - b);
  return rows.flatMap((row) => {
    const runs = replies
      .filter((reply) => reply.row === row && reply.arm === BASELINE)
      .toSorted((a, b) => a.run - b.run);
    const pairs: Pair[] = [];
    for (let at = 0; at + 1 < runs.length; at += PAIR) {
      const [first, second] = runs.slice(at, at + PAIR);
      if (first !== undefined && second !== undefined) {
        pairs.push({ first, second });
      }
    }
    return pairs;
  });
}

function retryCost(pair: Pair, fallback: number | undefined): number | undefined {
  const spent = (pair.first.cost ?? 0) + (pair.second.cost ?? 0);
  if (pair.first.outcome === 'summary') {
    return pair.first.cost ?? 0;
  }
  if (pair.second.outcome === 'summary') {
    return spent;
  }
  return fallback === undefined ? undefined : spent + fallback;
}

function retryLine(replies: readonly Judged[], fallback: number | undefined): string[] {
  const pairs = pairsOf(replies);
  if (pairs.length === 0) {
    return [`${RETRY_ARM}: needs two ${BASELINE} runs of a row to make a pair`];
  }
  const failed = pairs.filter(
    (pair) => pair.first.outcome !== 'summary' && pair.second.outcome !== 'summary',
  ).length;
  const spent = pairs.map((pair) => retryCost(pair, fallback));
  const known = spent.flatMap((cost) => (cost === undefined ? [] : [cost]));
  const expected = known.length === spent.length ? mean(known) : undefined;
  return [
    `${RETRY_ARM}: ${pairs.length} pairs, both replies failed in ${failed} (${percentOf(failed / pairs.length)}, ${rangeOf(failed, pairs.length)}), those fall back to stock; expected cost per compaction ${money(expected)}`,
  ];
}

function findingLines(all: readonly Tally[]): string[] {
  const base = all.find((tally) => tally.arm === BASELINE);
  if (base === undefined || base.answered === 0) {
    return [];
  }
  const against = `reuse ${base.refusals} of ${base.answered}`;
  return all.flatMap((tally) => {
    const p = pAgainst(tally, base);
    if (p === undefined || STOCK_ARMS.has(tally.arm)) {
      return [];
    }
    const share = percentOf(tally.refusals / tally.answered);
    return [
      `${tally.arm} refused ${tally.refusals} of ${tally.answered} (${share}, ${rangeOf(tally.refusals, tally.answered)}), against ${against} (${pText(p)})`,
    ];
  });
}

function sectionOf(
  title: string,
  replies: readonly Judged[],
  fallback: number | undefined,
): Section {
  const all = tallies(replies, fallback);
  const base = all.find((tally) => tally.arm === BASELINE);
  const table = aligned([HEADING, ...all.map((tally) => cellsOf(tally, base))]);
  return { lines: [title, ...table], all };
}

function firstPrompts(replies: readonly SavedReply[]): Map<string, Usage> {
  const first = new Map<string, { run: number; usage: Usage }>();
  for (const { row, arm, run, usage } of replies) {
    const key = `${row}\u0000${arm}`;
    const seen = first.get(key);
    if (usage !== undefined && (seen === undefined || run < seen.run)) {
      first.set(key, { run, usage });
    }
  }
  return new Map([...first].map(([key, { usage }]) => [key, usage]));
}

export function asFirstRequest(replies: readonly SavedReply[]): SavedReply[] {
  const first = firstPrompts(replies);
  return replies.map((reply) => {
    const met = first.get(`${reply.row}\u0000${reply.arm}`);
    if (reply.usage === undefined || met === undefined || STOCK_ARMS.has(reply.arm)) {
      return reply;
    }
    const { inputTokens, cacheRead, cacheWrite, write5m, write1h } = met;
    return {
      ...reply,
      usage: { ...reply.usage, inputTokens, cacheRead, cacheWrite, write5m, write1h },
    };
  });
}

export function variantsReport(replies: readonly SavedReply[], price: ModelPrice): string[] {
  const judged = asFirstRequest(replies.filter((reply) => !reply.warm)).map((reply) =>
    judge(reply, price),
  );
  if (judged.length === 0) {
    return [`${NO_REPLIES}.`];
  }
  const fallback = stockCost(judged);
  const overall = sectionOf('all rows', judged, fallback);
  const rows = [...new Set(judged.map((reply) => reply.row))].toSorted((a, b) => a - b);
  const perRow = rows.flatMap((row) => {
    const mine = judged.filter((reply) => reply.row === row);
    return [''].concat(sectionOf(`row ${row}`, mine, stockCost(mine) ?? fallback).lines);
  });
  return [
    'refusal rate counts answered requests; $/compaction adds one stock request when the reply is not a summary',
    'stock is priced cold: in a real session its flattened transcript was never sent before, so every replayed cache read is counted as a cache write',
    "every other reply is priced with the cache its arm's first request of that row met: a real compaction sends one request, so later replays reading the first one's cache write would flatter the arm",
    '',
    ...overall.lines,
    ...retryLine(judged, fallback),
    '',
    ...findingLines(overall.all),
    ...perRow,
  ];
}
