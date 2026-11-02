import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { guard, say } from '../cli.ts';
import { withLiveDir } from './live-session.ts';
import { poll } from './poll.ts';
import { send, settle } from './rewind.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import type { StackedCapture } from './stacked-report.ts';
import {
  describeFindings,
  EDIT_FILE,
  NEW_LINE,
  OLD_LINE,
  readStacked,
  THINKING_DELTAS,
  TURN_REQUESTS,
} from './stacked-report.ts';
import { toolNamesIn } from './stale-edit-cases.ts';
import { streamEvents, stubSettings, toolBatchEvents } from './stub-model.ts';
import type { ToolCall } from './stub-model.ts';

const MODEL = 'stub-stacked';
const STUB_NAME = 'Stub Stream';
const PROMPT = 'Go through the files.';
const HOLD_AT = 5;
const HOLD_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 60_000;
const MID_RUN_QUIET_MS = 800;
const MID_RUN_TIMEOUT_MS = 3000;

function plan(dir: string, token: string): ToolCall[] {
  const file = (name: string) => path.join(dir, name);
  const calls: Pick<ToolCall, 'name' | 'input'>[] = [
    { name: 'Read', input: { file_path: file('a.txt') } },
    { name: 'Read', input: { file_path: file('b.txt') } },
    { name: 'Grep', input: { pattern: 'needle', path: dir, output_mode: 'content' } },
    { name: 'Execute', input: { command: 'true', riskLevel: 'low' } },
    { name: 'Execute', input: { command: 'false', riskLevel: 'low' } },
    {
      name: 'Edit',
      input: { file_path: file(EDIT_FILE), old_str: OLD_LINE, new_str: NEW_LINE },
    },
    { name: 'Read', input: { file_path: file('c.txt') } },
  ];
  return calls.map(({ name, input }, index) => ({
    name,
    input,
    id: `toolu_stacked${token}_${index}`,
  }));
}

const CTRL_O = '\u000F';
const KEY_REACT_MS = 500;

interface ThinkingEvent {
  type: string;
  index: number;
  content_block?: { type: string; thinking: string };
  delta?: { type: string; thinking?: string; signature?: string };
}

function sse(data: ThinkingEvent): string {
  return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

interface Reply {
  head: string[];
  tail: string[];
}

function thinkingReply(toolEvents: readonly string[]): Reply {
  const deltas = THINKING_DELTAS.map((thinking) =>
    sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } }),
  );
  const [start = '', ...rest] = toolEvents;
  return {
    head: [
      start,
      sse({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
      ...deltas.slice(0, -1),
    ],
    tail: [
      ...deltas.slice(-1),
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'stub-signature' },
      }),
      sse({ type: 'content_block_stop', index: 0 }),
      ...rest.map((chunk) => chunk.replace('"index":0', '"index":1')),
    ],
  };
}

function replyEvents(calls: readonly ToolCall[], step: number): Reply {
  const call = calls[step];
  if (call === undefined) {
    return { head: streamEvents(['done']), tail: [] };
  }
  const events = toolBatchEvents([call]);
  return step === 0 ? thinkingReply(events) : { head: events, tail: [] };
}

function streamed(reply: Reply, gate: Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(reply.head.join('')));
      await gate;
      controller.enqueue(encoder.encode(reply.tail.join('')));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function writeProject(dir: string): void {
  writeFileSync(path.join(dir, EDIT_FILE), `${OLD_LINE}\nsecond line\n`);
  writeFileSync(path.join(dir, 'b.txt'), 'needle in b\n');
  writeFileSync(path.join(dir, 'c.txt'), 'plain c\n');
}

interface Stub {
  url: string;
  served: () => number;
  held: Promise<boolean>;
  thinking: Promise<boolean>;
  release: () => void;
  releaseThinking: () => void;
  stop: () => Promise<void>;
}

