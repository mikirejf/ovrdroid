import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import { FACTORY_DROIDS } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { anyFailed, describeVerdicts } from './busy-signal-report.ts';
import type { FrameGapEvidence, GapAnswer } from './frame-gap-report.ts';
import {
  answerFor,
  CHILD_WORD,
  frameGapVerdicts,
  MAIN_WORD,
  REPLY_LINES,
  replyLine,
  replyText,
  WOKEN_REPLY,
} from './frame-gap-report.ts';
import { TERMINAL_SIZE } from './launch.ts';
import { poll } from './poll.ts';
import { droidFilePath, droidFileText, send, settle, waitFor } from './rewind.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

const WORKING_LINE = /\d+ droids? working/u;
const SPINNER_HINT = 'to stop)';
const DROID_TYPE = 'ovrdroid-frame-gap-probe';
const PARAGRAPH_CHUNK = 2;
const EVENT_STREAM = { 'content-type': 'text/event-stream' };
const FLAGS = { flags: { droids_view: false }, configs: {} };

export const DEFAULT_FRAME_GAP_TIMEOUT_S = 60;

export interface FrameGapOptions {
  cwd: string;
  timeout: number;
}

interface Stub {
  url: string;
  release: () => void;
  stop: () => Promise<void>;
}

interface Run {
  session: Session;
  stub: Stub;
  output: () => string;
  timeoutMs: number;
}

function replyDeltas(): string[] {
  const paragraphs = replyText().split('\n\n');
  return Array.from(
    { length: Math.ceil(paragraphs.length / PARAGRAPH_CHUNK) },
    (_delta, index) =>
      `${paragraphs.slice(index * PARAGRAPH_CHUNK, (index + 1) * PARAGRAPH_CHUNK).join('\n\n')}\n\n`,
  );
}

function eventsFor(answer: GapAnswer, callId: string): string[] {
  if (answer === 'launch') {
    return toolEvents({
      id: callId,
      name: 'Task',
      input: {
        subagent_type: DROID_TYPE,
        description: 'frame gap droid',
        prompt: `${CHILD_WORD} hold`,
        run_in_background: true,
      },
    });
  }
  if (answer === 'reply') {
    return streamEvents(replyDeltas());
  }
  return streamEvents([answer === 'hold' ? 'done' : WOKEN_REPLY]);
}

function startStub(callId: string): Stub {
  const held = Promise.withResolvers<boolean>();
  const release = (): void => {
    held.resolve(true);
  };
  const reply = async (request: Request): Promise<Response> => {
    if (!request.url.endsWith('/messages')) {
      return new Response(null, { status: 404 });
    }
    const answer = answerFor(await request.json());
    if (answer === 'hold') {
      await held.promise;
    }
    return new Response(eventsFor(answer, callId).join(''), { headers: EVENT_STREAM });
  };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: reply });
  return {
    url: `http://127.0.0.1:${server.port}`,
    release,
    stop: async () => {
      release();
      await server.stop(true);
    },
  };
}

function stubEnv(dir: string, url: string) {
  const settings = path.join(dir, 'settings.json');
  const flags = path.join(dir, 'feature-flags.json');
  writeFileSync(settings, JSON.stringify(stubSettings(url)));
  writeFileSync(flags, JSON.stringify(FLAGS));
  return { FACTORY_RUNTIME_SETTINGS_PATH: settings, FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: flags };
}

function shows(session: Session, test: (line: string) => boolean): true | undefined {
  return session.screen().some((line) => test(line)) ? true : undefined;
}

function idle(session: Session): true | undefined {
  return shows(session, (line) => line.includes(SPINNER_HINT)) === undefined ? true : undefined;
}

async function settleIdle(session: Session, timeoutMs: number): Promise<void> {
  await settle(session);
  await poll(() => idle(session), timeoutMs);
  await settle(session);
}

async function stages({ session, stub, output, timeoutMs }: Run): Promise<FrameGapEvidence> {
  await send(session, MAIN_WORD);
  await waitFor(
    'the long reply never finished',
    () => shows(session, (line) => line.includes(replyLine(REPLY_LINES - 1))),
    timeoutMs,
  );
  await waitFor(
    'no droid working line appeared under the input box',
    () => shows(session, (line) => WORKING_LINE.test(line)),
    timeoutMs,
  );
  await settleIdle(session, timeoutMs);
  const working = output();
  stub.release();
  await waitFor(
    'the droid working line never went away',
    () => (shows(session, (line) => WORKING_LINE.test(line)) === undefined ? true : undefined),
    timeoutMs,
  );
  await poll(() => shows(session, (line) => line.includes(WOKEN_REPLY)), timeoutMs);
  await settleIdle(session, timeoutMs);
  return {
    cols: TERMINAL_SIZE.cols,
    rows: TERMINAL_SIZE.rows,
    stages: [
      { name: 'after the turn ended, with a background droid working', output: working },
      { name: 'after the background droid finished and the turn it woke ended', output: output() },
    ],
  };
}

async function runStages(run: Run): Promise<FrameGapEvidence> {
  try {
    return await stages(run);
  } finally {
    await run.session.close();
  }
}

export async function captureFrameGap(
  binary: string,
  options: FrameGapOptions,
): Promise<FrameGapEvidence> {
  const stub = startStub(`toolu_framegap${crypto.randomUUID().slice(0, 8)}`);
  const dir = makeTempDir('frame-gap');
  const droidFile = droidFilePath(DROID_TYPE);
  let output = '';
  try {
    mkdirSync(FACTORY_DROIDS, { recursive: true });
    writeFileSync(droidFile, droidFileText(DROID_TYPE));
    const { session } = await openSettledSession(binary, {
      cwd: options.cwd,
      env: stubEnv(dir, stub.url),
      collect: false,
      screen: true,
      onData: (text) => {
        output += text;
      },
    });
    return await runStages({
      session,
      stub,
      output: () => output,
      timeoutMs: options.timeout * MS_PER_SECOND,
    });
  } finally {
    await stub.stop();
    for (const made of [dir, droidFile]) {
      rmSync(made, { recursive: true, force: true });
    }
  }
}
export async function frameGap(binary: string, options: FrameGapOptions): Promise<void> {
  say(
    `a stub model streams a ${REPLY_LINES}-paragraph reply that fills a ${TERMINAL_SIZE.cols}x${TERMINAL_SIZE.rows} screen and launches a background droid; the frame shrinks when the turn ends and again when the droid finishes`,
  );
  const verdicts = frameGapVerdicts(await captureFrameGap(binary, options));
  say(describeVerdicts(verdicts));
  if (anyFailed(verdicts)) {
    process.exitCode = 1;
  }
}
