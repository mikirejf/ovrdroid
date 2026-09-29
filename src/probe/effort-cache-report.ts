import { NS_PER_SECOND, say } from '../cli.ts';
import { ovrdroidFile } from '../paths.ts';
import type { Message, Usage } from './anthropic.ts';
import type { Credentials } from './credentials.ts';
import { readCredentials } from './credentials.ts';
import { verdict } from './effort-cache-verdict.ts';
import type { Send } from './effort-cache.ts';
import {
  buildRequest,
  headersFor,
  hasSignedThinking,
  historyOf,
  SAME_EFFORT,
  SEED,
  seedMessages,
  SENDS,
  sendLine,
  SYSTEM_MESSAGE_SWITCH,
  THINKING_OFF_SWITCH,
  TOP_LEVEL_SWITCH,
} from './effort-cache.ts';
import { jsonlAppender } from './jsonl.ts';
import { postMessages } from './messages-api.ts';

export const DEFAULT_EFFORT_MODEL = 'custom:droidproxy:opus-5-5';
export const DEFAULT_EFFORT_PROMPT_TOKENS = 10_000;
export const DEFAULT_EFFORT_RUNS = ovrdroidFile('effort-cache-runs.jsonl');

export interface EffortCacheOptions {
  model: string;
  promptTokens: number;
  yes: boolean;
  direct: boolean;
  out: string;
}

interface Run {
  id: string;
  credentials: Credentials;
  append: (entry: unknown) => Promise<void>;
}

interface Sent {
  usage: Usage;
  content: unknown[];
}

function planOf(send: Send): string {
  if (send.effort === undefined) {
    return 'no thinking, no effort, max_tokens 1';
  }
  if (send.messageEffort === undefined) {
    return `top-level effort ${send.effort}`;
  }
  return `top-level effort ${send.effort}, system message effort ${send.messageEffort}`;
}

function planLine(send: Send): string {
  return `  ${send.name}: ${planOf(send)}`;
}

async function sendOne(run: Run, send: Send, messages: readonly Message[]): Promise<Sent> {
  const { credentials } = run;
  const started = Bun.nanoseconds();
  const reply = await postMessages({
    endpoint: credentials.endpoint,
    headers: headersFor(send, credentials.headers),
    body: buildRequest({
      model: credentials.model,
      messages,
      send,
      leadText: credentials.leadText,
    }),
  });
  const elapsedSeconds = (Bun.nanoseconds() - started) / NS_PER_SECOND;
  say(sendLine(send.name, reply.usage, elapsedSeconds));
  await run.append({
    t: new Date().toISOString(),
    run: run.id,
    model: credentials.model,
    arm: send.name,
    effort: send.effort,
    messageEffort: send.messageEffort,
    usage: reply.usage,
    elapsedSeconds,
  });
  return { usage: reply.usage, content: reply.content };
}

export async function effortCache(options: EffortCacheOptions): Promise<void> {
  const credentials = await readCredentials(options.model, options.direct);

  say(`one conversation, ${SENDS.length} sends, ${options.promptTokens} cached prompt tokens`);
  for (const send of SENDS) {
    say(planLine(send));
  }
  say('');

  if (!options.yes) {
    say('nothing was sent; re-run with --yes to spend it');
    return;
  }

  const route = credentials.route === 'direct' ? 'direct' : 'through DroidProxy';
  say(`${credentials.model} at ${credentials.endpoint} (${route})`);
  say('');

  const run: Run = { id: crypto.randomUUID(), credentials, append: jsonlAppender(options.out) };
  const seedHistory = seedMessages(options.promptTokens, run.id);
  const seed = await sendOne(run, SEED, seedHistory);
  const history = historyOf(seedHistory, seed.content);
  const control = await sendOne(run, SAME_EFFORT, history);
  const topLevel = await sendOne(run, TOP_LEVEL_SWITCH, history);
  const perMessage = await sendOne(run, SYSTEM_MESSAGE_SWITCH, history);
  const thinkingOff = await sendOne(run, THINKING_OFF_SWITCH, history);

  say('');
  if (hasSignedThinking(seed.content)) {
    say('the seed reply carried a signed thinking block, and it went back into the history');
  } else {
    say(
      'the seed reply carried no signed thinking block, so the history test is weaker: no thinking block was in it',
    );
  }
  say(
    verdict({
      seed: seed.usage,
      control: control.usage,
      switches: [
        { name: TOP_LEVEL_SWITCH.name, usage: topLevel.usage },
        { name: SYSTEM_MESSAGE_SWITCH.name, usage: perMessage.usage },
        { name: THINKING_OFF_SWITCH.name, usage: thinkingOff.usage },
      ],
    }),
  );
  say('');
  say(`every send appended to ${options.out}`);
}
