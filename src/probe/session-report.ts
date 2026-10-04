import { say } from '../cli.ts';
import { readMcpConfig } from '../doctor/read.ts';
import { FACTORY_MCP, INSTALLED_DROID } from '../paths.ts';
import { clearWhileTyping, describeClear } from './clear.ts';
import type { FirstSendOptions } from './first-send.ts';
import { describeFirstSend, sendFirstMessage } from './first-send.ts';
import { askForHighlight, describeHighlight } from './highlight.ts';
import type { LaunchEnv } from './launch.ts';
import { countMcpChildren, describeMcpChildren } from './mcp-children.ts';
import type { NoticeOptions } from './notice.ts';
import { describeNotice, noticeLostReport, runNotice } from './notice.ts';

export { FIRST_SEND_PROMPT } from './first-send.ts';
export { DEFAULT_NOTICE_TYPE } from './notice.ts';
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
  if (noticeLostReport(reading)) {
    process.exitCode = 1;
  }
}

export interface McpChildrenCommandOptions {
  settle: number;
  env: LaunchEnv;
  mcp?: string;
}

export async function mcpChildren(
  binary: string | undefined,
  options: McpChildrenCommandOptions,
): Promise<void> {
  say(
    `waiting ${options.settle}s after the input box; a server counts as running while a process under this droid carries its package name or command`,
  );
  const readings = await countMcpChildren(binary ?? INSTALLED_DROID, {
    settle: options.settle,
    env: options.env,
    mcp: readMcpConfig(options.mcp ?? FACTORY_MCP),
  });
  say(describeMcpChildren(readings));
}

export async function firstSend(binary: string, options: FirstSendOptions): Promise<void> {
  const reading = await sendFirstMessage(binary, options);
  say(describeFirstSend(reading));
  if (reading.replyMs === undefined || reading.queued) {
    process.exitCode = 1;
  }
}
