import type { Usage } from './anthropic.ts';
import type { ScheduleName, Step } from './ttl.ts';
import { gapLabel, SHORT_TTL_SECONDS, wallSeconds } from './ttl.ts';

export interface SendOutcome {
  usage: Usage;
  elapsedSeconds: number;
}

interface Send {
  gapSeconds: number;
  elapsedSeconds: number;
  usage: Usage;
}

export function clockTestDecides(
  elapsedSeconds: number,
  gapSeconds: number,
  ttlSeconds: number,
): boolean {
  return gapSeconds < ttlSeconds && elapsedSeconds + gapSeconds > ttlSeconds;
}

function outcomeOf(usage: Usage): 'hit' | 'miss' | 'partial' {
  if (usage.cacheRead === 0) {
    return 'miss';
  }
  return usage.cacheWrite === 0 ? 'hit' : 'partial';
}

function ambiguous(question: string): string[] {
  return [`at least one send read only part of the prefix, so ${question} is ambiguous`];
}

function anyPartial(sends: readonly Send[]): boolean {
  return sends.some((entry) => outcomeOf(entry.usage) === 'partial');
}

function sendsOf(results: readonly SendOutcome[], steps: readonly Step[]): Send[] {
  const sends: Send[] = [];
  let gapSeconds = 0;

  for (const step of steps) {
    if (step.kind === 'wait') {
      gapSeconds += step.seconds;
      continue;
    }
    const outcome = results[sends.length];
    if (outcome === undefined) {
      break;
    }
    sends.push({ gapSeconds, elapsedSeconds: outcome.elapsedSeconds, usage: outcome.usage });
    gapSeconds = 0;
  }

  return sends;
}

function cliffVerdict(sends: readonly Send[]): string[] {
  const after = sends.slice(1);
  if (anyPartial(after)) {
    return ambiguous('where the cache expires');
  }
  const held = after.findLast((entry) => outcomeOf(entry.usage) === 'hit');
  const lost = after.find((entry) => outcomeOf(entry.usage) === 'miss');

  if (lost === undefined) {
    return [
      `the cache held through every gap, the longest being ${gapLabel(held?.gapSeconds ?? 0)}`,
    ];
  }
  if (held === undefined) {
    return [`every gap missed, the shortest being ${gapLabel(lost.gapSeconds)}`];
  }
  if (held.gapSeconds > lost.gapSeconds) {
    const both = `${gapLabel(held.gapSeconds)} gap hit after a ${gapLabel(lost.gapSeconds)} gap`;
    return [`a ${both} missed, so there is no clean cliff`];
  }
  return [
    `the cache held through a ${gapLabel(held.gapSeconds)} gap and missed at ${gapLabel(lost.gapSeconds)}`,
  ];
}

function refreshTail(last: Send | undefined): string {
  if (last === undefined) {
    return 'and no closing gap was sent';
  }
  const label = gapLabel(last.gapSeconds);
  return outcomeOf(last.usage) === 'hit'
    ? `and the ${label} gap hit too`
    : `and only the ${label} gap missed`;
}

function refreshVerdict(sends: readonly Send[]): string[] {
  const after = sends.slice(1);
  if (anyPartial(after)) {
    return ambiguous('whether a read refreshes the TTL');
  }
  const early = after.slice(0, -1);
  const missed = early.find((entry) => outcomeOf(entry.usage) === 'miss');
  if (missed !== undefined) {
    return [`a ${gapLabel(missed.gapSeconds)} gap missed, so a read does not refresh the TTL`];
  }
  const label = gapLabel(early.at(0)?.gapSeconds ?? 0);
  const held = `${early.length} gaps of ${label} all read the full prefix`;
  return [`${held}, so a read refreshes the TTL, ${refreshTail(after.at(-1))}`];
}

function clockStartVerdict(sends: readonly Send[]): string[] {
  const first = sends.at(0);
  const last = sends.at(-1);
  if (first === undefined || last === undefined || sends.length < 2) {
    return ['no second send landed, so nothing can be said about the clock'];
  }
  const outcome = outcomeOf(last.usage);
  const gap = gapLabel(last.gapSeconds);
  if (outcome === 'partial') {
    return ambiguous('when the TTL clock starts');
  }

  const answer = Math.round(first.elapsedSeconds);
  if (!clockTestDecides(first.elapsedSeconds, last.gapSeconds, SHORT_TTL_SECONDS)) {
    const total = Math.round(first.elapsedSeconds + last.gapSeconds);
    return [
      `the answer took ${answer}s and the gap was ${gap}, ${total}s in total, so both clocks predict the same outcome and the run decides nothing`,
      `for a verdict the answer plus the gap must exceed the ${SHORT_TTL_SECONDS}s TTL while the gap alone stays under it`,
    ];
  }

  const setup = `the answer took ${answer}s, then a ${gap} gap`;
  return outcome === 'hit'
    ? [`${setup} still read the full prefix, so the clock starts when the response ends`]
    : [`${setup} missed, so the clock starts at request start and a long answer eats the window`];
}

