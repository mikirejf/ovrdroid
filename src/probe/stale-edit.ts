import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { count, guard, MS_PER_SECOND, say } from '../cli.ts';
import { withTempDir } from '../temp.ts';
import { inBatches } from './denylist.ts';
import { launchEnv, race } from './launch.ts';
import { Ledger } from './owned-sessions.ts';
import type { Observed, StaleCase, ToolResult, Turn, Verdict } from './stale-edit-cases.ts';
import {
  caseVerdict,
  describeVerdicts,
  INITIAL,
  staleEditCases,
  toolNamesIn,
  toolResultsIn,
  turnsOf,
} from './stale-edit-cases.ts';
import { streamEvents, stubSettings, toolBatchEvents } from './stub-model.ts';

const DEFAULT_TIMEOUT_S = 90;
const DEFAULT_PARALLEL = 4;
const PROMPT = 'Edit the file.';
const DIRECT_MODEL = 'stub-stale-edit';
const SCRIPT_MODEL = 'claude-sonnet-stub-stale-edit';
const OUTSIDE_LEAD_MS = 2000;

export interface StaleEditOptions {
  timeout: number;
  parallel: number;
}

interface CaseRun {
  binary: string;
  staleCase: StaleCase;
  index: number;
  token: string;
  timeoutMs: number;
}

function changeFromOutside(file: string, text: string): void {
  const before = statSync(file).mtimeMs;
  writeFileSync(file, text);
  const later = new Date(before + OUTSIDE_LEAD_MS);
  utimesSync(file, later, later);
}

interface Serving {
  url: string;
  observed: () => Omit<Observed, 'finalText'>;
  stop: () => Promise<void>;
}

function serveTurns(turns: readonly Turn[], file: string): Serving {
  const results = new Map<string, ToolResult>();
  let offered: string[] = [];
  let outsideWrites = 0;
  let served = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body: unknown = await request.json();
      const names = toolNamesIn(body);
      if (names.length === 0) {
        return new Response(streamEvents(['ok']).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      offered = names;
      for (const [id, result] of toolResultsIn(body)) {
        results.set(id, result);
      }
      const turn = turns[served];
      served += 1;
      if (turn?.outside !== undefined) {
        changeFromOutside(file, turn.outside);
        outsideWrites += 1;
      }
      const events = turn === undefined ? streamEvents(['done']) : toolBatchEvents(turn.calls);
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    observed: () => ({ results, outsideWrites, offered }),
    stop: async () => {
      await server.stop(true);
    },
  };
}

interface Target {
  dir: string;
  url: string;
  model: string;
}

async function execOnce(run: CaseRun, { dir, url, model }: Target): Promise<void> {
  const settings = path.join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify(stubSettings(url, model)));
  const flags = path.join(dir, 'feature-flags.json');
  writeFileSync(flags, JSON.stringify({ flags: {}, configs: {} }));
  const ledger = new Ledger();
  try {
    const child = Bun.spawn(
      [run.binary, 'exec', '--auto', 'high', '-m', `custom:${model}`, '--cwd', dir, PROMPT],
      {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        env: launchEnv({
          FACTORY_RUNTIME_SETTINGS_PATH: settings,
          FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: flags,
          ...ledger.env,
        }),
      },
    );
    ledger.adopt(child);
    ledger.expectSession();
    await race(
      child.exited,
      run.timeoutMs,
      `${run.binary} exec was still running ${run.timeoutMs}ms in`,
    );
  } finally {
    await ledger.release();
  }
}

async function runCase(run: CaseRun): Promise<Verdict> {
  const model = run.staleCase.via === 'script' ? SCRIPT_MODEL : DIRECT_MODEL;
  return await withTempDir('stale-edit', async (dir) => {
    const file = path.join(dir, 'target.txt');
    writeFileSync(file, INITIAL);
    const turns = turnsOf(
      run.staleCase,
      file,
      (turn) => `toolu_stale${run.token}_${run.index}_${turn}`,
    );
    const serving = serveTurns(turns, file);
    try {
      await execOnce(run, { dir, url: serving.url, model });
    } finally {
      await serving.stop();
    }
    const finalText = readFileSync(file, 'utf-8');
    return caseVerdict(run.staleCase, turns, { ...serving.observed(), finalText });
  });
}

export async function runStaleEdit(binary: string, options: StaleEditOptions): Promise<Verdict[]> {
  const token = Math.random().toString(36).slice(2, 8);
  return await inBatches(
    staleEditCases(),
    options.parallel,
    async (staleCase, index) =>
      await runCase({
        binary,
        staleCase,
        index,
        token,
        timeoutMs: options.timeout * MS_PER_SECOND,
      }),
  );
}

export async function staleEdit(binary: string, options: StaleEditOptions): Promise<void> {
  say(
    'a stub model reads a file, the probe then changes the file from outside, and the stub model edits it, in droid exec --auto high; each case says what Droid did with the Edit',
  );
  const verdicts = await runStaleEdit(binary, options);
  say(describeVerdicts(verdicts));
  if (verdicts.some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}

export function registerStaleEditCommand(program: Command): void {
  program
    .command('stale-edit')
    .description(
      'have a stub model Read a file, change the file from outside, then Edit it through droid exec: does Droid apply an Edit whose old_str still matches exactly once in the changed file (alone, in parallel with another Edit, inside a Script, and right after a tolerated one), and still refuse when the change removed old_str, duplicated it, or change_all is set?',
    )
    .argument('<binary>')
    .option('--timeout <s>', 'seconds to wait for each exec run', count, DEFAULT_TIMEOUT_S)
    .option('--parallel <n>', 'exec runs at once', count, DEFAULT_PARALLEL)
    .action(guard(staleEdit));
}
