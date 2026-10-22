import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { say } from '../cli.ts';
import {
  COPY_COMMAND,
  copyReply,
  INLINE_LONG_COMMAND,
  INLINE_REPLY_COMMAND,
  INLINE_RESIZE_COMMAND,
} from './code-copy-reply.ts';
import type { CodeCopyReading, RedrawReading, WideCommandReading } from './code-copy-report.ts';
import {
  describeCodeCopy,
  describeInlineCode,
  describeLiveFrames,
  describeRedraw,
  describeWideCommand,
  liveFramesClipped,
  readCodeCopy,
  readRedraw,
  readWideCommand,
  screensOf,
} from './code-copy-report.ts';
import { dies, launchEnv, PAINT_TIMEOUT_MS, paintDetector, probeAnswerer, race } from './launch.ts';
import { Ledger } from './owned-sessions.ts';
import { ENTER, SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import { pieces, streamEvents, stubSettings } from './stub-model.ts';

const PROMPT = 'Show me the install command.';
export const COPY_CHUNK_CHARS = 12;
export const COPY_GAP_MS = 60;
const QUIET_MS = 1500;
const REPLY_TIMEOUT_MS = 30_000;
const PASTE_START = '\u001B[200~';
const PASTE_END = '\u001B[201~';
const PASTE_SETTLE_MS = 300;

export interface CodeCopyOptions {
  cols: number;
  rows: number;
  resizeTo: number;
  chunk: number;
  gapMs: number;
}

export interface CodeCopyCapture {
  launch: string;
  reply: string;
  repaint: string;
  resize: string;
}

interface ReplyServer {
  url: string;
  streamed: () => Promise<void>;
  stop: () => Promise<void>;
}

function serveReply(text: string, chunk: number, gapMs: number): ReplyServer {
  const encoder = new TextEncoder();
  const events = streamEvents(pieces(text, chunk));
  const done = Promise.withResolvers<boolean>();
  const body = () =>
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
          // oxlint-disable-next-line no-await-in-loop
          await Bun.sleep(gapMs);
        }
        controller.close();
        done.resolve(true);
      },
    });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      await request.arrayBuffer();
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(body(), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    streamed: async () => {
      await done.promise;
    },
    stop: async () => {
      await server.stop(true);
    },
  };
}

class RawScreen {
  private text = '';
  private lastAt = performance.now();

  push(text: string): void {
    this.text += text;
    this.lastAt = performance.now();
  }

  mark(): number {
    this.lastAt = performance.now();
    return this.text.length;
  }

  since(mark: number): string {
    return this.text.slice(mark);
  }

  slice(from: number, to: number): string {
    return this.text.slice(from, to);
  }

  async quiet(quietMs: number, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() - this.lastAt < quietMs && performance.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      await Bun.sleep(50);
    }
  }
}

