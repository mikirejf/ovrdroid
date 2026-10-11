import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say } from '../cli.ts';
import { startSampler } from './sample-report.ts';
import { ENTER, openSettledSession } from './session.ts';
import type { RunRecord } from './subagents-read.ts';
import {
  BEFORE_MS,
  END_MARGIN_MS,
  printReport,
  saveRecord,
  TIMELINE_FILE,
} from './subagents-read.ts';
import { chooseFiles, offeredTypes, sessionEnv } from './subagents-setup.ts';
import { POLL_MS, settleAfterSnapshot, takeSnapshot } from './subagents-snapshots.ts';
import { AFTER_LAST_MS, chooseType, isFinished, subagentPrompt } from './subagents.ts';

export const DEFAULT_COUNT = 4;
export const DEFAULT_SLEEP_S = 30;
export const DEFAULT_TYPE = 'grunt';
export const DEFAULT_WORK: RunRecord['work'] = 'sleep';
export const MAX_COUNT = 20;
export const DEFAULT_SUBAGENTS_OUT = path.join(tmpdir(), 'ovrdroid-subagents');
const FALLBACK_TYPE = 'worker';
const AUTONOMY = 'high';
const TICK_MS = 500;
const FOOTPRINT_EVERY = 1;
const QUIET_AFTER_SETTLE_MS = 5000;
const REPLY_SLACK_S = 240;
const READ_WAIT_S = 600;

export interface SubagentsOptions {
  count: number;
  work: RunRecord['work'];
  files: string[] | undefined;
  sleep: number;
  type: string;
  heap: boolean;
  lag: boolean;
  out: string;
}

export async function subagents(binary: string, options: SubagentsOptions): Promise<void> {
  if (options.count > MAX_COUNT) {
    throw new Error(`at most ${MAX_COUNT} subagents, each one makes real model calls`);
  }
  const reads = options.work === 'read';
  const files = reads ? chooseFiles(options.files) : [];
  const sleep = reads ? 0 : options.sleep;
  mkdirSync(options.out, { recursive: true });
  const heapFile = path.join(options.out, 'heap.jsonl');
  const lagFile = path.join(options.out, 'lag.jsonl');
  const ticksFile = path.join(options.out, 'ticks.jsonl');
  const timelineFile = path.join(options.out, TIMELINE_FILE);
  rmSync(heapFile, { force: true });
  rmSync(lagFile, { force: true });
  rmSync(timelineFile, { force: true });

  const choice = chooseType(options.type, offeredTypes(process.cwd()), FALLBACK_TYPE);
  say(
    choice.fellBack
      ? `subagent type ${choice.wanted} is not offered here, using ${choice.type} instead`
      : `subagent type: ${choice.type}`,
  );

  const { session } = await openSettledSession(binary, {
    args: ['--auto', AUTONOMY],
    env: sessionEnv({
      heap: options.heap ? heapFile : undefined,
      lag: options.lag ? lagFile : undefined,
    }),
  });
  const { pid } = session;
  const sampler = startSampler(pid, {
    intervalMs: TICK_MS,
    footprintEvery: FOOTPRINT_EVERY,
    out: ticksFile,
  });
  const excluded: RunRecord['excluded'][number][] = [];

  try {
    say(`session ${pid} is up, sampling for ${BEFORE_MS / MS_PER_SECOND}s before sending`);
    await delay(BEFORE_MS);
    if (options.heap) {
      const taken = await takeSnapshot(pid, heapFile, 'baseline');
      const { span } = await settleAfterSnapshot(sampler, taken);
      excluded.push(span);
      await delay(QUIET_AFTER_SETTLE_MS);
    }

    session.paste(
      subagentPrompt({ count: options.count, work: options.work, sleep, files, type: choice.type }),
    );
    session.mark();
    await session.type(ENTER);
    const sendMs = Date.now();
    say(
      reads
        ? `sent: ${options.count} subagents, each reading ${files.length} files: ${files.join(', ')}`
        : `sent: ${options.count} subagents, each sleeping ${sleep}s`,
    );

    const waitS = reads ? READ_WAIT_S : sleep + REPLY_SLACK_S;
    const deadline = performance.now() + waitS * MS_PER_SECOND;
    let doneMs: number | undefined;
    while (doneMs === undefined) {
      if (performance.now() > deadline) {
        throw new Error('no final reply on screen: did the model launch the subagents?');
      }
      if (
        session.frames().some((frame) => isFinished(frame.text)) &&
        Date.now() - sendMs >= sleep * MS_PER_SECOND
      ) {
        doneMs = Date.now();
      } else {
        // oxlint-disable-next-line no-await-in-loop
        await delay(POLL_MS);
      }
    }
    say(`final reply seen ${((doneMs - sendMs) / MS_PER_SECOND).toFixed(0)}s after sending`);

    await delay(Math.max(0, doneMs + AFTER_LAST_MS + END_MARGIN_MS - Date.now()));
    const ticks = await sampler.stop();
    if (options.heap) {
      await takeSnapshot(pid, heapFile, 'after-finish');
    }

    const record: RunRecord = {
      sendMs,
      doneMs,
      excluded,
      count: options.count,
      work: options.work,
      sleep,
      type: choice.type,
    };
    saveRecord(options.out, record);
    printReport({
      ticks,
      record,
      heapFile: options.heap ? heapFile : undefined,
      lagFile: options.lag ? lagFile : undefined,
    });
    say('');
    say(`samples: ${ticksFile}`);
  } finally {
    await sampler.stop();
    await session.close();
  }
}
