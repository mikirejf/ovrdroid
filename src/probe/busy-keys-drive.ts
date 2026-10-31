import { setTimeout as delay } from 'node:timers/promises';

import type { Rig } from './busy-keys-open.ts';
import { inSession } from './busy-keys-open.ts';
import type { Chunk, Echo, Trial } from './busy-keys-read.ts';
import { ECHO_TIMEOUT_MS, echoOf, markerAt, MISSED, readEchoes } from './busy-keys-read.ts';
import { REPLY_OPENING } from './escape-report.ts';
import { pendingCommand, pendingMissing, showsPendingTool } from './pending-report.ts';
import { poll } from './poll.ts';
import type { Session } from './session.ts';
import { ENTER } from './session.ts';
import type { ReplyPlan } from './stub-model.ts';
import { STUB_END } from './stub-model.ts';

export type Scenario = 'idle' | 'stream' | 'tool';

export interface ScenarioOptions {
  trials: number;
  turns: number;
}

interface Typed {
  echoes: Echo[];
  lastSentAt: number;
}

export const STREAM_PLAN: ReplyPlan = { chars: 20_000, chunk: 25, gapMs: 15 };
export const TRIAL_GAP_MS = 120;

const BACKSPACE = '\u007F';
const TOOL_PLAN: ReplyPlan = { chars: 100, chunk: 50, gapMs: 20 };
const PROMPT = 'Explain the pipeline.';
const TOOL_PROMPT = 'Run it.';
const ECHO_POLL_MS = 2;
const PASTE_QUIET_MS = 300;
const PASTE_TIMEOUT_MS = 3000;
const WARM_KEY_QUIET_MS = 700;
const WARM_KEY_TIMEOUT_MS = 5000;
const START_TIMEOUT_MS = 20_000;
const TOOL_SLEEP_BASE_S = 30;
const MS_PER_S = 1000;

async function waitForEcho(chunks: readonly Chunk[], from: number, trial: Trial): Promise<void> {
  while (
    performance.now() - trial.sentAt < ECHO_TIMEOUT_MS &&
    echoOf(chunks.slice(from), trial, ECHO_TIMEOUT_MS) === MISSED
  ) {
    // oxlint-disable-next-line no-await-in-loop
    await delay(ECHO_POLL_MS);
  }
}

async function typeMarkers({ session, chunks }: Rig, trials: number): Promise<Typed> {
  const sent: Trial[] = [];
  for (let index = 0; index < trials; index++) {
    const from = chunks.length;
    const trial = { marker: markerAt(index), sentAt: performance.now() };
    sent.push(trial);
    session.press(trial.marker);
    // oxlint-disable-next-line no-await-in-loop
    await waitForEcho(chunks, from, trial);
    session.press(BACKSPACE);
    // oxlint-disable-next-line no-await-in-loop
    await delay(TRIAL_GAP_MS);
  }
  return {
    echoes: readEchoes(chunks, sent, ECHO_TIMEOUT_MS),
    lastSentAt: sent.at(-1)?.sentAt ?? performance.now(),
  };
}

async function submit(session: Session, prompt: string): Promise<void> {
  session.paste(prompt);
  await session.quiet(PASTE_QUIET_MS, PASTE_TIMEOUT_MS);
  session.mark();
  await session.type(ENTER);
}

function framesShow(session: Session, needle: string): true | undefined {
  return session.frames().some((frame) => frame.text.includes(needle)) ? true : undefined;
}

async function driveIdle(rig: Rig, trials: number): Promise<Echo[]> {
  rig.session.press(markerAt(0));
  await delay(TRIAL_GAP_MS);
  rig.session.press(BACKSPACE);
  await rig.session.quiet(WARM_KEY_QUIET_MS, WARM_KEY_TIMEOUT_MS);
  const typed = await typeMarkers(rig, trials);
  return typed.echoes;
}

async function driveStream(rig: Rig, trials: number): Promise<Echo[]> {
  const streamed = rig.stub.nextStream();
  await submit(rig.session, PROMPT);
  const started = await poll(() => framesShow(rig.session, REPLY_OPENING), START_TIMEOUT_MS);
  if (started === undefined) {
    throw new Error(`the stub reply never showed on screen within ${START_TIMEOUT_MS}ms`);
  }
  const typed = await typeMarkers(rig, trials);
  const ended = await Promise.race([streamed, Promise.resolve(null)]);
  if (framesShow(rig.session, STUB_END) !== undefined) {
    throw new Error(
      'the last line of the stub reply was already on screen after the last key, so those keys were typed into an idle Droid; lower -n or raise the reply length',
    );
  }
  if (ended !== null && ended.endedAt < typed.lastSentAt) {
    throw new Error(
      `the stub reply had ended ${Math.round(typed.lastSentAt - ended.endedAt)}ms before the last key, so those keys were typed into an idle Droid; lower -n or raise the reply length`,
    );
  }
  return typed.echoes;
}

async function driveTool(rig: Rig, trials: number, command: string): Promise<Echo[]> {
  const enteredAt = performance.now();
  await submit(rig.session, TOOL_PROMPT);
  const shown = await poll(
    () => (showsPendingTool(rig.session.frames(), command) ? true : undefined),
    START_TIMEOUT_MS,
  );
  if (shown === undefined) {
    throw new Error(
      `${pendingMissing(rig.session.frames(), command)}\nthe stub served: ${rig.stub.served().join(', ')}`,
    );
  }
  const typed = await typeMarkers(rig, trials);
  const sleepMs = (TOOL_SLEEP_BASE_S + trials) * MS_PER_S;
  if (typed.lastSentAt - enteredAt >= sleepMs) {
    throw new Error(
      `the tool's sleep (${sleepMs / MS_PER_S}s) ended before the last key, so those keys were not typed while a tool ran`,
    );
  }
  return typed.echoes;
}

export async function runScenario(
  binary: string,
  scenario: Scenario,
  { trials, turns }: ScenarioOptions,
): Promise<Echo[]> {
  if (scenario === 'idle') {
    return await inSession({
      binary,
      turns,
      plan: TOOL_PLAN,
      drive: async (rig) => await driveIdle(rig, trials),
    });
  }
  if (scenario === 'stream') {
    return await inSession({
      binary,
      turns,
      plan: STREAM_PLAN,
      drive: async (rig) => await driveStream(rig, trials),
    });
  }
  const command = pendingCommand(TOOL_SLEEP_BASE_S + trials);
  return await inSession({
    binary,
    turns,
    plan: TOOL_PLAN,
    firstCall: { name: 'Execute', input: { command, riskLevel: 'low', timeout: 120 } },
    drive: async (rig) => await driveTool(rig, trials, command),
  });
}
