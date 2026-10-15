import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say, whole } from '../cli.ts';
import { isSummary, summaryBody } from '../patch/summary-format.ts';
import { makeTempDir } from '../temp.ts';
import { describeRow, missingReuse, reuseRows, rowsFor } from './compaction-capture-report.ts';
import { DEFAULT_DIGEST_FOLDER } from './digest-key.ts';
import {
  compress,
  openLiveSession,
  sessionFolder,
  submit,
  transcriptsIn,
  withLiveDir,
} from './live-session.ts';
import type { Transcript } from './live-transcript.ts';
import { callerOf, toolResultCount, turnEnded } from './live-transcript.ts';
import { poll } from './poll.ts';
import { SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import { compactionsOf } from './summaries-report.ts';

const BODIES_VARIABLE = 'OD_BODIES';
const AUTONOMY = ['--auto', 'medium'];
const DIGEST_FILE = /^\d+-.*\.md$/u;

export interface CompactionCaptureOptions {
  modelId: string;
  effort: string;
  out?: string;
  files: number;
  timeout: number;
}

interface Capture {
  sessionId: string;
  summaryChars: number | undefined;
  summaryIsSummary: boolean;
}

function digestFiles(count: number): string[] {
  const names = readdirSync(DEFAULT_DIGEST_FOLDER)
    .filter((name) => DIGEST_FILE.test(name))
    .toSorted()
    .slice(0, count);
  if (names.length < count) {
    throw new Error(
      `${DEFAULT_DIGEST_FOLDER} holds only ${names.length} digest files, not ${count}`,
    );
  }
  return names.map((name) => path.join(DEFAULT_DIGEST_FOLDER, name));
}

function promptFor(files: readonly string[], tag: string): string {
  return [
    `Read each of these ${files.length} files in full with the Read tool, one file per call, in this order:`,
    ...files.map((file) => `- ${file}`),
    'Then reply with the single word "done". Do no other work and call no other tool.',
    `(probe ${tag})`,
  ].join('\n');
}

function mainTranscript(folder: string, tag: string): Transcript | undefined {
  return transcriptsIn(folder).find(({ text }) => callerOf(text) === '' && text.includes(tag));
}

interface Drive {
  binary: string;
  options: CompactionCaptureOptions;
  out: string;
  dir: string;
}

async function driveCapture({ binary, options, out, dir }: Drive): Promise<Capture> {
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd);
  const files = digestFiles(options.files);
  const tag = randomUUID().slice(0, 8);
  const timeoutMs = options.timeout * MS_PER_SECOND;
  const session = await openLiveSession(binary, {
    cwd,
    dir,
    model: options.modelId,
    effort: options.effort,
    args: AUTONOMY,
    env: { [BODIES_VARIABLE]: out },
  });
  try {
    await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
    const folder = sessionFolder(cwd);
    await submit(session, promptFor(files, tag));
    const read = await poll(() => {
      const found = mainTranscript(folder, tag);
      return found !== undefined && turnEnded(found.text) ? found : undefined;
    }, timeoutMs);
    if (read === undefined) {
      throw new Error(
        `the session did not finish reading ${files.length} files within ${options.timeout}s`,
      );
    }
    const reads = toolResultCount(read.text);
    if (reads < files.length) {
      throw new Error(`the session made ${reads} tool calls for ${files.length} files`);
    }

    await compress(session);
    const stored = await poll(() => {
      const found = transcriptsIn(folder).find(({ id }) => id === read.id);
      const summaries = found === undefined ? [] : compactionsOf(read.id, found.text);
      return summaries.at(-1);
    }, timeoutMs);
    return {
      sessionId: read.id,
      summaryChars: stored?.text.length,
      summaryIsSummary: stored !== undefined && isSummary(summaryBody(stored.text)),
    };
  } finally {
    await session.close();
  }
}

export async function compactionCapture(
  binary: string,
  options: CompactionCaptureOptions,
): Promise<void> {
  const out = path.resolve(options.out ?? path.join(makeTempDir('capture'), 'bodies.jsonl'));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, '');
  say(
    `${options.modelId} at effort ${options.effort} reads ${options.files} digest files, then /compress; request bodies go to ${out}`,
  );

  const capture = await withLiveDir(
    'compaction-capture',
    async (dir) => await driveCapture({ binary, options, out, dir }),
  );
  say(
    capture.summaryChars === undefined
      ? `no summary was stored within ${options.timeout}s`
      : `stored a ${whole(capture.summaryChars)}-character ${capture.summaryIsSummary ? 'summary' : 'text that is not a stock-format summary'}`,
  );

  const rows = rowsFor(existsSync(out) ? readFileSync(out, 'utf-8') : '', capture.sessionId);
  const reuse = reuseRows(rows);
  if (reuse.length === 0) {
    throw new Error(missingReuse(rows, capture.sessionId));
  }
  for (const row of reuse) {
    say(describeRow(row, out));
  }
}
