import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { Command } from 'commander';

import { count, guard, MS_PER_SECOND, say } from '../cli.ts';
import { INSTALLED_DROID } from '../paths.ts';
import { withTempDir } from '../temp.ts';
import type { AgentBrowserCase, Expected, Observation, Verdict } from './agent-browser-report.ts';
import {
  agentBrowserCases,
  BINARY_NAME,
  caseVerdict,
  describeVerdicts,
  pathWithout,
  probeCommand,
  SKILLS_LINE,
  STALE_SCRIPT,
  toolResultIn,
} from './agent-browser-report.ts';
import { inBatches } from './denylist.ts';
import type { LaunchEnv } from './launch.ts';
import { launchEnv, race } from './launch.ts';
import { stdoutOf } from './run.ts';
import type { ToolCall } from './stub-model.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

const DEFAULT_TIMEOUT_S = 60;
const DEFAULT_PARALLEL = 3;
const EXECUTE_TOOL = 'Execute';
const PROMPT = 'Run the probe command.';
const EXECUTABLE = 0o755;
const OUTPUT_WAIT_MS = 10_000;
const OUTPUT_POLL_MS = 50;

export interface AgentBrowserOptions {
  timeout: number;
  parallel: number;
}

interface Layout {
  home: string;
  work: string;
  settings: string;
  flags: string;
  marker: string;
  output: string;
  bundledBinary: string;
  bundledToolsDir: string;
}

function layoutIn(root: string): Layout {
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  const factory = path.join(home, '.factory');
  return {
    home,
    work,
    settings: path.join(root, 'settings.json'),
    flags: path.join(root, 'feature-flags.json'),
    marker: path.join(work, 'ran.marker'),
    output: path.join(work, 'output.txt'),
    bundledBinary: path.join(factory, 'bin', BINARY_NAME),
    bundledToolsDir: path.join(factory, 'tools', BINARY_NAME),
  };
}

function asksForCall(body: unknown): boolean {
  const text = JSON.stringify(body);
  return text.includes(`"name":"${EXECUTE_TOOL}"`) && !text.includes('"tool_result"');
}

function executeInput(command: string, background: boolean) {
  const input = { command, riskLevel: 'low', riskLevelReason: 'probe', summary: 'probe' };
  return background ? { ...input, fireAndForget: true } : input;
}

function serveCall(input: ToolCall['input'], callId: string) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const events = asksForCall(await request.json())
        ? toolEvents({ id: callId, name: EXECUTE_TOOL, input })
        : streamEvents(['ok']);
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
}

function directories(): string[] {
  return (Bun.env['PATH'] ?? '').split(path.delimiter);
}

function holdsBinary(directory: string): boolean {
  return existsSync(path.join(directory, BINARY_NAME));
}

function childPath(agentCase: AgentBrowserCase): LaunchEnv {
  if (agentCase.situation !== 'absent') {
    return {};
  }
  const stripped = pathWithout(directories().join(path.delimiter), holdsBinary);
  if (stripped === '') {
    throw new Error(`every directory on PATH holds ${BINARY_NAME}, so no run can lack it`);
  }
  return { PATH: stripped };
}

interface Target {
  layout: Layout;
  model: string;
}

async function stdoutOfExec(run: CaseRun, { layout, model }: Target): Promise<string> {
  const { binary, agentCase, timeoutMs } = run;
  const child = Bun.spawn(
    [
      binary,
      'exec',
      '--tool-execution-mode',
      'direct-only',
      '--auto',
      'high',
      '-m',
      model,
      '-o',
      'stream-json',
      '--cwd',
      layout.work,
      PROMPT,
    ],
    {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      env: launchEnv({
        FACTORY_HOME_OVERRIDE: layout.home,
        FACTORY_RUNTIME_SETTINGS_PATH: layout.settings,
        FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: layout.flags,
        ...childPath(agentCase),
      }),
    },
  );
  try {
    const [stdout] = await race(
      Promise.all([new Response(child.stdout).text(), child.exited]),
      timeoutMs,
      `${binary} exec was still running ${timeoutMs}ms in`,
    );
    return stdout;
  } finally {
    child.kill('SIGKILL');
  }
}