function startStub(calls: readonly ToolCall[]): Stub {
  const held = Promise.withResolvers<boolean>();
  const thinking = Promise.withResolvers<boolean>();
  const thinkingGate = Promise.withResolvers<boolean>();
  const released = Promise.withResolvers<boolean>();
  let served = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const names = toolNamesIn(await request.json());
      if (names.length === 0) {
        return new Response(streamEvents(['ok']).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      const step = served;
      served += 1;
      if (step === HOLD_AT) {
        held.resolve(true);
        await released.promise;
      }
      const reply = replyEvents(calls, step);
      if (reply.tail.length === 0) {
        return new Response(reply.head.join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      queueMicrotask(() => {
        thinking.resolve(true);
      });
      return streamed(reply, thinkingGate.promise);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    served: () => served,
    held: held.promise,
    thinking: thinking.promise,
    releaseThinking: () => {
      thinkingGate.resolve(true);
    },
    release: () => {
      released.resolve(true);
    },
    stop: async () => {
      thinkingGate.resolve(true);
      released.resolve(true);
      await server.stop(true);
    },
  };
}

async function driveTurn(session: Session, stub: Stub): Promise<StackedCapture> {
  await send(session, PROMPT);
  let midThinking: string[] | undefined;
  if (await Promise.race([stub.thinking, Bun.sleep(HOLD_TIMEOUT_MS).then(() => false)])) {
    await Bun.sleep(KEY_REACT_MS);
    await session.quiet(MID_RUN_QUIET_MS, MID_RUN_TIMEOUT_MS);
    midThinking = session.screen();
  }
  stub.releaseThinking();
  const reached = await Promise.race([stub.held, Bun.sleep(HOLD_TIMEOUT_MS).then(() => false)]);
  let midRun: string[] | undefined;
  if (reached) {
    await session.quiet(MID_RUN_QUIET_MS, MID_RUN_TIMEOUT_MS);
    midRun = session.screen();
  }
  stub.release();
  await poll(() => (stub.served() >= TURN_REQUESTS ? true : undefined), TURN_TIMEOUT_MS);
  await settle(session);
  const screen = session.screen();
  session.press(CTRL_O);
  await Bun.sleep(KEY_REACT_MS);
  await session.quiet(MID_RUN_QUIET_MS, MID_RUN_TIMEOUT_MS);
  return {
    served: stub.served(),
    screen,
    transcript: session.screen(),
    ...(midThinking !== undefined && { midThinking }),
    ...(midRun !== undefined && { midRun }),
  };
}

export async function captureStacked(binary: string, display: string): Promise<StackedCapture> {
  const token = randomUUID().slice(0, 8);
  return await withLiveDir('stacked', async (dir) => {
    writeProject(dir);
    const stub = startStub(plan(dir, token));
    try {
      const settings = path.join(dir, 'settings.json');
      writeFileSync(
        settings,
        JSON.stringify({
          ...stubSettings(stub.url, MODEL),
          toolResultDisplay: display,
          showThinkingInMainView: true,
          streamAssistantResponses: true,
        }),
      );
      const { session } = await openSettledSession(binary, {
        cwd: dir,
        env: { FACTORY_RUNTIME_SETTINGS_PATH: settings },
        screen: true,
      });
      const drive = async (): Promise<StackedCapture> => {
        if (!session.screen().some((line) => line.includes(STUB_NAME))) {
          throw new Error(
            `${binary} did not take the probe's settings (toolResultDisplay '${display}'; the status bar does not name '${STUB_NAME}'), so the prompt was not sent: it would reach a real model`,
          );
        }
        return await driveTurn(session, stub);
      };
      try {
        const capture = await drive();
        await session.close();
        return capture;
      } catch (error) {
        await session.close().catch(() => null);
        throw error;
      }
    } finally {
      await stub.stop();
    }
  });
}

export interface StackedOptions {
  display: string;
  print?: boolean;
}

function printFrame(title: string, frame: readonly string[] | undefined): void {
  say(`--- ${title}`);
  say((frame ?? ['(not captured)']).join('\n'));
}

export async function stacked(binary: string, options: StackedOptions): Promise<void> {
  say(
    'a stub model opens with a thinking block, then reads two files, greps, runs two commands (one fails), edits a file and reads a third, with Tool result display set to stacked: does the thinking draw as one summary row, do the non-edit calls share one growing line with the edit inline, and does scrollback keep exactly one copy of each line?',
  );
  const capture = await captureStacked(binary, options.display);
  const findings = readStacked(capture);
  if (options.print === true) {
    printFrame('while the thinking streams', capture.midThinking);
    printFrame('mid-run frame', capture.midRun);
    printFrame('screen after the turn', capture.screen);
    printFrame('after Ctrl+O', capture.transcript);
  }
  say(describeFindings(findings));
  if (findings.some((finding) => !finding.pass)) {
    process.exitCode = 1;
  }
}

export function registerStackedCommand(program: Command): void {
  program
    .command('stacked')
    .description(
      'with Tool result display set to stacked and Show thinking on, run a stub-model turn that opens with a thinking block, then reads, a grep, two commands (one failing), an edit and a read: does the thinking draw as one summary row, do the non-edit calls collapse into one growing line with the edit inline, does a mid-run frame show the counts so far with a ↳ line for the latest call, and does scrollback keep exactly one copy of each line?',
    )
    .argument('<binary>')
    .option(
      '--display <value>',
      'value for the toolResultDisplay setting; a build without the stacked patch rejects stacked, so pass expanded to run it end to end',
      'stacked',
    )
    .option('--print', 'print the mid-run frame, the final screen and the Ctrl+O frame')
    .action(guard(stacked));
}
