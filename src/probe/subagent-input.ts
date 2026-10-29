import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { say } from '../cli.ts';
import { anyFailed, describeVerdicts } from './busy-signal-report.ts';
import type { Run, ScenarioOptions } from './busy-signal.ts';
import { ALT_S, DROID_TYPE, launchHeldSubagent, viewLines, withScenario } from './busy-signal.ts';
import { HOLD_WORD, LAUNCH_WORD } from './rewind-report.ts';
import { settle, waitFor } from './rewind.ts';
import type { SubagentInputEvidence } from './subagent-input-report.ts';
import { subagentInputVerdicts } from './subagent-input-report.ts';

const ARROW_DOWN = '\u001B[B';
const ARROW_RIGHT = '\u001B[C';
const ENTER = '\r';
const STEP_TIMEOUT_MS = 8000;
const TAG = 'kept';
const SUBAGENT_ROW = /^›\s{3,}\S/u;
const MAIN_ROW = /^› \S/u;
const SUBAGENT_LISTED = new RegExp(`${DROID_TYPE} ${TAG}`, 'u');
const MAIN_TRANSCRIPT = `${LAUNCH_WORD} ${TAG}`;
const SUBAGENT_TRANSCRIPT = `${HOLD_WORD}${TAG}`;

export const DEFAULT_SUBAGENT_INPUT_TIMEOUT_S = 60;
export const SAVED_SUBAGENT_INPUT_FILE = 'subagent-input.txt';

export interface SubagentInputOptions extends ScenarioOptions {
  out: string | undefined;
}

async function waitOn<T>(
  { session }: Run,
  what: string,
  read: (lines: readonly string[]) => T | undefined,
): Promise<T> {
  try {
    return await waitFor(what, () => read(session.screen()), STEP_TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${session.screen().join('\n')}`, { cause: error });
  }
}

function hasLine(pattern: RegExp): (lines: readonly string[]) => true | undefined {
  return (lines) => (lines.some((line) => pattern.test(line)) ? true : undefined);
}

function showsText(words: string): (lines: readonly string[]) => true | undefined {
  return (lines) => (lines.some((line) => line.includes(words)) ? true : undefined);
}

async function openRoster(run: Run): Promise<void> {
  run.session.press(ALT_S);
  await waitOn(run, 'the droids view did not open', () => viewLines(run.session));
  await settle(run.session);
}

async function leaveView(run: Run, transcript: string): Promise<readonly string[]> {
  run.session.press(ENTER);
  await waitOn(run, 'the droids view did not close', () =>
    viewLines(run.session) === undefined ? true : undefined,
  );
  await waitOn(run, `the session did not show "${transcript}"`, showsText(transcript));
  await settle(run.session);
  return run.session.screen();
}

async function switchToSubagent(run: Run): Promise<readonly string[]> {
  await openRoster(run);
  run.session.press(ARROW_RIGHT);
  await waitOn(run, 'the droids view did not list the sub-agent', hasLine(SUBAGENT_LISTED));
  run.session.press(ARROW_DOWN);
  await waitOn(run, 'the cursor did not move to the sub-agent row', hasLine(SUBAGENT_ROW));
  await settle(run.session);
  return await leaveView(run, SUBAGENT_TRANSCRIPT);
}

async function switchToMain(run: Run): Promise<readonly string[]> {
  await openRoster(run);
  await waitOn(run, 'the cursor is not on the main session row', hasLine(MAIN_ROW));
  return await leaveView(run, MAIN_TRANSCRIPT);
}

export async function runSubagentInput(
  binary: string,
  options: SubagentInputOptions,
): Promise<SubagentInputEvidence> {
  let evidence: SubagentInputEvidence | undefined;
  await withScenario(binary, options, async (run) => {
    await launchHeldSubagent(run);
    const from = run.recorder.chunks.length;
    const subagent = await switchToSubagent(run);
    const bytesAfterSwitch = run.recorder.chunks
      .slice(from)
      .map((chunk) => chunk.text)
      .join('');
    evidence = { subagent, main: await switchToMain(run), bytesAfterSwitch };
  });
  if (evidence === undefined) {
    throw new Error('the probe ended before both input boxes were captured');
  }
  return evidence;
}

function saveSubagentInput(evidence: SubagentInputEvidence, out: string): string {
  mkdirSync(out, { recursive: true });
  const file = path.join(out, SAVED_SUBAGENT_INPUT_FILE);
  const parts = [
    ['in the subagent session', evidence.subagent],
    ['back in the main session', evidence.main],
  ] as const;
  writeFileSync(
    file,
    parts.map(([title, lines]) => `===== ${title} =====\n${lines.join('\n')}\n`).join('\n'),
  );
  return file;
}

export async function subagentInput(binary: string, options: SubagentInputOptions): Promise<void> {
  const evidence = await runSubagentInput(binary, options);
  if (options.out !== undefined) {
    say(`saved ${saveSubagentInput(evidence, options.out)}`);
  }
  const verdicts = subagentInputVerdicts(evidence);
  say(describeVerdicts(verdicts));
  if (anyFailed(verdicts)) {
    process.exitCode = 1;
  }
}