async function outputOnceWritten(file: string): Promise<string | undefined> {
  const deadline = Date.now() + OUTPUT_WAIT_MS;
  while (Date.now() < deadline) {
    if (existsSync(file) && readFileSync(file, 'utf-8').includes(SKILLS_LINE)) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(OUTPUT_POLL_MS);
  }
  return existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
}

async function observe(layout: Layout, stdout: string, callId: string): Promise<Observation> {
  const result = toolResultIn(stdout, callId);
  return {
    result,
    output: result?.isError === false ? await outputOnceWritten(layout.output) : undefined,
    marker: existsSync(layout.marker),
    bundledBinary: existsSync(layout.bundledBinary)
      ? readFileSync(layout.bundledBinary, 'utf-8')
      : undefined,
    bundledToolsDir: existsSync(layout.bundledToolsDir),
  };
}

interface CaseRun {
  binary: string;
  agentCase: AgentBrowserCase;
  callId: string;
  versionLine: string;
  timeoutMs: number;
}

async function runCase(run: CaseRun): Promise<Verdict> {
  const { agentCase } = run;
  return await withTempDir('agent-browser', async (root) => {
    const layout = layoutIn(root);
    mkdirSync(layout.work, { recursive: true });
    if (agentCase.situation === 'stale') {
      mkdirSync(path.dirname(layout.bundledBinary), { recursive: true });
      writeFileSync(layout.bundledBinary, STALE_SCRIPT, { mode: EXECUTABLE });
    }
    const input = executeInput(probeCommand(layout), agentCase.placement === 'background');
    const server = serveCall(input, run.callId);
    try {
      const stub = stubSettings(`http://127.0.0.1:${server.port}`);
      writeFileSync(layout.settings, JSON.stringify(stub));
      writeFileSync(layout.flags, JSON.stringify({ flags: {}, configs: {} }));
      const stdout = await stdoutOfExec(run, {
        layout,
        model: stub.sessionDefaultSettings.model,
      });
      const expected: Expected = { scratchHome: layout.home, versionLine: run.versionLine };
      return caseVerdict(agentCase, await observe(layout, stdout, run.callId), expected);
    } finally {
      await server.stop(true);
    }
  });
}

export async function installedVersionLine(): Promise<string> {
  let printed: string;
  try {
    const raw = await stdoutOf([BINARY_NAME, '--version'], { quiet: true, timeoutMs: 20_000 });
    printed = raw.trim();
  } catch (error) {
    throw new Error(
      `this probe needs ${BINARY_NAME} on PATH to compare against: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (printed === '') {
    throw new Error(`${BINARY_NAME} --version printed nothing`);
  }
  return printed;
}

export async function runAgentBrowser(
  binary: string,
  options: AgentBrowserOptions,
): Promise<Verdict[]> {
  const versionLine = await installedVersionLine();
  const token = Math.random().toString(36).slice(2, 8);
  return await inBatches(
    agentBrowserCases(),
    options.parallel,
    async (agentCase, index) =>
      await runCase({
        binary,
        agentCase,
        callId: `toolu_agentbrowser${token}_${index}`,
        versionLine,
        timeoutMs: options.timeout * MS_PER_SECOND,
      }),
  );
}

export async function agentBrowser(binary: string, options: AgentBrowserOptions): Promise<void> {
  say(
    `a stub model runs a command naming ${BINARY_NAME} in droid exec --auto high, in a scratch Droid home, as a foreground and as a background Execute; each case says what Droid ran`,
  );
  const verdicts = await runAgentBrowser(binary, options);
  say(describeVerdicts(verdicts));
  if (verdicts.some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}

export function registerAgentBrowserCommand(program: Command): void {
  program
    .command('agent-browser')
    .description(
      'have a stub model run agent-browser through droid exec in a scratch Droid home, as a foreground and as a background Execute: does Droid run the agent-browser installed on PATH (printing its version, with AGENT_BROWSER_SKILLS_DIR unset), still do so past a stale copy planted in its own bin folder, extract nothing of its bundled copy, and, with none installed, refuse before running anything and tell the model to ask the user to install it?',
    )
    .argument('[binary]', 'binary to run', INSTALLED_DROID)
    .option('--timeout <s>', 'seconds to wait for each exec run', count, DEFAULT_TIMEOUT_S)
    .option('--parallel <n>', 'exec runs at once', count, DEFAULT_PARALLEL)
    .action(guard(agentBrowser));
}
