import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import { FACTORY_DROIDS } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { poll } from './poll.ts';
import { send, settle, waitFor } from './rewind.ts';
import type { RosterAnswer, RosterTitles } from './roster-view-report.ts';
import {
  answerFor,
  CHILD_TITLE,
  describeRoster,
  GRANDCHILD_TITLE,
  LEVEL_ONE,
  LEVEL_TWO,
  NEST_WORD,
  ROSTER_FILTER,
  ROSTER_TITLES,
  rosterVerdicts,
} from './roster-view-report.ts';
import { openSettledSession } from './session.ts';
import type { Session } from './session.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

const ARROW_DOWN = '\u001B[B';
const WORKING_LINE = /\d+ droids? working/u;
const ROSTER_WAIT_MS = 15_000;
const OPEN_WAIT_MS = 2000;
const DROID_TYPE = 'ovrdroid-roster-probe';
const DROID_FILE = `---\nname: ${DROID_TYPE}\ndescription: Launches one more droid for the roster probe.\nmodel: inherit\nmaxDepth: 2\n---\nDo what the prompt says.\n`;

export const DEFAULT_ROSTER_TIMEOUT_S = 60;
export const SAVED_ROSTER_FILE = 'roster-view.txt';

export interface RosterViewOptions {
  cwd: string;
  timeout: number;
  out: string | undefined;
}

export interface RosterEvidence {
  lines: readonly string[] | undefined;
  last: readonly string[];
  titles: RosterTitles;
}

interface Stub {
  url: string;
  stop: () => Promise<void>;
}

function eventsFor(answer: RosterAnswer, callId: (tag: string) => string): string[] {
  if (answer === 'launch-child') {
    return toolEvents({
      id: callId('child'),
      name: 'Task',
      input: {
        subagent_type: DROID_TYPE,
        description: CHILD_TITLE,
        prompt: `${LEVEL_ONE}go`,
        run_in_background: true,
      },
    });
  }
  if (answer === 'launch-grandchild') {
    return toolEvents({
      id: callId('grandchild'),
      name: 'Task',
      input: {
        subagent_type: DROID_TYPE,
        description: GRANDCHILD_TITLE,
        prompt: `${LEVEL_TWO}hold`,
      },
    });
  }
  return streamEvents([answer === 'ok' ? 'ok' : 'hi']);
}

function startStub(callId: (tag: string) => string): Stub {
  const held = Promise.withResolvers<boolean>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const answer = answerFor(await request.json());
      if (answer === 'hold') {
        await held.promise;
      }
      return new Response(eventsFor(answer, callId).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      held.resolve(true);
      await server.stop(true);
    },
  };
}

function showsWorking(session: Session): true | undefined {
  return session.screen().some((line) => WORKING_LINE.test(line)) ? true : undefined;
}

function rosterOpen(session: Session): true | undefined {
  return session.screen().some((line) => line.includes(ROSTER_FILTER)) ? true : undefined;
}

async function waitForWorking(session: Session, timeoutMs: number): Promise<void> {
  try {
    await waitFor(
      'no droid working line appeared under the input box',
      () => showsWorking(session),
      timeoutMs,
    );
  } catch (error) {
    const screen = session.screen().join('\n');
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${screen}`, {
      cause: error,
    });
  }
}

async function pressDownWhileWorking(session: Session, deadline: number): Promise<void> {
  await waitForWorking(session, Math.max(0, deadline - performance.now()));
  session.press(ARROW_DOWN);
  if ((await poll(() => rosterOpen(session), OPEN_WAIT_MS)) || performance.now() > deadline) {
    return;
  }
  await pressDownWhileWorking(session, deadline);
}

function listsBoth(session: Session): readonly string[] | undefined {
  const lines = session.screen();
  const has = (title: string): boolean =>
    lines.some((line) => line.toLowerCase().includes(title.toLowerCase()));
  const opened = lines.findIndex((line) => line.includes(ROSTER_FILTER));
  const chips = lines.slice(opened + 1).filter((line) => line.includes(ROSTER_TITLES.model)).length;
  return has(CHILD_TITLE) && has(GRANDCHILD_TITLE) && chips >= 2 ? lines : undefined;
}

async function openRoster(session: Session, timeoutMs: number): Promise<RosterEvidence> {
  await send(session, NEST_WORD);
  await waitForWorking(session, timeoutMs);
  await settle(session);
  await pressDownWhileWorking(session, performance.now() + ROSTER_WAIT_MS);
  const lines = await poll(() => listsBoth(session), ROSTER_WAIT_MS);
  return { lines, last: session.screen(), titles: ROSTER_TITLES };
}

export async function runRosterView(
  binary: string,
  options: RosterViewOptions,
): Promise<RosterEvidence> {
  const run = randomUUID().slice(0, 8);
  const stub = startStub((tag) => `toolu_roster${run}_${tag}`);
  const dir = makeTempDir('roster-view');
  const droidFile = path.join(FACTORY_DROIDS, `${DROID_TYPE}.md`);
  try {
    mkdirSync(FACTORY_DROIDS, { recursive: true });
    writeFileSync(droidFile, DROID_FILE);
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(stubSettings(stub.url)));
    const flagsFile = path.join(dir, 'feature-flags.json');
    writeFileSync(flagsFile, JSON.stringify({ flags: { droids_view: false }, configs: {} }));
    const { session } = await openSettledSession(binary, {
      cwd: options.cwd,
      env: {
        FACTORY_RUNTIME_SETTINGS_PATH: settingsFile,
        FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: flagsFile,
      },
      screen: true,
    });
    try {
      return await openRoster(session, options.timeout * MS_PER_SECOND);
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(droidFile, { force: true });
  }
}

export function saveRoster(evidence: RosterEvidence, out: string): string {
  mkdirSync(out, { recursive: true });
  const file = path.join(out, SAVED_ROSTER_FILE);
  writeFileSync(file, `${(evidence.lines ?? evidence.last).join('\n')}\n`);
  return file;
}

export async function rosterView(binary: string, options: RosterViewOptions): Promise<void> {
  const evidence = await runRosterView(binary, options);
  if (options.out !== undefined) {
    say(`saved ${saveRoster(evidence, options.out)}`);
  }
  const verdicts = rosterVerdicts(evidence.lines ?? evidence.last, evidence.titles);
  say(describeRoster(verdicts));
  if (verdicts.some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}
