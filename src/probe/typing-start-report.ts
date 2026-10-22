import type { Series } from './ab.ts';
import { summarise } from './ab.ts';
import { paintDetector } from './launch.ts';
import type { Measure } from './regressions.ts';

const SYNC_START = '\u001B[?2026h';
const BOX_BOTTOM_LEFT = '╰';
export const TYPING_START_FLOOR_MS = 20;

export interface TypingStartRun {
  shellMs: number;
  appMs: number;
  pairs: number;
}

export class StartupTimeline {
  shellAt: number | undefined;
  appAt: number | undefined;
  private readonly isAppPainted = paintDetector();
  private tail = '';
  private synced = false;

  feed(text: string, atMs: number): void {
    const window = this.tail + text;
    const syncAt = window.indexOf(SYNC_START);
    const before = syncAt === -1 ? window : window.slice(0, syncAt);
    if (this.shellAt === undefined && !this.synced && before.includes(BOX_BOTTOM_LEFT)) {
      this.shellAt = atMs;
    }
    this.synced ||= syncAt !== -1;
    this.tail = window.slice(1 - SYNC_START.length);
    if (this.appAt === undefined && this.isAppPainted(text)) {
      this.appAt = atMs;
    }
  }
}

export function typingStartMeasure(gapMs: number, series: Series<TypingStartRun>): Measure {
  return {
    label: `app paint, a key every ${gapMs}ms`,
    series: series.map(([binary, runs]) => [binary, runs.map((run) => run.appMs)]),
    floor: TYPING_START_FLOOR_MS,
  };
}

export function describeTypingStart(gapMs: number, series: Series<TypingStartRun>): string[] {
  return [
    `a key every ${gapMs}ms, from the shell's input box until the app frame`,
    ...series.flatMap(([binary, runs]) => {
      const shell = runs.map((run) => run.shellMs);
      const app = runs.map((run) => run.appMs);
      return [
        `  ${binary}`,
        `    shell ${summarise(shell)}`,
        `    app   ${summarise(app)}`,
        `    all   ${app.map((value) => value.toFixed(0)).join(' ')}`,
        `    keys  ${runs.map((run) => run.pairs).join(' ')} pairs typed per run`,
      ];
    }),
  ];
}
