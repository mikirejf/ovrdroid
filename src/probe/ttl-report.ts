import { InvalidArgumentError } from 'commander';

import { MS_PER_SECOND, say } from '../cli.ts';
import { FACTORY_SETTINGS, ovrdroidFile } from '../paths.ts';
import { apiKeyHeaders, CLAUDE_CODE_SYSTEM, CLAUDE_ENDPOINT, oauthHeaders } from './anthropic.ts';
import { entriesOf, worded } from './fields.ts';
import { jsonlAppender } from './jsonl.ts';
import { postMessages, readAccessToken } from './messages-api.ts';
import { ANTHROPIC } from './prices.ts';
import { settingsFields } from './settings.ts';
import type { SendOutcome } from './ttl-verdict.ts';
import { verdict } from './ttl-verdict.ts';
import type { Price, ScheduleName, SendStep, Step } from './ttl.ts';
import {
  buildRequest,
  DEFAULT_MINUTES,
  estimateCost,
  gapLabel,
  maxTokensFor,
  SCHEDULES,
  SECONDS_PER_MINUTE,
  sendSteps,
  ttlSendLine,
  wallSeconds,
} from './ttl.ts';

export { SCHEDULE_NAMES } from './ttl.ts';

export const DEFAULT_MODEL = 'custom:droidproxy:sonnet-5';
export const DEFAULT_PROMPT_TOKENS = 10_000;
export const DEFAULT_TTL_RUNS = ovrdroidFile('ttl-runs.jsonl');
export const DEFAULT_CLIFF_MINUTES = DEFAULT_MINUTES;

const SONNET_PRICE: Price = { input: 2, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 };
const DOLLAR_DIGITS = 4;
const NS_PER_SECOND = 1_000_000_000;

export interface TtlOptions {
  model: string;
  promptTokens: number;
  minutes: readonly number[];
  yes: boolean;
  direct: boolean;
  out: string;
}

interface DirectCredentials {
  route: 'direct';
  model: string;
  endpoint: string;
  headers: Record<string, string>;
  leadText: string;
}

interface ProxyCredentials {
  route: 'proxy';
  model: string;
  endpoint: string;
  headers: Record<string, string>;
}

type Credentials = DirectCredentials | ProxyCredentials;

interface RunContext {
  schedule: ScheduleName;
  credentials: Credentials;
  options: TtlOptions;
  append: (entry: unknown) => Promise<void>;
}

function endpointOf(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '').replace(/\/v1$/u, '')}/v1/messages`;
}

async function readDirectCredentials(model: string): Promise<DirectCredentials> {
  return {
    route: 'direct',
    model,
    endpoint: CLAUDE_ENDPOINT,
    headers: oauthHeaders(await readAccessToken()),
    leadText: CLAUDE_CODE_SYSTEM,
  };
}

async function readProxyCredentials(droidId: string): Promise<ProxyCredentials> {
  const entries = entriesOf(await settingsFields(), 'customModels');
  const entry = entries.find((fields) => worded(fields, 'id') === droidId);
  if (entry === undefined) {
    throw new Error(`${droidId} is not a customModels entry in ${FACTORY_SETTINGS}`);
  }

  const provider = worded(entry, 'provider');
  if (provider !== ANTHROPIC) {
    throw new Error(`${droidId} is a ${provider} model; probe ttl speaks the Anthropic API only`);
  }

  const model = worded(entry, 'model');
  const apiKey = worded(entry, 'apiKey');
  if (model === '' || apiKey === '') {
    throw new Error(`${droidId} has no model or apiKey in ${FACTORY_SETTINGS}`);
  }

  return {
    route: 'proxy',
    model,
    endpoint: endpointOf(worded(entry, 'baseUrl')),
    headers: apiKeyHeaders(apiKey),
  };
}

async function sendOne(context: RunContext, step: SendStep): Promise<SendOutcome> {
  const { credentials, options } = context;
  const started = Bun.nanoseconds();
  const reply = await postMessages({
    endpoint: credentials.endpoint,
    headers: credentials.headers,
    body: buildRequest({
      model: credentials.model,
      promptTokens: options.promptTokens,
      step,
      maxTokens: maxTokensFor(step),
      leadText: credentials.route === 'direct' ? credentials.leadText : undefined,
    }),
  });
  const elapsedSeconds = (Bun.nanoseconds() - started) / NS_PER_SECOND;
  return { usage: reply.usage, elapsedSeconds };
}

function dollars(amount: number): string {
  return `$${amount.toFixed(DOLLAR_DIGITS)}`;
}

function planLine(step: Step): string {
  if (step.kind === 'wait') {
    return `  wait ${gapLabel(step.seconds)}`;
  }
  return `  send ttl ${step.ttl}${step.slow ? ', long answer' : ''}`;
}

function sayPlan(schedule: ScheduleName, steps: readonly Step[], options: TtlOptions): void {
  const minutes = wallSeconds(steps) / SECONDS_PER_MINUTE;
  const cost = estimateCost(steps, options.promptTokens, SONNET_PRICE);

  say(`${schedule}: ${sendSteps(steps).length} sends, ${options.promptTokens} prompt tokens`);
  for (const step of steps) {
    say(planLine(step));
  }
  say('');
  say(`wall time: ${minutes.toFixed(1)} minutes of waiting`);
  say(`worst case cost: ${dollars(cost)}, assuming every send writes, at Sonnet 5 prices`);
}

async function run(context: RunContext, steps: readonly Step[]): Promise<SendOutcome[]> {
  const { schedule, credentials } = context;
  const results: SendOutcome[] = [];
  let gapSeconds = 0;

  for (const step of steps) {
    if (step.kind === 'wait') {
      gapSeconds += step.seconds;
      // oxlint-disable-next-line no-await-in-loop
      await Bun.sleep(step.seconds * MS_PER_SECOND);
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop
    const outcome = await sendOne(context, step);
    results.push(outcome);
    say(
      ttlSendLine({
        index: results.length,
        gapSeconds,
        usage: outcome.usage,
        elapsedSeconds: outcome.elapsedSeconds,
      }),
    );
    // oxlint-disable-next-line no-await-in-loop
    await context.append({
      t: new Date().toISOString(),
      schedule,
      model: credentials.model,
      step,
      gapSeconds,
      elapsedSeconds: outcome.elapsedSeconds,
      usage: outcome.usage,
    });
    gapSeconds = 0;
  }

  return results;
}

export function minuteList(raw: string): number[] {
  const parsed = raw.split(',').map((part) => Number(part.trim()));
  if (parsed.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new InvalidArgumentError('expected a comma-separated list of minute counts');
  }
  return parsed;
}

export async function ttl(schedule: ScheduleName, options: TtlOptions): Promise<void> {
  const credentials = options.direct
    ? await readDirectCredentials(options.model)
    : await readProxyCredentials(options.model);
  const steps = SCHEDULES[schedule]({ minutes: options.minutes });

  sayPlan(schedule, steps, options);
  say('');

  if (!options.yes) {
    say('nothing was sent; re-run with --yes to spend it');
    return;
  }

  const route =
    credentials.route === 'direct' ? 'direct, so an explicit 5m stays 5m' : 'through DroidProxy';
  say(`${credentials.model} at ${credentials.endpoint} (${route})`);
  say('');
  const context: RunContext = {
    schedule,
    credentials,
    options,
    append: jsonlAppender(options.out),
  };
  const results = await run(context, steps);
  say('');
  say(verdict(schedule, results, steps));
  say('');
  say(`every send appended to ${options.out}`);
}
