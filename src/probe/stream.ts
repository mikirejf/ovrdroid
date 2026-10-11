import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { RunOptions } from '../cli.ts';
import { messageOf, say } from '../cli.ts';
import { interleave } from './ab.ts';
import type { Counted, Measured } from './counter-file.ts';
import { endSpan, withCounters } from './counter-file.ts';
import { countVerdict, sayCounters } from './counters-report.ts';
import { race } from './launch.ts';
import { sayPaired } from './paired.ts';
import type { Session } from './session.ts';
import { ENTER, openSettledSession } from './session.ts';
import type { StreamReading } from './stream-report.ts';
import { formatRuns, readStream, seriesOf } from './stream-report.ts';
import type { ReplyPlan, StubModel } from './stub-model.ts';
import { pieces, replyText, startStubModel, stubSettings } from './stub-model.ts';
import { sampleTree } from './tree-samples.ts';

export const DEFAULT_PLAN: ReplyPlan = { chars: 4000, chunk: 25, gapMs: 15 };
const PROMPT = 'Explain the pipeline.';
const PASTE_QUIET_MS = 300;
const PASTE_TIMEOUT_MS = 3000;
const QUIET_MS = 1500;
const ASK_TIMEOUT_MS = 30_000;
const SLACK = 3;

export interface StreamCommandOptions extends ReplyPlan, RunOptions {}

function settingsFile(stub: StubModel): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-stream-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(stubSettings(stub.url)));
  return file;
}

async function streamOnce(
  session: Session,
  stub: StubModel,
  plan: ReplyPlan,
): Promise<Measured<StreamReading>> {
  session.paste(PROMPT);
  await session.quiet(PASTE_QUIET_MS, PASTE_TIMEOUT_MS);
  const head = await sampleTree(session.pid);
  const streamed = stub.nextStream();
  session.mark();
  const submittedAt = performance.now();
  await session.type(ENTER);

  const expectedMs = pieces(replyText(plan.chars), plan.chunk).length * plan.gapMs;
  const finished = await race(
    streamed,
    ASK_TIMEOUT_MS + expectedMs * SLACK,
    'Droid never finished asking the stub model for a reply',
  );
  await session.quiet(QUIET_MS, ASK_TIMEOUT_MS);
  const window = await endSpan(submittedAt);
  const tail = await sampleTree(session.pid);

  const reading = readStream({
    frames: session.frames(),
    bytes: session.bytes(),
    head,
    tail,
    streamStartMs: finished.startedAt - submittedAt,
    streamEndMs: finished.endedAt - submittedAt,
  });
  return { reading, spans: { stream: window } };
}

export async function measureStream(
  binary: string,
  plan: ReplyPlan,
): Promise<StreamReading & Counted> {
  const stub = startStubModel(plan);
  const file = settingsFile(stub);
  try {
    return await withCounters(async (counterEnv) => {
      const { session } = await openSettledSession(binary, {
        env: { FACTORY_RUNTIME_SETTINGS_PATH: file, ...counterEnv },
      });
      try {
        return await streamOnce(session, stub, plan);
      } finally {
        await session.close();
      }
    });
  } finally {
    await stub.stop();
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

export async function stream(binaries: string[], options: StreamCommandOptions): Promise<void> {
  const plan = { chars: options.chars, chunk: options.chunk, gapMs: options.gapMs };
  const deltas = pieces(replyText(plan.chars), plan.chunk).length;
  say(
    `each run streams a ${replyText(plan.chars).length}-char markdown reply from a local stub model, in ${deltas} deltas of ${plan.chunk} chars every ${plan.gapMs}ms`,
  );
  say('cpu sums user and system time over the Droid process tree, read with ps before and after');

  const results = await interleave(
    binaries,
    async (binary) =>
      await measureStream(binary, plan).catch((error: unknown) => {
        throw new Error(`${binary}: ${messageOf(error)}`);
      }),
    options.runs,
  );

  for (const [binary, runs] of results) {
    say(formatRuns(binary, runs));
  }

  if (results.length === 2) {
    sayPaired(seriesOf(results, 'cpuMs'), 'stream cpu');
    sayPaired(seriesOf(results, 'wallMs'), 'stream wall');
    sayPaired(seriesOf(results, 'lagMs'), 'screen lag');
    say('');
    say(countVerdict(seriesOf(results, 'frames'), 'frames'));
    say(countVerdict(seriesOf(results, 'bytes'), 'bytes'));
  }
  sayCounters(results);
}
