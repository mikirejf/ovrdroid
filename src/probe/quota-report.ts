import { say } from '../cli.ts';
import { ovrdroidFile } from '../paths.ts';
import type { Usage } from './anthropic.ts';
import { CLAUDE_ENDPOINT, oauthHeaders } from './anthropic.ts';
import { jsonlAppender } from './jsonl.ts';
import { postMessages, readAccessToken } from './messages-api.ts';
import type { ArmName, Crossing, Utilization } from './quota.ts';
import {
  buildRequest,
  checkArm,
  countedTokens,
  crossings,
  freshFiller,
  MAX_SENDS,
  parseUtilization,
  quotaSendLine,
  verdict,
} from './quota.ts';

export { ARM_NAMES } from './quota.ts';

export const DEFAULT_QUOTA_MODEL = 'claude-opus-5';
export const DEFAULT_QUOTA_PROMPT_TOKENS = 10_000;
export const DEFAULT_QUOTA_STEPS = 4;
export const DEFAULT_QUOTA_RUNS = ovrdroidFile('quota-runs.jsonl');

export interface QuotaOptions {
  model: string;
  promptTokens: number;
  steps: number;
  yes: boolean;
  out: string;
}

interface SendResult {
  usage: Usage;
  used: Utilization;
}

interface RecordSpec {
  arm: ArmName;
  model: string;
  tokens: number;
  result: SendResult;
}

interface Run {
  token: string;
  arm: ArmName;
  options: QuotaOptions;
  append: (entry: unknown) => Promise<void>;
}

async function sendOne(run: Run, arm: ArmName, text: string): Promise<SendResult> {
  const reply = await postMessages({
    endpoint: CLAUDE_ENDPOINT,
    headers: oauthHeaders(run.token),
    body: buildRequest({ model: run.options.model, arm, text }),
  });

  return {
    usage: reply.usage,
    used: parseUtilization((name) => reply.headers.get(name)),
  };
}

function recordOf(spec: RecordSpec) {
  const { usage, used } = spec.result;
  return {
    t: new Date().toISOString(),
    arm: spec.arm,
    model: spec.model,
    tokens: spec.tokens,
    usage: {
      input: usage.inputTokens,
      cacheRead: usage.cacheRead,
      write5m: usage.write5m,
      write1h: usage.write1h,
    },
    h5: used.h5,
    h7: used.h7,
  };
}

function sayPlan(arm: ArmName, options: QuotaOptions): void {
  say(`arm ${arm} against ${options.model}`);
  say(`  prompt tokens: ${options.promptTokens}`);
  say(`  stop after: ${options.steps} crossings of 1% on the 5h meter`);
  say(`  hard cap: ${MAX_SENDS} sends`);
  say('this spends real Claude Max subscription quota, not dollars on an API key');
}

async function primeRead(run: Run, text: string): Promise<void> {
  const { model } = run.options;
  const result = await sendOne(run, '1h', text);
  const failed = checkArm('1h', result.usage);
  if (failed !== undefined) {
    throw new Error(failed);
  }
  const tokens = result.usage.cacheWrite;
  say(`primed the read arm with a ${tokens} token 1h write, 5h=${result.used.h5}`);
  await run.append(recordOf({ arm: '1h', model, tokens, result }));
}

async function sendAll(run: Run): Promise<Crossing[]> {
  const { arm, options } = run;
  const primed = arm === 'read' ? freshFiller(options.promptTokens) : undefined;
  if (primed !== undefined) {
    await primeRead(run, primed);
  }

  const seen: Crossing[] = [];
  let cumulative = 0;

  for (let index = 1; index <= MAX_SENDS; index += 1) {
    const text = primed ?? freshFiller(options.promptTokens);
    // oxlint-disable-next-line no-await-in-loop
    const result = await sendOne(run, arm, text);
    const failed = checkArm(arm, result.usage);
    if (failed !== undefined) {
      throw new Error(failed);
    }

    const tokens = countedTokens(arm, result.usage);
    cumulative += tokens;
    seen.push({ tokens, h5: result.used.h5 });
    say(quotaSendLine({ index, tokens, cumulative, used: result.used }));
    // oxlint-disable-next-line no-await-in-loop
    await run.append(recordOf({ arm, model: options.model, tokens, result }));

    if (crossings(seen).crossings.length >= options.steps) {
      break;
    }
  }

  return seen;
}

export async function quota(arm: ArmName, options: QuotaOptions): Promise<void> {
  sayPlan(arm, options);
  say('');

  if (!options.yes) {
    say('nothing was sent; re-run with --yes to spend it');
    return;
  }

  const token = await readAccessToken();
  const seen = await sendAll({ token, arm, options, append: jsonlAppender(options.out) });
  say('');
  say(verdict(arm, options.model, crossings(seen)));
  say('');
  say(`every send appended to ${options.out}`);
}
