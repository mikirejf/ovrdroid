import { say } from '../cli.ts';
import { INSTALLED_DROID } from '../paths.ts';
import { anyFailed, busyVerdicts, describeVerdicts } from './busy-signal-report.ts';
import type { BusySignalOptions } from './busy-signal.ts';
import { runBusySignal, saveEvidence, STUB_MODEL_NAME } from './busy-signal.ts';
import { clearWhileTyping, describeClear } from './clear.ts';
import type { FirstSendOptions } from './first-send.ts';
import { describeFirstSend, sendFirstMessage } from './first-send.ts';
import { askForHighlight, describeHighlight } from './highlight.ts';
import type { McpChildrenCommandOptions } from './mcp-children.ts';
import { runMcpChildren } from './mcp-children.ts';
import type { NoticeOptions } from './notice.ts';
import { describeNotice, noticeVerdict, runNotice } from './notice.ts';
import { describeRewind, readRewind, rewindVerdicts } from './rewind-report.ts';
import type { RewindOptions } from './rewind.ts';
import { runRewind } from './rewind.ts';

export { FIRST_SEND_PROMPT } from './first-send.ts';
export { DEFAULT_NOTICE_TYPE } from './notice.ts';
export { DEFAULT_BUSY_TIMEOUT_S } from './busy-signal.ts';
export { DEFAULT_REWIND_TIMEOUT_S } from './rewind.ts';

export interface BusySignalCommand extends Omit<BusySignalOptions, 'switchSession'> {
  view: boolean;
  skipSwitch: boolean;
}
export { shield } from './shield-report.ts';
export { DEFAULT_SETTLE_S, envPair } from './mcp-children.ts';

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
  if (noticeVerdict(reading) !== 'carried') {
    process.exitCode = 1;
  }
}

export async function rewind(binary: string, options: RewindOptions): Promise<void> {
  const verdicts = rewindVerdicts(readRewind(await runRewind(binary, options)));
  say(describeRewind(verdicts));
  if (verdicts.some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}

export async function busySignal(binary: string, options: BusySignalCommand): Promise<void> {
  const evidence = await runBusySignal(binary, { ...options, switchSession: !options.skipSwitch });
  if (options.out !== undefined) {
    for (const file of saveEvidence(evidence, options.out)) {
      say(`saved ${file}`);
    }
  }
  const verdicts = busyVerdicts(evidence, STUB_MODEL_NAME, { requireView: options.view });
  say(describeVerdicts(verdicts));
  if (anyFailed(verdicts)) {
    process.exitCode = 1;
  }
}

export async function mcpChildren(
  binary: string | undefined,
  options: McpChildrenCommandOptions,
): Promise<void> {
  const verdict = await runMcpChildren(binary ?? INSTALLED_DROID, options);
  say(verdict.reason);
  if (!verdict.pass) {
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
