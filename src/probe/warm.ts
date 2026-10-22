import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import { WARM_DELAY_ENV } from '../patch/warmer-patches.ts';
import { FACTORY_DROIDS } from '../paths.ts';
import { logOf } from './effort-switch-turn.ts';
import { openLiveSession, sessionFolder, submit, withLiveDir } from './live-session.ts';
import { SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import type { Drive } from './warm-session.ts';
import {
  childRunning,
  labelAfterWarm,
  sampleUntilWarm,
  settledLabel,
  shownLabel,
  turnEnd,
} from './warm-session.ts';
import type { WarmRun } from './warm-verdict.ts';
import { describeChecks, labelBefore, warmChecks, warmPassed } from './warm-verdict.ts';

export const DEFAULT_WARM_DELAY_S = 90;
export const MIN_WARM_DELAY_S = 75;
export const DEFAULT_WARM_TIMEOUT_S = 120;

const DROID_TYPE = 'ovrdroid-warm-probe';
const DROID_FILE = [
  '---',
  `name: ${DROID_TYPE}`,
  'description: Runs one shell command for the cache warmer probe.',
  'model: inherit',
  'tools: ["Execute"]',
  '---',
  'Run the shell command your task names with the Execute tool, with the timeout it names. Then reply with the single word DONE.',
  '',
].join('\n');
const AUTONOMY = ['--auto', 'low'];
const EFFORT = 'medium';
const SLEEP_PAST_DUE_S = 240;
const EXECUTE_SLACK_S = 60;
const WARM_WAIT_MS = 60_000;

export interface WarmOptions {
  model: string;
  delay: number;
  timeout: number;
  yes: boolean;
}

function launchPrompt(tag: string, sleepS: number): string {
  return [
    `Launch exactly one background Task (do not await it) with subagent_type "${DROID_TYPE}"`,
    `and description "warm ${tag}". Its prompt is exactly:`,
    `"Run the shell command \`sleep ${sleepS}\` with the Execute tool and timeout ${sleepS + EXECUTE_SLACK_S}."`,
    'Then end your turn by replying with only the word LAUNCHED. Use no other tool.',
    `(probe ${tag})`,
  ].join(' ');
}

async function exercise(context: Drive, delayMs: number): Promise<WarmRun> {
  const { session } = context;
  const launchSentAt = Date.now();
  const sleepS = Math.ceil(delayMs / MS_PER_SECOND) + SLEEP_PAST_DUE_S;
  await submit(session, launchPrompt(context.tag, sleepS));
  const launched = await turnEnd(context, { replies: 1, before: 0, turn: 'launch' });
  const afterLaunch = await settledLabel(session);
  say(
    `launch turn: read ${launched.usage.cacheRead}, wrote ${launched.usage.cacheWrite}; footer ${afterLaunch ?? 'shows no cache label'}`,
  );

  const { warm, samples } = await sampleUntilWarm(
    context,
    launched.sessionId,
    Date.now() + delayMs + WARM_WAIT_MS,
  );
  const running = warm !== undefined || childRunning(context, launched.sessionId);
  const beforeWarm = warm === undefined ? samples.at(-1)?.label : labelBefore(samples, warm.at);
  say(
    warm === undefined
      ? `no warm request was logged; the sub-agent ${running ? 'was still running' : 'had finished'}`
      : `the warm request was logged: read ${warm.cacheRead}, wrote ${warm.cacheWrite}`,
  );
  const afterWarm =
    warm === undefined ? shownLabel(session) : await labelAfterWarm(session, beforeWarm);

  const before = logOf(launched.sessionId).usage.length;
  await submit(session, `Reply with only the word two. (probe ${context.tag})`);
  const next = await turnEnd(context, { replies: 2, before, turn: 'next' });
  const afterNext = await settledLabel(session);
  say(`next turn: read ${next.usage.cacheRead}, wrote ${next.usage.cacheWrite}`);

  return {
    delayMs,
    launch: launched.usage,
    launchSentAt,
    childRunning: running,
    warm,
    next: next.usage,
    labels: { afterLaunch, beforeWarm, afterWarm, afterNext },
  };
}

async function runWarm(binary: string, options: WarmOptions, dir: string): Promise<WarmRun> {
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd);
  const delayMs = options.delay * MS_PER_SECOND;
  const droidFile = path.join(FACTORY_DROIDS, `${DROID_TYPE}.md`);
  mkdirSync(FACTORY_DROIDS, { recursive: true });
  writeFileSync(droidFile, DROID_FILE);
  try {
    const session = await openLiveSession(binary, {
      cwd,
      dir,
      model: options.model,
      effort: EFFORT,
      args: AUTONOMY,
      collect: true,
      env: { [WARM_DELAY_ENV]: String(delayMs) },
    });
    try {
      await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
      return await exercise(
        {
          session,
          folder: sessionFolder(cwd),
          tag: randomUUID().slice(0, 8),
          model: options.model,
          timeoutMs: options.timeout * MS_PER_SECOND,
        },
        delayMs,
      );
    } finally {
      await session.close();
    }
  } finally {
    rmSync(droidFile, { force: true });
  }
}

export async function warmProbe(binary: string, options: WarmOptions): Promise<void> {
  say(
    `${options.model} launches a background sub-agent that sleeps, then the session sits idle with ${WARM_DELAY_ENV}=${options.delay * MS_PER_SECOND}:`,
  );
  say('  the warmer must re-send the last request and read its cached prefix');
  say('  the next turn must read the cache, and the footer clock must reset on the warm');
  say(`takes about ${options.delay + 60}s and a few Haiku-sized requests`);
  say('');
  if (!options.yes) {
    say('nothing was sent; re-run with --yes to spend it');
    process.exitCode = 1;
    return;
  }
  if (options.delay < MIN_WARM_DELAY_S) {
    throw new Error(
      `--delay must be at least ${MIN_WARM_DELAY_S}s so the footer crosses a minute before the warm`,
    );
  }
  const run = await withLiveDir('warm', async (dir) => await runWarm(binary, options, dir));
  const checks = warmChecks(run);
  say('');
  say(describeChecks(checks));
  if (!warmPassed(checks)) {
    process.exitCode = 1;
  }
}
