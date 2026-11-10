import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND } from '../cli.ts';
import { sessionFolder, withLiveDir } from './live-session.ts';
import type { Plan, ReadonlyEvidence } from './readonly-shell-report.ts';
import {
  callId,
  CHILDREN,
  droidFile,
  launchPrompt,
  legKey,
  noticesIn,
  replyFor,
  resumePrompt,
  sessionOf,
} from './readonly-shell-report.ts';
import { send, settle, waitFor } from './rewind.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import { saveBodies } from './skill-carry.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

export const DEFAULT_READONLY_TIMEOUT_S = 60;

export interface ReadonlyShellOptions {
  timeout: number;
  out?: string;
}

interface Stub {
  url: string;
  bodies: unknown[];
  stop: () => Promise<void>;
}

function startStub(plan: Plan): Stub {
  const bodies: unknown[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body: unknown = await request.json();
      bodies.push(body);
      const reply = replyFor(body, plan);
      const events = typeof reply === 'string' ? streamEvents([reply]) : toolEvents(reply);
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    bodies,
    stop: async () => {
      await server.stop(true);
    },
  };
}

interface Drive {
  session: Session;
  bodies: readonly unknown[];
  folder: string;
  run: string;
  timeoutMs: number;
}

interface LegRun {
  prompt: string;
  notices: number;
  what: string;
}

async function runLeg(drive: Drive, leg: LegRun): Promise<void> {
  await send(drive.session, leg.prompt);
  await waitFor(
    `${leg.what} did not finish`,
    () => (noticesIn(drive.bodies) >= leg.notices ? true : undefined),
    drive.timeoutMs,
  );
  await settle(drive.session);
}

function settingsOf(folder: string, session: string): string {
  const file = path.join(folder, `${session}.settings.json`);
  return existsSync(file) ? readFileSync(file, 'utf-8') : '';
}

async function driveChildren(drive: Drive): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};
  let notices = 0;
  for (const child of CHILDREN) {
    notices += 1;
    // oxlint-disable-next-line no-await-in-loop
    await runLeg(drive, {
      prompt: launchPrompt(child),
      notices,
      what: `the first run of ${child.droid}`,
    });
    const session = sessionOf(drive.bodies, callId(drive.run, child, 'launch'));
    if (session === undefined) {
      throw new Error(`Droid started no sub-agent for ${child.droid}`);
    }
    settings[legKey(child, 'launch')] = settingsOf(drive.folder, session);
    notices += 1;
    // oxlint-disable-next-line no-await-in-loop
    await runLeg(drive, {
      prompt: resumePrompt(child, session),
      notices,
      what: `the resume of ${child.droid}`,
    });
    settings[legKey(child, 'resume')] = settingsOf(drive.folder, session);
  }
  return settings;
}

export async function runReadonlyShell(
  binary: string,
  options: ReadonlyShellOptions,
): Promise<ReadonlyEvidence> {
  const run = randomUUID().slice(0, 8);
  return await withLiveDir('readonly-shell', async (dir) => {
    const cwd = path.join(dir, 'work');
    const markers = path.join(dir, 'markers');
    const droids = path.join(cwd, '.factory', 'droids');
    mkdirSync(markers, { recursive: true });
    mkdirSync(droids, { recursive: true });
    for (const child of CHILDREN) {
      writeFileSync(path.join(droids, `${child.droid}.md`), droidFile(child));
    }
    const stub = startStub({ run, markers });
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(stubSettings(stub.url)));
    const folder = sessionFolder(cwd);
    try {
      const { session } = await openSettledSession(binary, {
        cwd,
        env: { FACTORY_RUNTIME_SETTINGS_PATH: settingsFile },
      });
      try {
        const settings = await driveChildren({
          session,
          bodies: stub.bodies,
          folder,
          run,
          timeoutMs: options.timeout * MS_PER_SECOND,
        });
        return { run, bodies: [...stub.bodies], markers: readdirSync(markers), settings };
      } finally {
        await session.close();
      }
    } finally {
      await stub.stop();
      rmSync(folder, { recursive: true, force: true });
      if (options.out !== undefined) {
        saveBodies(
          options.out,
          stub.bodies.map((body) => JSON.stringify(body)),
        );
      }
    }
  });
}
