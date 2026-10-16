import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

import { messageOf } from '../cli.ts';
import type { MessagesRequest, Usage } from './anthropic.ts';
import type { BodyFormat } from './compaction-replay-bodies.ts';
import { bodyFormat } from './compaction-replay-bodies.ts';
import type { Arm, ReplayJob } from './compaction-replay-plan.ts';
import { compactionRows, planJobs } from './compaction-replay-plan.ts';
import type { SavedReply } from './compaction-saved.ts';
import { savedJson, savedName } from './compaction-saved.ts';
import { printVariants } from './compaction-variants.ts';
import { readCredentials, readResponsesCredentials } from './credentials.ts';
import { fieldsOf, worded } from './fields.ts';
import { postMessages } from './messages-api.ts';
import { postResponses } from './responses-api.ts';

export const DEFAULT_REPLAY_RUNS = 5;
export const DEFAULT_REPLAY_PARALLEL = 4;

const OUT_ROOT = '/tmp';
const OUT_PREFIX = 'ovrdroid-compaction-replay-';

export interface CompactionReplayOptions {
  modelId: string;
  runs: number;
  rows: number[];
  arms: Arm[];
  parallel: number;
  out?: string;
}

interface Posted {
  content: readonly unknown[];
  stopReason: string;
  usage: Usage;
}

interface Sendable {
  job: ReplayJob;
  model: string;
  post: () => Promise<Posted>;
}

type Sender = (job: ReplayJob) => Sendable;

function isMessagesRequest(value: unknown): value is MessagesRequest {
  const fields = fieldsOf(value);
  return (
    typeof fields.get('model') === 'string' &&
    typeof fields.get('max_tokens') === 'number' &&
    Array.isArray(fields.get('system')) &&
    Array.isArray(fields.get('messages'))
  );
}

function formatOf(jobs: readonly ReplayJob[]): BodyFormat {
  const formats = new Set(jobs.map((job) => bodyFormat(job.body)));
  const [only] = formats;
  if (formats.size !== 1 || only === undefined) {
    throw new Error(
      'the rows are not all Messages bodies or all Responses bodies; pick one kind with --rows',
    );
  }
  return only;
}

async function senderFor(format: BodyFormat, modelId: string): Promise<Sender> {
  if (format === 'responses') {
    const { endpoint, headers } = await readResponsesCredentials(modelId);
    return (job) => ({
      job,
      model: worded(fieldsOf(job.body), 'model'),
      post: async () => await postResponses({ endpoint, headers, body: job.body }),
    });
  }
  const { endpoint, headers } = await readCredentials(modelId, false);
  return (job) => {
    const { body } = job;
    if (!isMessagesRequest(body)) {
      throw new TypeError(`row ${job.row}, ${job.arm}: the body is not a Messages API request`);
    }
    return {
      job,
      model: body.model,
      post: async () =>
        await postMessages({ endpoint, headers: { ...headers, ...job.headers }, body }),
    };
  };
}

function progress(message: string): void {
  process.stderr.write(`${message}\n`);
}

function labelOf({ job }: Sendable): string {
  return job.warm ? `row ${job.row} warm-up` : `row ${job.row} ${job.arm} run ${job.run}`;
}

async function sendOne(sendable: Sendable, out: string): Promise<SavedReply> {
  const { job, model } = sendable;
  const { row, arm, run, warm } = job;
  const started = performance.now();
  const base = { row, arm, run, warm, model };
  const elapsed = () => Math.round(performance.now() - started);
  let saved: SavedReply;
  try {
    const sent = await sendable.post();
    saved = {
      ...base,
      latencyMs: elapsed(),
      content: sent.content,
      stopReason: sent.stopReason,
      usage: sent.usage,
      error: undefined,
    };
  } catch (error) {
    saved = {
      ...base,
      latencyMs: elapsed(),
      content: [],
      stopReason: '',
      usage: undefined,
      error: messageOf(error),
    };
  }
  await Bun.write(path.join(out, savedName(job)), savedJson(saved));
  progress(
    `${labelOf(sendable)}: ${saved.error === undefined ? 'replied' : `error: ${saved.error}`}`,
  );
  return saved;
}

async function drain(
  queue: Sendable[],
  send: (next: Sendable) => Promise<SavedReply>,
): Promise<void> {
  const next = queue.shift();
  if (next === undefined) {
    return;
  }
  await send(next);
  await drain(queue, send);
}

async function warmUp(
  warmups: readonly Sendable[],
  send: (next: Sendable) => Promise<SavedReply>,
): Promise<void> {
  const [next, ...rest] = warmups;
  if (next === undefined) {
    return;
  }
  await send(next);
  await warmUp(rest, send);
}

export async function compactionReplay(
  bodies: string,
  options: CompactionReplayOptions,
): Promise<void> {
  const plan = planJobs(compactionRows(await Bun.file(bodies).text()), {
    rows: options.rows.length === 0 ? undefined : options.rows,
    runs: options.runs,
    arms: options.arms.length === 0 ? undefined : options.arms,
  });
  const sender = await senderFor(formatOf([...plan.warmups, ...plan.jobs]), options.modelId);
  const warmups = plan.warmups.map((job) => sender(job));
  const queue = plan.jobs.map((job) => sender(job));
  const out = options.out ?? mkdtempSync(path.join(OUT_ROOT, OUT_PREFIX));
  mkdirSync(out, { recursive: true });
  progress(
    `warming ${warmups.length} rows one at a time, then sending ${queue.length} requests with ${options.parallel} at a time; replies go to ${out}`,
  );

  const send = async (next: Sendable) => await sendOne(next, out);
  await warmUp(warmups, send);
  const workers = Array.from({ length: options.parallel }, async () => {
    await drain(queue, send);
  });
  await Promise.all(workers);

  await printVariants(out, options.modelId);
}
