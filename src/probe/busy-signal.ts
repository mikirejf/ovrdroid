import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND } from '../cli.ts';
import { FACTORY_DROIDS } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import type { BusyEvidence, Chunk, MarkName, Recording } from './busy-signal-report.ts';
import { describeTimeline, IDLE, progressEvents } from './busy-signal-report.ts';
import { poll } from './poll.ts';
import { LAUNCH_WORD } from './rewind-report.ts';
import { droidFilePath, droidFileText, send, settle, startStub, waitFor } from './rewind.ts';
import { openSettledSession } from './session.ts';
import type { Session } from './session.ts';
import { stubSettings } from './stub-model.ts';

const DROID_TYPE = 'ovrdroid-busy-probe';
const ALT_S = '\u001Bs';
const ESCAPE = '\u001B';
const VIEW_TITLE = 'Droids View';
const VIEW_TIMEOUT_MS = 8000;
const WORKING_LINE = /\d+ droids? working/u;
const TURN_REPLY = /⛬\s+ok/u;
const NEW_SESSION = '/new';
const CLEAR_WAIT_MS = 6000;

export const DEFAULT_BUSY_TIMEOUT_S = 60;
export const STUB_MODEL_NAME = 'Stub Stream';

export const SAVED_FILES = {
  timeline: 'busy-signal.txt',
  view: 'droids-view.txt',
} as const;

export interface BusySignalOptions {
  cwd: string;
  timeout: number;
  out: string | undefined;
  switchSession: boolean;
}

interface Fixture {
  env: Record<string, string>;
  release: () => void;
}

function showsWorking(session: Session): true | undefined {
  return session.screen().some((line) => WORKING_LINE.test(line)) ? true : undefined;
}

function turnEnded(session: Session): true | undefined {
  const lines = session.screen();
  return lines.some((line) => TURN_REPLY.test(line)) &&
    lines.some((line) => WORKING_LINE.test(line))
    ? true
    : undefined;
}

function stopped(session: Session): true | undefined {
  return showsWorking(session) === undefined ? true : undefined;
}

function viewLines(session: Session): readonly string[] | undefined {
  const lines = session.screen();
  return lines.some((line) => line.startsWith(VIEW_TITLE)) ? lines : undefined;
}

function viewWithChip(session: Session): readonly string[] | undefined {
  const lines = viewLines(session);
  return lines?.some((line) => line.includes(STUB_MODEL_NAME)) === true ? lines : undefined;
}

class Recorder {
  readonly chunks: Chunk[] = [];
  readonly marks: Partial<Record<MarkName, number>> = {};

  take(text: string): undefined {
    this.chunks.push({ atMs: performance.now(), text });
  }

  mark(name: MarkName): undefined {
    this.marks[name] = performance.now();
  }

  cleared(): true | undefined {
    return progressEvents(this.chunks).at(-1)?.payload === IDLE ? true : undefined;
  }

  recording(): Recording {
    return { chunks: this.chunks, marks: this.marks };
  }
}

interface Run {
  session: Session;
  recorder: Recorder;
  timeoutMs: number;
}

async function openAndCloseView({
  session,
  recorder,
}: Run): Promise<readonly string[] | undefined> {
  session.press(ALT_S);
  const opened = await poll(() => viewLines(session), VIEW_TIMEOUT_MS);
  if (opened === undefined) {
    return undefined;
  }
  const lines = await poll(() => viewWithChip(session), VIEW_TIMEOUT_MS);
  recorder.mark('viewOpen');
  session.press(ESCAPE);
  await waitFor(
    'Escape did not close the droids view',
    () => (viewLines(session) === undefined ? true : undefined),
    VIEW_TIMEOUT_MS,
  );
  return lines ?? opened;
}

async function launchHeldSubagent({ session, recorder, timeoutMs }: Run): Promise<void> {
  recorder.mark('prompt');
  await send(session, `${LAUNCH_WORD} kept`);
  await waitFor(
    'the turn did not end with a sub-agent running',
    () => turnEnded(session),
    timeoutMs,
  );
  await settle(session);
  recorder.mark('turnEnded');
}

