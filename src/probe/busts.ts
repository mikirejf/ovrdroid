import { whole } from '../cli.ts';
import type { BustLine, LogRecords, UsageLine } from './logs.ts';
import { collapseLabel, groupBy, sumBy, UNNAMED } from './logs.ts';

const TOOLS_SUFFIX = '.tools.N';
const OUTPUT_CONFIG_MARK = 'output_config';
const OPUS_MARK = 'opus';
const NO_EVIDENCE = 'no evidence in this window';
const WORST_COUNT = 10;
const PERCENT_DIGITS = 1;
const HALF = 2;
const SESSION_START_WINDOW_MS = 30_000;

export const BUST_EVENTS = ['tools', 'model', 'output-config', 'other'] as const;

export type BustEvent = (typeof BUST_EVENTS)[number];

export const BUST_CAUSES = ['session-start', 'mid-session'] as const;

export type BustCause = (typeof BUST_CAUSES)[number];

export const BUST_VERDICTS = ['unmeasured', 'grew', 'everything', 'harmless', 'partial'] as const;

export type BustVerdict = (typeof BUST_VERDICTS)[number];

export interface QuotaRate {
  tokensPerPercent: number;
  provenance: string;
}

const CAUSE_MEANING: Record<BustCause, string> = {
  'session-start':
    'the first request left before the MCP servers had connected, so the tools array grew on the second request; general.blockOnMcpLoad=true in ~/.factory/settings.json makes Droid wait for them',
  'mid-session':
    'a tool was loaded or the tool list changed while the session was running; a ToolSearch load of FetchUrl or WebSearch is the usual reason',
};

const VERDICT_MEANING: Record<BustVerdict, string> = {
  unmeasured: 'nothing was warm to lose, so the loss cannot be read',
  grew: 'the next request read more than was warm, so the pair is not one prefix',
  everything: 'the whole warm prefix died',
  harmless: 'the whole warm prefix survived',
  partial: 'part of the warm prefix survived',
};

export interface JoinedBust {
  at: string;
  sessionId: string;
  modelId: string;
  providerPath: string;
  event: BustEvent;
  cause: BustCause;
  verdict: BustVerdict;
  warmBefore: number;
  readAfter: number;
  wroteAfter: number;
}

export interface BustJoin {
  joined: JoinedBust[];
  unjoinable: number;
}

function rewritten(bust: JoinedBust): number {
  return Math.max(0, bust.warmBefore - bust.readAfter);
}

function byStamp(left: UsageLine, right: UsageLine): number {
  return left.at.localeCompare(right.at);
}

function eventOf(bust: BustLine): BustEvent {
  if (bust.previousModelId !== bust.modelId) {
    return 'model';
  }
  const label = collapseLabel(bust.currentSegmentLabel);
  if (label.endsWith(TOOLS_SUFFIX)) {
    return 'tools';
  }
  return label.includes(OUTPUT_CONFIG_MARK) ? 'output-config' : 'other';
}

function verdictOf(warmBefore: number, readAfter: number): BustVerdict {
  if (warmBefore === 0) {
    return 'unmeasured';
  }
  if (readAfter > warmBefore) {
    return 'grew';
  }
  if (readAfter === 0) {
    return 'everything';
  }
  return readAfter === warmBefore ? 'harmless' : 'partial';
}

function named(value: string): string {
  return value === '' ? UNNAMED : value;
}

function causeOf(bust: BustLine, first: UsageLine): BustCause {
  const since = Date.parse(bust.at) - Date.parse(first.at);
  return since < SESSION_START_WINDOW_MS ? 'session-start' : 'mid-session';
}

function joinOne(bust: BustLine, lines: readonly UsageLine[]): JoinedBust | undefined {
  const previous = lines.findLast((line) => line.at <= bust.at);
  const next = lines.find((line) => line.at >= bust.at);
  const first = lines.at(0);
  if (previous === undefined || next === undefined || first === undefined) {
    return undefined;
  }

  const warmBefore = previous.cacheReadInputTokens + previous.cachedTokensWritten;
  const readAfter = next.cacheReadInputTokens;

  return {
    at: bust.at,
    sessionId: bust.sessionId,
    modelId: bust.modelId,
    providerPath: named(bust.providerPath),
    event: eventOf(bust),
    cause: causeOf(bust, first),
    verdict: verdictOf(warmBefore, readAfter),
    warmBefore,
    readAfter,
    wroteAfter: next.cachedTokensWritten,
  };
}

export function joinBusts(records: LogRecords): BustJoin {
  const groups = groupBy([...records.usage].toSorted(byStamp), (line) => line.sessionId);
  const join: BustJoin = { joined: [], unjoinable: 0 };

  for (const bust of records.busts) {
    const joined = joinOne(bust, groups.get(bust.sessionId) ?? []);
    if (joined === undefined) {
      join.unjoinable += 1;
    } else {
      join.joined.push(joined);
    }
  }

  return join;
}

function medianRewritten(busts: readonly JoinedBust[]): number {
  const sorted = busts.map((bust) => rewritten(bust)).toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / HALF);
  if (sorted.length % HALF === 1) {
    return sorted[middle] ?? 0;
  }
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / HALF);
}

