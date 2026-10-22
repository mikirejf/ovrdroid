import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { count, guard, MS_PER_SECOND, say } from '../cli.ts';
import { withTempDir } from '../temp.ts';
import type { CaseResult, DenylistCase, Observed } from './denylist-cases.ts';
import {
  caseVerdict,
  denylistCases,
  describeVerdicts,
  PROBE_DENYLIST,
  readOutcome,
  RULES_ENGINE_FLAG,
} from './denylist-cases.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import { launchEnv, race } from './launch.ts';
import { Ledger } from './owned-sessions.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

const DEFAULT_TIMEOUT_S = 60;
const DEFAULT_PARALLEL = 4;
const EXECUTE_TOOL = 'Execute';
const PROMPT = 'Run the probe command.';

export interface DenylistOptions {
  timeout: number;
  parallel: number;
}

interface CaseRun {
  binary: string;
  denylistCase: DenylistCase;
  callId: string;
  sandbox: string;
  timeoutMs: number;
}

function asksForCall(body: unknown): boolean {
  const request = fieldsOf(body);
  const offered = entriesOf(request, 'tools').some((tool) => worded(tool, 'name') === EXECUTE_TOOL);
  return offered && !JSON.stringify(body).includes('"tool_result"');
}

function serveCall(command: string, callId: string) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const events = asksForCall(await request.json())
        ? toolEvents({
            id: callId,
            name: EXECUTE_TOOL,
            input: { command, riskLevel: 'low', riskLevelReason: 'probe', summary: 'probe' },
          })
        : streamEvents(['ok']);
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
}

async function execOnce(run: CaseRun, dir: string, url: string): Promise<string> {
  const settings = path.join(dir, 'settings.json');
  const stub = stubSettings(url);
  const { model } = stub.sessionDefaultSettings;
  writeFileSync(settings, JSON.stringify({ ...stub, commandDenylist: PROBE_DENYLIST }));
  const flags = path.join(dir, 'feature-flags.json');
  const rules = run.denylistCase.engine === 'rules';
  writeFileSync(flags, JSON.stringify({ flags: { [RULES_ENGINE_FLAG]: rules }, configs: {} }));
  const ledger = new Ledger();
  try {
    const child = Bun.spawn(
      [
        run.binary,
        'exec',
        '--auto',
        'high',
        '-m',
        model,
        '-o',
        'stream-json',
        '--cwd',
        run.sandbox,
        PROMPT,
      ],
      {
        stdin: 'ignore',
        stdout: 'pipe',
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
    const [stdout] = await race(
      Promise.all([new Response(child.stdout).text(), child.exited]),
      run.timeoutMs,
      `${run.binary} exec was still running ${run.timeoutMs}ms in`,
    );
    return stdout;
  } finally {
    await ledger.release();
  }
}

async function runCase(run: CaseRun): Promise<Observed> {
  const server = serveCall(run.denylistCase.command, run.callId);
  try {
    return await withTempDir('denylist-run', async (dir) =>
      readOutcome(await execOnce(run, dir, `http://127.0.0.1:${server.port}`), run.callId),
    );
  } finally {
    await server.stop(true);
  }
}

async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    // oxlint-disable-next-line no-await-in-loop
    const done = await Promise.all(batch.map(async (item, at) => await work(item, start + at)));
    results.push(...done);
  }
  return results;
}

export async function runDenylist(binary: string, options: DenylistOptions): Promise<CaseResult[]> {
  const token = randomUUID().slice(0, 8);
  return await withTempDir('denylist', async (sandbox) => {
    const cases = denylistCases({
      sandbox,
      absentHomeChild: `.cache/ovrdroid-denylist-absent-${token}`,
    });
    return await inBatches(cases, options.parallel, async (denylistCase, index) => ({
      denylistCase,
      observed: await runCase({
        binary,
        denylistCase,
        callId: `toolu_denylist${token}_${index}`,
        sandbox,
        timeoutMs: options.timeout * MS_PER_SECOND,
      }),
    }));
  });
}

export async function denylist(binary: string, options: DenylistOptions): Promise<void> {
  say(
    `a stub model makes one Execute call per case in droid exec --auto high, with deny list ${JSON.stringify(PROBE_DENYLIST)}; every command meant to ask is prefixed with "false &&", so it does nothing if it runs`,
  );
  const results = await runDenylist(binary, options);
  const verdicts = results.map((result) => caseVerdict(result));
  say(describeVerdicts(verdicts));
  if (verdicts.some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}

export function registerDenylistCommand(program: Command): void {
  program
    .command('denylist')
    .description(
      'have a stub model run deny-listed and look-alike commands through droid exec, under the legacy and the rules permission engine: do destructive commands and every spelling of home (~, $HOME, "$HOME"/*, a braced home, chained after another command) still ask or get blocked, and do a quoted heredoc body, a path under / or home and a command that only starts like a deny entry run without asking?',
    )
    .argument('<binary>')
    .option('--timeout <s>', 'seconds to wait for each exec run', count, DEFAULT_TIMEOUT_S)
    .option('--parallel <n>', 'exec runs at once', count, DEFAULT_PARALLEL)
    .action(guard(denylist));
}
