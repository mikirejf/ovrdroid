import { isoDate, KIB, megabytes, whole } from '../cli.ts';
import type { Fields } from './fields.ts';
import { counted, fieldsOf, isObject, worded } from './fields.ts';

const USAGE_MARK = 'INFO: [Agent] Streaming result | Context: ';
const BUST_MARK =
  'WARN: [Prompt-Caching] Outgoing request is not append-only; prompt cache may be broken | Context: ';

const BIGGEST_WRITE = 'over 128k';
const NOT_FOUND = -1;

export const UNNAMED = '(unnamed)';

const WRITE_BUCKETS: readonly (readonly [string, number])[] = [
  ['none', 0],
  ['1 to 4k', 4 * KIB],
  ['4k to 32k', 32 * KIB],
  ['32k to 128k', 128 * KIB],
  [BIGGEST_WRITE, Number.POSITIVE_INFINITY],
];

export interface UsageLine {
  kind: 'usage';
  at: string;
  sessionId: string;
  modelId: string;
  version: string;
  subagent: boolean;
  attempt: number;
  reason: string;
  inputTokens: number;
  cacheReadInputTokens: number;
  totalInputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  cachedTokensWritten: number;
}

export interface BustLine {
  kind: 'bust';
  at: string;
  sessionId: string;
  modelId: string;
  previousModelId: string;
  providerPath: string;
  reason: string;
  firstMismatchIndex: number;
  previousSegmentLabel: string;
  currentSegmentLabel: string;
  mismatchRegion: string;
  mismatchKind: string;
}

export interface LogRecords {
  usage: UsageLine[];
  busts: BustLine[];
}

export interface LogFile {
  name: string;
  bytes: number;
}

function stamp(line: string): string {
  const end = line.indexOf(']');
  return line.startsWith('[') && end > 0 ? line.slice(1, end) : '';
}

function contextAfter(line: string, mark: string): Fields | undefined {
  const at = line.indexOf(mark);
  if (at === NOT_FOUND) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(line.slice(at + mark.length));
    return isObject(parsed) ? fieldsOf(parsed) : undefined;
  } catch {
    return undefined;
  }
}

function usageOf(line: string, context: Fields): UsageLine {
  const tags = fieldsOf(context.get('tags'));
  return {
    kind: 'usage',
    at: stamp(line),
    sessionId: worded(tags, 'sessionId'),
    modelId: worded(tags, 'modelId'),
    version: worded(tags, 'version'),
    subagent: worded(tags, 'callingSessionIdPresent') === 'true',
    attempt: counted(context, 'attempt'),
    reason: worded(context, 'reason'),
    inputTokens: counted(context, 'inputTokens'),
    cacheReadInputTokens: counted(context, 'cacheReadInputTokens'),
    totalInputTokens: counted(context, 'totalInputTokens'),
    reasoningTokens: counted(context, 'reasoningTokens'),
    outputTokens: counted(context, 'outputTokens'),
    cachedTokensWritten: counted(context, 'cachedTokensWritten'),
  };
}

function bustOf(line: string, context: Fields): BustLine {
  const value = fieldsOf(context.get('value'));
  return {
    kind: 'bust',
    at: stamp(line),
    sessionId: worded(context, 'sessionId'),
    modelId: worded(context, 'modelId'),
    previousModelId: worded(value, 'previousModelId'),
    providerPath: worded(value, 'providerPath'),
    reason: worded(value, 'reason'),
    firstMismatchIndex: counted(value, 'firstMismatchIndex'),
    previousSegmentLabel: worded(value, 'previousSegmentLabel'),
    currentSegmentLabel: worded(value, 'currentSegmentLabel'),
    mismatchRegion: worded(value, 'mismatchRegion'),
    mismatchKind: worded(value, 'mismatchKind'),
  };
}

export function parseLogLine(line: string): UsageLine | BustLine | undefined {
  const usage = contextAfter(line, USAGE_MARK);
  if (usage !== undefined) {
    return usageOf(line, usage);
  }
  const bust = contextAfter(line, BUST_MARK);
  return bust === undefined ? undefined : bustOf(line, bust);
}

