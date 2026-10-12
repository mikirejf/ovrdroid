import type { Frame } from './session.ts';
import { plain } from './session.ts';

export const PENDING_TOOL = 'Execute';

export interface PendingPlan {
  leadInMs: number;
  windowMs: number;
}

export function sleepSeconds(plan: PendingPlan, marginMs: number): number {
  return Math.ceil((plan.leadInMs + plan.windowMs + marginMs) / 1000);
}

export function pendingCommand(seconds: number): string {
  return `sleep ${seconds}`;
}

export function showsPendingTool(frames: readonly Frame[], command: string): boolean {
  const last = frames.at(-1);
  if (last === undefined) {
    return false;
  }
  const text = plain(last.text);
  return text.includes(PENDING_TOOL) && text.includes(command);
}

export function pendingMissing(frames: readonly Frame[], command: string): string {
  const last = frames.at(-1);
  const seen =
    last === undefined ? 'no frame was drawn' : `the last frame read:\n${plain(last.text)}`;
  return `the last frame does not show the pending ${PENDING_TOOL} tool running "${command}", so the window measured something else; ${seen}`;
}