export async function captureCodeCopy(
  binary: string,
  options: CodeCopyOptions,
): Promise<CodeCopyCapture> {
  const server = serveReply(
    copyReply(options.cols, options.resizeTo),
    options.chunk,
    options.gapMs,
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-code-copy-'));
  const settings = path.join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify(stubSettings(server.url)));
  const decoder = new TextDecoder();
  const answer = probeAnswerer();
  const isPainted = paintDetector();
  const painted = Promise.withResolvers<boolean>();
  const screen = new RawScreen();
  const ledger = new Ledger();
  await using terminal = new Bun.Terminal({
    cols: options.cols,
    rows: options.rows,
    data(self, chunk) {
      const text = decoder.decode(chunk, { stream: true });
      answer(self, text);
      if (isPainted(text)) {
        painted.resolve(true);
      }
      screen.push(text);
    },
  });

  try {
    const child = Bun.spawn([binary], {
      terminal,
      env: launchEnv({ FACTORY_RUNTIME_SETTINGS_PATH: settings, ...ledger.env }),
    });
    ledger.adopt(child);
    await race(
      Promise.race([painted.promise, dies(child)]),
      PAINT_TIMEOUT_MS,
      `${binary}: no input box after ${PAINT_TIMEOUT_MS}ms`,
    );
    ledger.expectSession();
    await screen.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);

    terminal.write(PASTE_START + PROMPT + PASTE_END);
    await Bun.sleep(PASTE_SETTLE_MS);
    const replyMark = screen.mark();
    terminal.write(ENTER);
    await race(server.streamed(), REPLY_TIMEOUT_MS, 'Droid never asked the stub model');
    await screen.quiet(QUIET_MS, REPLY_TIMEOUT_MS);
    const repaintMark = screen.mark();
    process.kill(child.pid, 'SIGWINCH');
    await screen.quiet(QUIET_MS, REPLY_TIMEOUT_MS);

    const resizeMark = screen.mark();
    terminal.resize(options.resizeTo, options.rows);
    process.kill(child.pid, 'SIGWINCH');
    await screen.quiet(QUIET_MS, REPLY_TIMEOUT_MS);
    return {
      launch: screen.slice(0, replyMark),
      reply: screen.slice(replyMark, repaintMark),
      repaint: screen.slice(repaintMark, resizeMark),
      resize: screen.since(resizeMark),
    };
  } finally {
    await ledger.release();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface CodeCopyResult {
  reply: CodeCopyReading;
  resize: CodeCopyReading;
  inlineReply: CodeCopyReading;
  inlineResize: CodeCopyReading;
  longReply: CodeCopyReading;
  longResize: CodeCopyReading;
  wideReply: WideCommandReading;
  wideResize: WideCommandReading;
  redraw: RedrawReading;
  liveFrames: number;
}

export function readCapture(capture: CodeCopyCapture, options: CodeCopyOptions): CodeCopyResult {
  const screens = screensOf(capture, options);
  return {
    reply: readCodeCopy(capture.reply, COPY_COMMAND),
    resize: readCodeCopy(capture.resize, COPY_COMMAND),
    inlineReply: readCodeCopy(capture.reply, INLINE_REPLY_COMMAND),
    inlineResize: readCodeCopy(capture.resize, INLINE_RESIZE_COMMAND),
    longReply: readCodeCopy(capture.reply, INLINE_LONG_COMMAND),
    longResize: readCodeCopy(capture.resize, INLINE_LONG_COMMAND),
    wideReply: readWideCommand(screens.live, INLINE_LONG_COMMAND, options.cols),
    wideResize: readWideCommand(screens.resized, INLINE_LONG_COMMAND, options.resizeTo),
    redraw: readRedraw(screens.live, screens.repainted),
    liveFrames: liveFramesClipped(capture.reply, INLINE_LONG_COMMAND, options.cols),
  };
}

export interface CodeCopyCommandOptions extends CodeCopyOptions {
  dump?: string;
}

export async function codeCopy(binary: string, options: CodeCopyCommandOptions): Promise<void> {
  say(
    `a stub model replies with a ${COPY_COMMAND.length}-char shell command in a code block, with two shorter commands written as inline code in a sentence, placed so each one crosses the end of a line, and with a ${INLINE_LONG_COMMAND.length}-char inline command wider than the terminal, in a terminal ${options.cols} columns wide, then the terminal repaints at the same width and resizes to ${options.resizeTo}`,
  );
  const capture = await captureCodeCopy(binary, options);
  if (options.dump !== undefined) {
    for (const part of ['launch', 'reply', 'repaint', 'resize'] as const) {
      writeFileSync(`${options.dump}.${part}`, capture[part]);
    }
    say(`raw bytes written to ${options.dump}.launch, .reply, .repaint and .resize`);
  }
  const result = readCapture(capture, options);
  const resized = `after the resize to ${options.resizeTo}`;
  say(describeCodeCopy(result.reply, COPY_COMMAND, 'after the reply'));
  say(describeCodeCopy(result.resize, COPY_COMMAND, resized));
  say(describeInlineCode(result.inlineReply, INLINE_REPLY_COMMAND, 'after the reply'));
  say(describeInlineCode(result.inlineResize, INLINE_RESIZE_COMMAND, resized));
  say(describeCodeCopy(result.longReply, INLINE_LONG_COMMAND, 'after the reply (inline command)'));
  say(describeCodeCopy(result.longResize, INLINE_LONG_COMMAND, `${resized} (inline command)`));
  say(describeWideCommand(result.wideReply, INLINE_LONG_COMMAND, 'on the screen after the reply'));
  say(describeWideCommand(result.wideResize, INLINE_LONG_COMMAND, `on the screen ${resized}`));
  say(describeLiveFrames(result.liveFrames, INLINE_LONG_COMMAND, options.cols));
  say(describeRedraw(result.redraw, 'after the reply'));
  const readings = [
    result.reply,
    result.resize,
    result.inlineReply,
    result.inlineResize,
    result.longReply,
    result.longResize,
  ];
  const wide = [result.wideReply, result.wideResize];
  if (
    !readings.every((reading) => reading.lastIntact) ||
    !wide.every((reading) => reading.lines === 1) ||
    !result.redraw.same ||
    result.liveFrames === 0
  ) {
    process.exitCode = 1;
  }
}
