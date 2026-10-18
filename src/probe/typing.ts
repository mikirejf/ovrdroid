export const TYPED_KEY = 'Z';
const BOX_ROW = '│ ';

export interface TypingReading {
  sent: number;
  shown: number;
  firstEchoMs: number | undefined;
  maxLagMs: number;
  maxLagAtMs: number;
}

export function keysInBox(lines: readonly string[], key: string = TYPED_KEY): number {
  return (
    lines
      .filter((line) => line.startsWith(BOX_ROW))
      .join('')
      .split(key).length - 1
  );
}

export function readTyping(sentAt: readonly number[], shownAt: readonly number[]): TypingReading {
  let maxLagMs = 0;
  let maxLagAtMs = 0;
  for (const [index, sent] of sentAt.entries()) {
    const lag = (shownAt[index] ?? Number.POSITIVE_INFINITY) - sent;
    if (lag > maxLagMs) {
      maxLagMs = lag;
      maxLagAtMs = sent;
    }
  }
  return {
    sent: sentAt.length,
    shown: Math.min(shownAt.length, sentAt.length),
    firstEchoMs: shownAt[0],
    maxLagMs,
    maxLagAtMs,
  };
}

function ms(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(0)}ms` : 'never';
}

export function describeTyping(reading: TypingReading): string {
  const first =
    reading.firstEchoMs === undefined
      ? 'no key ever reached the input box'
      : `first key showed ${ms(reading.firstEchoMs)} after spawn`;
  const missing = reading.sent - reading.shown;
  const lost = missing > 0 ? `, ${missing} of ${reading.sent} keys never showed` : '';
  return `${first}; slowest key took ${ms(reading.maxLagMs)} to show, typed ${ms(reading.maxLagAtMs)} after spawn${lost}`;
}
