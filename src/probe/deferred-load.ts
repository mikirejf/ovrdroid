import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { count, guard, MS_PER_SECOND, say } from '../cli.ts';
import { isRecord, toJson } from './bodies.ts';
import type { RecordedRequest } from './deferred-load-report.ts';
import {
  answerFor,
  DEFERRED_TOOL,
  deferredLoadVerdict,
  SEARCH_TOOL,
} from './deferred-load-report.ts';
import { launchEnv, race } from './launch.ts';
import { withLiveDir } from './live-session.ts';
import { Ledger } from './owned-sessions.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';
import { describeChecks, warmPassed } from './warm-verdict.ts';

const REGISTRY_CLAUDE_MODEL = 'claude-haiku-5-5';
const DEFAULT_TIMEOUT_S = 60;
const PROMPT = 'Load the deferred tool, then list this folder.';
const STDERR_TAIL = 2000;

export interface DeferredLoadOptions {
  timeout: number;
}

interface Stub {
  url: string;
  requests: RecordedRequest[];
  stop: () => Promise<void>;
}

function serveTurn(cwd: string): Stub {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body = toJson(await request.json());
      if (!isRecord(body)) {
        return new Response('not a JSON object', { status: 400 });
      }
      requests.push({ body, beta: request.headers.get('anthropic-beta') ?? '' });
      const call = answerFor(body, DEFERRED_TOOL, cwd);
      const events = call === undefined ? streamEvents(['done']) : toolEvents(call);
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: async () => {
      await server.stop(true);
    },
  };
}

async function execTurn(
  binary: string,
  dir: string,
  timeoutMs: number,
): Promise<RecordedRequest[]> {
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd);
  const stub = serveTurn(cwd);
  const settings = stubSettings(stub.url, REGISTRY_CLAUDE_MODEL);
  const settingsFile = path.join(dir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify(settings));
  const ledger = new Ledger(cwd);
  try {
    const child = Bun.spawn(
      [
        binary,
        'exec',
        '--tool-execution-mode',
        'direct-only',
        '--auto',
        'high',
        '-m',
        settings.sessionDefaultSettings.model,
        '--cwd',
        cwd,
        PROMPT,
      ],
      {
        cwd,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
        env: launchEnv({ ...ledger.env, FACTORY_RUNTIME_SETTINGS_PATH: settingsFile }),
      },
    );
    ledger.adopt(child);
    ledger.expectSession();
    const [stderr] = await race(
      Promise.all([new Response(child.stderr).text(), child.exited]),
      timeoutMs,
      `${binary} exec was still running ${timeoutMs / MS_PER_SECOND}s in`,
    );
    if (child.exitCode !== 0) {
      throw new Error(
        `droid exec exited with code ${child.exitCode}: ${stderr.slice(-STDERR_TAIL)}`,
      );
    }
    return stub.requests;
  } finally {
    await ledger.release();
    await stub.stop();
  }
}

export async function deferredLoad(binary: string, options: DeferredLoadOptions): Promise<void> {
  say(
    `a stub ${REGISTRY_CLAUDE_MODEL} custom model runs one direct-mode droid exec turn: ${SEARCH_TOOL} select:${DEFERRED_TOOL}, then LS, then a reply; each request must extend the one before it, deferred tools aside`,
  );
  const requests = await withLiveDir(
    'deferred-load',
    async (dir) => await execTurn(binary, dir, options.timeout * MS_PER_SECOND),
  );
  const { checks, summary } = deferredLoadVerdict(requests, DEFERRED_TOOL);
  say(describeChecks(checks));
  say(summary);
  if (!warmPassed(checks)) {
    process.exitCode = 1;
  }
}

export function registerDeferredLoadCommand(program: Command): void {
  program
    .command('deferred-load')
    .description(
      'have a stub custom Claude model load a deferred tool with ToolSearch in a direct-mode droid exec turn: does every request still extend the one before it (tools marked defer_loading aside, since the API keeps them out of the cached prefix), so the prompt cache survives the load? Fails when the tool was never loaded, or is sent deferred without a tool_reference. Makes no real model calls',
    )
    .argument('<binary>')
    .option('--timeout <s>', 'seconds to wait for the exec turn', count, DEFAULT_TIMEOUT_S)
    .action(guard(deferredLoad));
}