async function finishHeldSubagent(
  { session, recorder, timeoutMs }: Run,
  fixture: Fixture,
): Promise<void> {
  fixture.release();
  await waitFor('the sub-agent never finished', () => stopped(session), timeoutMs);
  await poll(() => recorder.cleared(), CLEAR_WAIT_MS);
  await settle(session);
  recorder.mark('finished');
}

interface Scenario {
  binary: string;
  options: BusySignalOptions;
  fixture: Fixture;
}

async function runScenario(
  { binary, options, fixture }: Scenario,
  drive: (run: Run) => Promise<void>,
): Promise<Recorder> {
  const recorder = new Recorder();
  const { session } = await openSettledSession(binary, {
    cwd: options.cwd,
    env: fixture.env,
    screen: true,
    onData: (text) => {
      recorder.take(text);
    },
  });
  try {
    await drive({ session, recorder, timeoutMs: options.timeout * MS_PER_SECOND });
  } finally {
    await session.close();
    recorder.mark('exited');
  }
  return recorder;
}

async function withScenario(
  binary: string,
  options: BusySignalOptions,
  drive: (run: Run, fixture: Fixture) => Promise<void>,
): Promise<Recorder> {
  const run = randomUUID().slice(0, 8);
  const stub = startStub((tag) => `toolu_busy${run}_${tag}`, DROID_TYPE);
  const dir = makeTempDir('busy-signal');
  const droidFile = droidFilePath(DROID_TYPE);
  try {
    mkdirSync(FACTORY_DROIDS, { recursive: true });
    writeFileSync(droidFile, droidFileText(DROID_TYPE));
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(stubSettings(stub.url)));
    const flagsFile = path.join(dir, 'feature-flags.json');
    writeFileSync(flagsFile, JSON.stringify({ flags: { droids_view: true }, configs: {} }));
    const fixture: Fixture = {
      release: stub.release,
      env: {
        FACTORY_RUNTIME_SETTINGS_PATH: settingsFile,
        FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: flagsFile,
        HERDR_ENV: '1',
        HERDR_BIN_PATH: 'true',
        TERM_PROGRAM: 'herdr',
      },
    };
    return await runScenario({ binary, options, fixture }, async (held) => {
      await drive(held, fixture);
    });
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(droidFile, { force: true });
  }
}

export async function runBusySignal(
  binary: string,
  options: BusySignalOptions,
): Promise<BusyEvidence> {
  let view: readonly string[] | undefined;
  const finish = await withScenario(binary, options, async (run, fixture) => {
    await launchHeldSubagent(run);
    view = await openAndCloseView(run);
    await finishHeldSubagent(run, fixture);
  });
  if (!options.switchSession) {
    return { finish: finish.recording(), switched: undefined, quit: undefined, view };
  }
  const switched = await withScenario(binary, options, async (run, fixture) => {
    await launchHeldSubagent(run);
    await send(run.session, NEW_SESSION);
    await waitFor(
      'the new session did not replace the old one',
      () => (run.session.screen().some((line) => TURN_REPLY.test(line)) ? undefined : true),
      run.timeoutMs,
    );
    await poll(() => run.recorder.cleared(), CLEAR_WAIT_MS);
    await settle(run.session);
    run.recorder.mark('switched');
    fixture.release();
  });
  const quit = await withScenario(binary, options, async (run) => {
    await launchHeldSubagent(run);
  });
  return {
    finish: finish.recording(),
    switched: switched.recording(),
    quit: quit.recording(),
    view,
  };
}

export function saveEvidence(evidence: BusyEvidence, out: string): string[] {
  mkdirSync(out, { recursive: true });
  const timeline = [
    describeTimeline('sub-agent finishes, then the process exits', evidence.finish),
    ...(evidence.switched === undefined
      ? []
      : [describeTimeline('switch to a new session while a sub-agent runs', evidence.switched)]),
    ...(evidence.quit === undefined
      ? []
      : [describeTimeline('exit while a sub-agent still runs', evidence.quit)]),
  ].join('\n\n');
  const files: [string, string | undefined][] = [
    [SAVED_FILES.timeline, `${timeline}\n`],
    [SAVED_FILES.view, evidence.view && `${evidence.view.join('\n')}\n`],
  ];
  return files.flatMap(([name, content]) => {
    if (content === undefined) {
      return [];
    }
    const file = path.join(out, name);
    writeFileSync(file, content);
    return [file];
  });
}
