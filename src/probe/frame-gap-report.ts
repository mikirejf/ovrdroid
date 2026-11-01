import type { Verdict } from './busy-signal-report.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import type { Fields } from './fields.ts';
import { TerminalScreen } from './terminal-screen.ts';

export const MAIN_WORD = 'FRAMEGAP';
export const CHILD_WORD = 'framegap-child:';
export const WOKEN_REPLY = 'Frame gap droid noted.';
export const REPLY_LINES = 40;

const REPLY_LINE = /Line (?<index>\d+) of the frame gap reply/gu;
const BOTTOM_MARK = '<<bottom row>>';
const CURSOR_ROWS = 1;
const TASK_TOOL = 'Task';
const TOOL_RESULT = 'tool_result';

export type GapAnswer = 'launch' | 'reply' | 'hold' | 'ok';

export interface FrameGapStage {
  name: string;
  output: string;
}

export interface FrameGapEvidence {
  cols: number;
  rows: number;
  stages: readonly FrameGapStage[];
}

export function replyLine(index: number): string {
  return `Line ${index} of the frame gap reply, one paragraph of a long answer.`;
}

export function replyText(): string {
  return Array.from({ length: REPLY_LINES }, (_line, index) => replyLine(index)).join('\n\n');
}

function openingText(messages: readonly Fields[]): string {
  const end = messages.findIndex((message) => worded(message, 'role') === 'assistant');
  return JSON.stringify(
    (end === -1 ? messages : messages.slice(0, end)).map((message) => message.get('content')),
  );
}

function carriesToolResult(message: Fields | undefined): boolean {
  return entriesOf(message ?? new Map(), 'content').some(
    (block) => worded(block, 'type') === TOOL_RESULT,
  );
}

export function answerFor(body: unknown): GapAnswer {
  const request = fieldsOf(body);
  const messages = entriesOf(request, 'messages');
  const opening = openingText(messages);
  if (opening.includes(CHILD_WORD)) {
    return 'hold';
  }
  if (!opening.includes(MAIN_WORD)) {
    return 'ok';
  }
  if (!messages.some((message) => worded(message, 'role') === 'assistant')) {
    const offersTask = entriesOf(request, 'tools').some(
      (tool) => worded(tool, 'name') === TASK_TOOL,
    );
    return offersTask ? 'launch' : 'ok';
  }
  return carriesToolResult(messages.at(-1)) ? 'reply' : 'ok';
}

export function screenOf(output: string, cols: number, rows: number): TerminalScreen {
  const screen = new TerminalScreen(cols, rows);
  screen.feed(output);
  return screen;
}

export function blankRowsAtBottom(output: string, cols: number, rows: number): number {
  const screen = screenOf(output, cols, rows);
  screen.feed(`\u001B[${rows};1H${BOTTOM_MARK}`);
  const lines = screen.lines();
  if (lines.at(-1) !== BOTTOM_MARK) {
    return 0;
  }
  let blank = 1;
  for (let at = lines.length - 2; at >= 0 && blank < rows && lines[at]?.trim() === ''; at -= 1) {
    blank += 1;
  }
  return blank;
}

function stageVerdict(stage: FrameGapStage, cols: number, rows: number): Verdict {
  const gap = Math.max(0, blankRowsAtBottom(stage.output, cols, rows) - CURSOR_ROWS);
  if (gap === 0) {
    return {
      pass: true,
      text: `${stage.name}: the frame stays on the bottom of the screen, only the cursor row under its last line`,
    };
  }
  return {
    pass: false,
    text: `${stage.name}: the frame sits ${gap} rows above the bottom of the screen, ${gap} blank rows under its last line`,
  };
}

function replyCounts(lines: readonly string[]): number[] {
  const counts = Array.from({ length: REPLY_LINES }, () => 0);
  for (const line of lines) {
    for (const match of line.matchAll(REPLY_LINE)) {
      const index = Number(match.groups?.['index']);
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return counts;
}

function historyVerdicts(output: string, cols: number, rows: number): Verdict[] {
  const lines = screenOf(output, cols, rows).lines();
  const filled: Verdict =
    lines.length > rows
      ? {
          pass: true,
          text: `the transcript scrolled past the top (${lines.length} lines on a ${rows}-row screen), so the frame sat on the bottom row before it shrank`,
        }
      : {
          pass: false,
          text: `the transcript never filled the ${rows}-row screen (${lines.length} lines), so nothing was tested`,
        };
  const counts = replyCounts(lines);
  const repeated = counts.flatMap((count, index) => (count > 1 ? [index] : []));
  const lost = counts.flatMap((count, index) => (count === 0 ? [index] : []));
  const [firstRepeated] = repeated;
  const [firstLost] = lost;
  let kept: Verdict = {
    pass: true,
    text: `scrollback and screen hold each of the ${REPLY_LINES} reply lines once`,
  };
  if (firstRepeated !== undefined) {
    kept = {
      pass: false,
      text: `scrollback repeats ${repeated.length} reply lines, e.g. "${replyLine(firstRepeated)}" shows ${counts[firstRepeated]} times`,
    };
  } else if (firstLost !== undefined) {
    kept = {
      pass: false,
      text: `scrollback and screen lost ${lost.length} reply lines, e.g. "${replyLine(firstLost)}"`,
    };
  }
  return [filled, kept];
}

export function frameGapVerdicts(evidence: FrameGapEvidence): Verdict[] {
  const last = evidence.stages.at(-1);
  if (last === undefined) {
    return [{ pass: false, text: 'the run recorded no stage, so nothing was tested' }];
  }
  return [
    ...historyVerdicts(last.output, evidence.cols, evidence.rows),
    ...evidence.stages.map((stage) => stageVerdict(stage, evidence.cols, evidence.rows)),
  ];
}
