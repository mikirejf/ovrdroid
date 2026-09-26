import { say } from '../cli.ts';
import { clearWhileTyping, describeClear } from './clear.ts';
import type { FirstSendOptions } from './first-send.ts';
import { describeFirstSend, sendFirstMessage } from './first-send.ts';
import { askForHighlight, describeHighlight } from './highlight.ts';
import type { NoticeOptions } from './notice.ts';
import { describeNotice, noticeLostReport, runNotice } from './notice.ts';

export { FIRST_SEND_PROMPT } from './first-send.ts';
export { DEFAULT_NOTICE_TYPE } from './notice.ts';

export async function highlight(binary: string): Promise<void> {
  const reading = await askForHighlight(binary);
  say(describeHighlight(reading));
  if (reading.crashed) {
    process.exitCode = 1;
  }
}

export async function clear(binary: string): Promise<void> {
  const reading = await clearWhileTyping(binary);
  say(describeClear(reading));
  if (!reading.kept) {
    process.exitCode = 1;
  }
}

export async function notice(binary: string, options: NoticeOptions): Promise<void> {
  const reading = await runNotice(binary, options);
  say(describeNotice(reading));
  if (noticeLostReport(reading)) {
    process.exitCode = 1;
  }
}

export async function firstSend(binary: string, options: FirstSendOptions): Promise<void> {
  const reading = await sendFirstMessage(binary, options);
  say(describeFirstSend(reading));
  if (reading.replyMs === undefined || reading.queued) {
    process.exitCode = 1;
  }
}