function oneHourVerdict(sends: readonly Send[]): string[] {
  const first = sends.at(0);
  const last = sends.at(-1);
  if (first === undefined || last === undefined || sends.length < 2) {
    return ['fewer than two sends landed, so nothing can be said about the 1h TTL'];
  }
  if (first.usage.write1h === 0 && first.usage.write5m > 0) {
    return ['the 1h request was billed as a 5m write, so ttl 1h did not reach the API'];
  }
  const outcome = outcomeOf(last.usage);
  const gap = gapLabel(last.gapSeconds);
  if (outcome === 'partial') {
    return ambiguous('whether a 1h write survives');
  }
  return outcome === 'hit'
    ? [`a 1h write survived a ${gap} gap`]
    : [`a 1h write did not survive a ${gap} gap`];
}

function promoteVerdict(sends: readonly Send[]): string[] {
  const last = sends.at(-1);
  if (last === undefined) {
    return ['no closing send landed, so nothing can be said about promotion'];
  }
  const outcome = outcomeOf(last.usage);
  const gap = gapLabel(last.gapSeconds);
  if (outcome === 'partial') {
    return ambiguous('whether a 1h re-send extends the TTL');
  }
  return outcome === 'hit'
    ? [`the last send read the whole prefix after a ${gap} gap, so a 1h re-send extended the TTL`]
    : [`the last send missed after a ${gap} gap, so a 1h re-send did not extend the TTL`];
}

function mixedVerdict(sends: readonly Send[]): string[] {
  const first = sends.at(0);
  const last = sends.at(-1);
  if (first === undefined) {
    return ['no send landed, so nothing can be said about mixed TTLs'];
  }
  const { write1h, write5m } = first.usage;
  const both = write1h > 0 && write5m > 0;
  const split = both
    ? `the write split ${write1h} tokens at 1h and ${write5m} at 5m`
    : `the write did not split: ${write1h} tokens at 1h and ${write5m} at 5m`;
  if (last === undefined || sends.length < 2) {
    return [split];
  }
  const gap = gapLabel(last.gapSeconds);
  const outcome = outcomeOf(last.usage);
  if (outcome === 'partial') {
    return [
      split,
      `after ${gap} only ${last.usage.cacheRead} tokens still read, so the 1h head outlived the 5m tail`,
    ];
  }
  return [
    split,
    outcome === 'hit' ? `after ${gap} the whole prompt still read` : `after ${gap} nothing read`,
  ];
}

function upgradedTo1h(sends: readonly Send[], steps: readonly Step[]): boolean {
  const writes5m = steps
    .filter((step) => step.kind === 'send')
    .flatMap((step, index) => {
      const usage = sends[index]?.usage;
      return step.ttl === '5m' && usage !== undefined && usage.cacheWrite > 0 ? [usage] : [];
    });
  return writes5m.length > 0 && writes5m.every((usage) => usage.write5m === 0);
}

function priceVerdict(sends: readonly Send[]): string[] {
  const written = sends.filter((entry) => entry.usage.cacheWrite > 0);
  const read = sends.filter((entry) => entry.usage.cacheRead > 0);
  return [
    `${written.length} sends wrote, ${read.length} read; bill each against the per-model price table`,
  ];
}

const VERDICTS: Record<ScheduleName, (sends: readonly Send[]) => string[]> = {
  cliff: cliffVerdict,
  refresh: refreshVerdict,
  'clock-start': clockStartVerdict,
  'one-hour': oneHourVerdict,
  promote: promoteVerdict,
  mixed: mixedVerdict,
  price: priceVerdict,
};

function upgradeNote(steps: readonly Step[]): string {
  return wallSeconds(steps) === 0
    ? 'every write asked for 5m came back as ephemeral_1h tokens, so this endpoint upgrades every write to 1h'
    : 'note: every 5m write was billed as 1h, so the 5m TTL was never under test here';
}

export function verdict(
  schedule: ScheduleName,
  results: readonly SendOutcome[],
  steps: readonly Step[],
): string {
  const sends = sendsOf(results, steps);
  if (sends.length === 0) {
    return 'no sends landed';
  }
  const lines = VERDICTS[schedule](sends);
  if (upgradedTo1h(sends, steps)) {
    lines.push(upgradeNote(steps));
  }
  return lines.join('\n');
}