export function parseLog(body: string): LogRecords {
  const records: LogRecords = { usage: [], busts: [] };
  for (const line of body.split('\n')) {
    const record = parseLogLine(line);
    if (record?.kind === 'usage') {
      records.usage.push(record);
    } else if (record?.kind === 'bust') {
      records.busts.push(record);
    }
  }
  return records;
}

export function collapseLabel(label: string): string {
  return label.replaceAll(/\d+/gu, 'N');
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const found = groups.get(name);
    if (found === undefined) {
      groups.set(name, [item]);
    } else {
      found.push(item);
    }
  }
  return groups;
}

function tally(values: readonly string[]): [string, number][] {
  return [...groupBy(values, (value) => value)]
    .map(([name, hits]): [string, number] => [name, hits.length])
    .toSorted((left, right) => right[1] - left[1]);
}

function bucketOf(written: number): string {
  const found = WRITE_BUCKETS.find(([, limit]) => written <= limit);
  return found === undefined ? BIGGEST_WRITE : found[0];
}

function indented(entries: readonly [string, number][], head: string): string[] {
  if (entries.length === 0) {
    return [`  ${head}: none`];
  }
  return [`  ${head}:`, ...entries.map(([name, hits]) => `    ${name}: ${whole(hits)}`)];
}

function stampsOf(records: LogRecords): string[] {
  return [...records.usage, ...records.busts]
    .map((record) => record.at)
    .filter((at) => at !== '')
    .toSorted();
}

function fileLines(stamps: readonly string[], files: readonly LogFile[]): string[] {
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  const span = stamps.length === 0 ? 'no timestamped lines' : `${stamps.at(0)} to ${stamps.at(-1)}`;
  return [`files: ${files.length}, ${span}, ${megabytes(bytes / KIB)}`];
}

function modelLines(usage: readonly UsageLine[]): string[] {
  const models = [...groupBy(usage, (line) => line.modelId)]
    .map(([modelId, lines]) => ({ modelId, lines }))
    .toSorted((left, right) => right.lines.length - left.lines.length);

  if (models.length === 0) {
    return ['per model: none'];
  }

  return [
    'per model:',
    ...models.map(({ modelId, lines }) =>
      [
        `  ${modelId === '' ? UNNAMED : modelId}: ${whole(lines.length)} requests`,
        `cache read ${whole(sumBy(lines, (line) => line.cacheReadInputTokens))}`,
        `cache written ${whole(sumBy(lines, (line) => line.cachedTokensWritten))}`,
        `uncached input ${whole(sumBy(lines, (line) => line.inputTokens))}`,
        `output ${whole(sumBy(lines, (line) => line.outputTokens))}`,
      ].join(', '),
    ),
  ];
}

function bucketLines(usage: readonly UsageLine[]): string[] {
  const counts = groupBy(usage, (line) => bucketOf(line.cachedTokensWritten));
  return [
    'cache writes per request:',
    ...WRITE_BUCKETS.map(([name]) => `  ${name}: ${whole(counts.get(name)?.length ?? 0)}`),
  ];
}

function bustLines(busts: readonly BustLine[]): string[] {
  return [
    `busts: ${whole(busts.length)}`,
    ...indented(tally(busts.map((bust) => bust.reason)), 'by reason'),
    ...indented(
      tally(busts.map((bust) => collapseLabel(bust.currentSegmentLabel))),
      'by current label',
    ),
    ...indented(
      tally(busts.map((bust) => collapseLabel(bust.previousSegmentLabel))),
      'by previous label',
    ),
  ];
}

export function summariseLogs(records: LogRecords, files: readonly LogFile[]): string {
  const { usage, busts } = records;
  const sessions = new Set(usage.map((line) => line.sessionId));
  const stamps = stampsOf(records);
  const earliest = stamps.at(0);

  return [
    ...fileLines(stamps, files),
    `requests: ${whole(usage.length)}, ${whole(sessions.size)} sessions, ${whole(
      usage.filter((line) => line.subagent).length,
    )} from subagents`,
    ...modelLines(usage),
    ...bucketLines(usage),
    ...bustLines(busts),
    earliest === undefined
      ? 'no ground truth in these files'
      : `ground truth reaches back to ${isoDate(earliest)}`,
  ].join('\n');
}