function groupLine(name: string, busts: readonly JoinedBust[]): string {
  if (busts.length === 0) {
    return `  ${name}: ${NO_EVIDENCE}`;
  }
  const counted = `${whole(busts.length)} busts`;
  const cost = `${whole(sumBy(busts, (bust) => rewritten(bust)))} rewritten`;
  return `  ${name}: ${counted}, ${cost}, median ${whole(medianRewritten(busts))}`;
}

function section(head: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [`${head}: none`] : [`${head}:`, ...lines];
}

interface KnownGroups<T extends string> {
  head: string;
  names: readonly T[];
  groups: Map<string, JoinedBust[]>;
  extra?: (name: T) => string[];
}

function knownGroups<T extends string>(spec: KnownGroups<T>): string[] {
  const extra = spec.extra ?? ((): string[] => []);
  return section(
    spec.head,
    spec.names.flatMap((name) => [groupLine(name, spec.groups.get(name) ?? []), ...extra(name)]),
  );
}

function foundGroups(head: string, groups: Map<string, JoinedBust[]>): string[] {
  return section(
    head,
    [...groups.keys()].toSorted().map((name) => groupLine(name, groups.get(name) ?? [])),
  );
}

function headlineLines(joined: readonly JoinedBust[], unjoinable: number): string[] {
  const total = joined.length + unjoinable;
  return [
    `cache-miss warnings: ${whole(total)}, ${whole(joined.length)} joined to the usage lines around them, ${whole(unjoinable)} unjoinable`,
    unjoinable === 0
      ? 'every warning had a usage line on both sides of it inside its own session'
      : `${whole(unjoinable)} warnings had no usage line on one side inside their session, so they carry no numbers here`,
  ];
}

function verdictLines(groups: Map<string, JoinedBust[]>): string[] {
  return section(
    'verdicts',
    BUST_VERDICTS.map((verdict) => {
      const busts = groups.get(verdict) ?? [];
      if (busts.length === 0) {
        return `  ${verdict}: ${NO_EVIDENCE}`;
      }
      const wrote = sumBy(busts, (bust) => bust.wroteAfter);
      return `  ${verdict}: ${whole(busts.length)} busts, ${whole(sumBy(busts, (bust) => rewritten(bust)))} rewritten, ${whole(wrote)} written back by the next request (${VERDICT_MEANING[verdict]})`;
    }),
  );
}

function worstLines(joined: readonly JoinedBust[]): string[] {
  const worst = joined
    .toSorted((left, right) => rewritten(right) - rewritten(left))
    .slice(0, WORST_COUNT);
  return section(
    `worst ${WORST_COUNT} busts by tokens rewritten`,
    worst.map(
      (bust) =>
        `  ${bust.at} ${named(bust.modelId)} ${bust.event}: warm ${whole(bust.warmBefore)} -> read ${whole(bust.readAfter)}, ${whole(rewritten(bust))} rewritten`,
    ),
  );
}

function quotaLines(joined: readonly JoinedBust[], quota: QuotaRate | undefined): string[] {
  if (quota === undefined) {
    return [
      'quota cost: no measured rate is on record, so nothing here can be priced',
      '  run probe quota to measure tokens per 1% of a 5 hour window',
    ];
  }

  const opus = joined.filter((bust) => bust.modelId.includes(OPUS_MARK));
  const rate = `the only measured rate is ${whole(Math.round(quota.tokensPerPercent))} cache-write tokens per 1% of a 5 hour window, ${quota.provenance}`;
  if (opus.length === 0) {
    return [
      'quota cost: no opus bust in this window, so nothing here can be priced',
      `  ${rate}, and it holds for opus only`,
    ];
  }
  const total = sumBy(opus, (bust) => rewritten(bust));
  const percent = (total / quota.tokensPerPercent).toFixed(PERCENT_DIGITS);
  return [
    `quota cost: ${whole(total)} tokens rewritten across ${whole(opus.length)} opus busts, which is ${percent}% of one 5 hour window`,
    `  ${rate}`,
    `  the other ${whole(joined.length - opus.length)} busts are unpriced: no rate was measured for their models`,
  ];
}

function blindSpotLines(): string[] {
  return [
    'these logs cannot see: compaction, a reasoning-effort change, a pasted image, a skill load, or which subagent caused a send',
    'a kind missing from the list above is a kind this window never exercised, not a kind that is free',
  ];
}

export function summariseBusts(
  joined: readonly JoinedBust[],
  unjoinable: number,
  quota: QuotaRate | undefined,
): string {
  return [
    ...headlineLines(joined, unjoinable),
    ...verdictLines(groupBy(joined, (bust) => bust.verdict)),
    ...knownGroups({
      head: 'per cause',
      names: BUST_CAUSES,
      groups: groupBy(joined, (bust) => bust.cause),
      extra: (cause) => [`    ${CAUSE_MEANING[cause]}`],
    }),
    ...knownGroups({
      head: 'per event kind',
      names: BUST_EVENTS,
      groups: groupBy(joined, (bust) => bust.event),
    }),
    ...foundGroups(
      'per provider path',
      groupBy(joined, (bust) => bust.providerPath),
    ),
    ...foundGroups(
      'per model',
      groupBy(joined, (bust) => named(bust.modelId)),
    ),
    ...worstLines(joined),
    ...quotaLines(joined, quota),
    ...blindSpotLines(),
  ].join('\n');
}
