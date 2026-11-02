import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { guard, say } from '../cli.ts';
import { withLiveDir } from './live-session.ts';
import { poll } from './poll.ts';
import { send, settle } from './rewind.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import type { StackedCapture } from './stacked-report.ts';
import {
  describeFindings,
  EDIT_FILE,
  NEW_LINE,
  OLD_LINE,
  readStacked,
  TURN_REQUESTS,
} from './stacked-report.ts';
import { toolNamesIn } from './stale-edit-cases.ts';
import { streamEvents, stubSettings, toolBatchEvents } from './stub-model.ts';
import type { ToolCall } from './stub-model.ts';

const MODEL = 'stub-stacked';
const STUB_NAME = 'Stub Stream';
const PROMPT = 'Go through the files.';
const HOLD_AT = 5;
const HOLD_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 60_000;
const MID_RUN_QUIET_MS = 800;
const MID_RUN_TIMEOUT_MS = 3000;

function plan(dir: string, token: string): ToolCall[] {
  const file = (name: string) => path.join(dir, name);
  const calls: Pick<ToolCall, 'name' | 'input'>[] = [
    { name: 'Read', input: { file_path: file('a.txt') } },
    { name: 'Read', input: { file_path: file('b.txt') } },
    { name: 'Grep', input: { pattern: 'needle', path: dir, output_mode: 'content' } },
    { name: 'Execute', input: { command: 'true', riskLevel: 'low' } },
    { name: 'Execute', input: { command: 'false', riskLevel: 'low' } },
    {
      name: 'Edit',
      input: { file_path: file(EDIT_FILE), old_str: OLD_LINE, new_str: NEW_LINE },
    },
    { name: 'Read', input: { file_path: file('c.txt') } },
  ];
  return calls.map(({ name, input }, index) => ({
    name,
    input,
    id: `toolu_stacked${token}_${index}`,
  }));
}

function writeProject(dir: string): void {
  writeFileSync(path.join(dir, EDIT_FILE), `${OLD_LINE}\nsecond line\n`);
  writeFileSync(path.join(dir, 'b.txt'), 'needle in b\n');
  writeFileSync(path.join(dir, 'c.txt'), 'plain c\n');
}

interface Stub {
  url: string;
  served: () => number;
  held: Promise<boolean>;
  release: () => void;
  stop: () => Promise<void>;
}

function startStub(calls: readonly ToolCall[]): Stub {
  const held = Promise.withResolvers<boolean>();
  const released = Promise.withResolvers<boolean>();
  let served = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const names = toolNamesIn(await request.json());
      if (names.length === 0) {
        return new Response(streamEvents(['ok']).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      const step = served;
      served += 1;
      if (step === HOLD_AT) {
        held.resolve(true);
        await released.promise;
      }
      const call = calls[step];
      const events = call === undefined ? streamEvents(['done']) : toolBatchEvents([call]);
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    served: () => served,
    held: held.promise,
    release: () => {
      released.resolve(true);
    },
    stop: async () => {
      released.resolve(true);
      await server.stop(true);
    },
  };
}

async function driveTurn(session: Session, stub: Stub): Promise<StackedCapture> {
  await send(session, PROMPT);
  const reached = await Promise.race([stub.held, Bun.sleep(HOLD_TIMEOUT_MS).then(() => false)]);
  let midRun: string[] | undefined;
  if (reached) {
    await session.quiet(MID_RUN_QUIET_MS, MID_RUN_TIMEOUT_MS);
    midRun = session.screen();
  }
  stub.release();
  await poll(() => (stub.served() >= TURN_REQUESTS ? true : undefined), TURN_TIMEOUT_MS);
  await settle(session);
  return {
    served: stub.served(),
    screen: session.screen(),
    ...(midRun !== undefined && { midRun }),
  };
}

export async function captureStacked(binary: string, display: string): Promise<StackedCapture> {
  const token = randomUUID().slice(0, 8);
  return await withLiveDir('stacked', async (dir) => {
    writeProject(dir);
    const stub = startStub(plan(dir, token));
    try {
      const settings = path.join(dir, 'settings.json');
      writeFileSync(
        settings,
        JSON.stringify({ ...stubSettings(stub.url, MODEL), toolResultDisplay: display }),
      );
      const { session } = await openSettledSession(binary, {
        cwd: dir,
        env: { FACTORY_RUNTIME_SETTINGS_PATH: settings },
        screen: true,
      });
      const drive = async (): Promise<StackedCapture> => {
        if (!session.screen().some((line) => line.includes(STUB_NAME))) {
          throw new Error(
            `${binary} did not take the probe's settings (toolResultDisplay '${display}'; the status bar does not name '${STUB_NAME}'), so the prompt was not sent: it would reach a real model`,
          );
        }
        return await driveTurn(session, stub);
      };
      try {
        const capture = await drive();
        await session.close();
        return capture;
      } catch (error) {
        await session.close().catch(() => null);
        throw error;
      }
    } finally {
      await stub.stop();
    }
  });
}

export interface StackedOptions {
  display: string;
}

export async function stacked(binary: string, options: StackedOptions): Promise<void> {
  say(
    'a stub model reads two files, greps, runs two commands (one fails), edits a file and reads a third, with Tool result display set to stacked: do the non-edit calls share one growing line with the edit inline, and does scrollback keep exactly one copy of each line?',
  );
  const capture = await captureStacked(binary, options.display);
  const findings = readStacked(capture);
  say(describeFindings(findings));
  if (findings.some((finding) => !finding.pass)) {
    process.exitCode = 1;
  }
}

export function registerStackedCommand(program: Command): void {
  program
    .command('stacked')
    .description(
      'with Tool result display set to stacked, run a stub-model turn of reads, a grep, two commands (one failing), an edit and a read: do the non-edit calls collapse into one growing line with the edit inline, does a mid-run frame show the counts so far with a ↳ line for the latest call, and does scrollback keep exactly one copy of each line?',
    )
    .argument('<binary>')
    .option(
      '--display <value>',
      'value for the toolResultDisplay setting; a build without the stacked patch rejects stacked, so pass expanded to run it end to end',
      'stacked',
    )
    .action(guard(stacked));
}
