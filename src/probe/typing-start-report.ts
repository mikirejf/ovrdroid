import type { Series } from './ab.ts';
import { summarise } from './ab.ts';
import { findInputBox, hasInputBox, SYNC_START } from './input-box.ts';
import { paintDetector } from './launch.ts';
import type { Measure } from './regressions.ts';

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
  private shellOutput = '';
  private synced = false;

  feed(text: string, atMs: number): void {
    if (!this.synced) {
      const window = this.shellOutput + text;
      const syncAt = window.indexOf(SYNC_START);
      const before = syncAt === -1 ? window : window.slice(0, syncAt);
      if (this.shellAt === undefined && hasInputBox(before)) {
        this.shellAt = atMs;
      }
      this.synced = syncAt !== -1;
      this.shellOutput = this.synced ? '' : window;
    }
    if (this.appAt === undefined && this.isAppPainted(text)) {
      this.appAt = atMs;
    }
  }
}

export function assertFlatStartupBox(lines: readonly string[], stage: string): void {
  const box = findInputBox(lines);
  if (
    box === undefined ||
    !/^[─━]+$/u.test(box.topLine) ||
    !/^[─━]+$/u.test(box.bottomLine) ||
    lines
      .slice(box.top + 1, box.bottom)
      .some((line) => !line.startsWith('  ') || line.endsWith('│'))
  ) {
    throw new Error(`${stage}: expected a complete flat input box without corners or sides`);
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
