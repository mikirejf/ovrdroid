import type { Finding } from './stacked-report.ts';
import { chainsIn, flatten } from './stacked-report.ts';

export const APPROVAL_COMMAND = 'echo stacked-approval';
export const CASE_REQUESTS = 4;
export const CASE_TALLY = 'Read 1 file › Execute 1 command › Read 1 file';
const PENDING_TALLY = 'Read 1 file';
const PENDING_HEADER = `Execute ${APPROVAL_COMMAND}`;
const APPROVE_OPTION = 'Yes, allow';
const EXPANDED_HEADER = /\bExecute true\b/gu;

export interface ApprovalCapture {
  served: number;
  pending: readonly string[];
  screen: readonly string[];
}

export interface SwitchCapture {
  served: number;
  stacked: readonly string[];
  expanded: readonly string[];
  back: readonly string[];
}

function tallies(text: string): string[] {
  return chainsIn(text).map((chain) => chain.text);
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.map((value) => `'${value}'`).join(', ');
}

function times(text: string, part: string | RegExp): number {
  return typeof part === 'string' ? text.split(part).length - 1 : [...text.matchAll(part)].length;
}

function unrun(served: number): Finding[] {
  return [
    {
      pass: false,
      says: `the turn never ran, so nothing was tested: the stub model answered ${served} of ${CASE_REQUESTS} requests`,
    },
  ];
}

function readPending(frame: readonly string[]): Finding {
  const text = flatten(frame);
  const found = tallies(text);
  const header = text.indexOf(PENDING_HEADER);
  const tallyAt = text.indexOf(PENDING_TALLY);
  const pass =
    found.length === 1 &&
    found[0] === PENDING_TALLY &&
    tallyAt !== -1 &&
    header > tallyAt &&
    text.includes(APPROVE_OPTION);
  return pass
    ? {
        pass,
        says: `while the Execute waits for approval, its block and the prompt show below the open '${PENDING_TALLY}' line`,
      }
    : {
        pass,
        says: `while the Execute waits for approval the frame should hold one '${PENDING_TALLY}' line, then '${PENDING_HEADER}' and the '${APPROVE_OPTION}' prompt; tally lines: ${listed(found)}, header ${header === -1 ? 'missing' : 'present'}, prompt ${text.includes(APPROVE_OPTION) ? 'present' : 'missing'}`,
      };
}

export function readApproval(capture: ApprovalCapture): Finding[] {
  if (capture.served < CASE_REQUESTS) {
    return unrun(capture.served);
  }
  const text = flatten(capture.screen);
  const found = tallies(text);
  const left = times(text, APPROVAL_COMMAND);
  return [
    readPending(capture.pending),
    found.length === 1 && found[0] === CASE_TALLY
      ? { pass: true, says: `once approved the Execute joins the line: '${CASE_TALLY}', once` }
      : {
          pass: false,
          says: `after approval scrollback should hold one line '${CASE_TALLY}', and its tally lines are ${listed(found)}`,
        },
    left === 0
      ? { pass: true, says: 'no Execute block or approval prompt is left in scrollback' }
      : {
          pass: false,
          says: `'${APPROVAL_COMMAND}' is still in scrollback ${left} time(s): a leftover Execute block or prompt`,
        },
  ];
}

function readHistory(name: string, frame: readonly string[], stacked: boolean): Finding {
  const text = flatten(frame);
  const lines = times(text, CASE_TALLY);
  const blocks = times(text, EXPANDED_HEADER);
  const pass = stacked ? lines === 1 && blocks === 0 : lines === 0 && blocks === 1;
  const expected = stacked ? `one '${CASE_TALLY}' line` : "the expanded 'Execute true' block";
  return pass
    ? { pass, says: `${name}, history shows only ${expected}` }
    : {
        pass,
        says: `${name}, history should show only ${expected}, and scrollback holds ${lines} '${CASE_TALLY}' line(s) and ${blocks} 'Execute true' block(s)`,
      };
}

export function readSwitch(capture: SwitchCapture): Finding[] {
  if (capture.served < CASE_REQUESTS) {
    return unrun(capture.served);
  }
  return [
    readHistory('in stacked mode', capture.stacked, true),
    readHistory('after switching to expanded', capture.expanded, false),
    readHistory('after switching back to stacked', capture.back, true),
  ];
}
