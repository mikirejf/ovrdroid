import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND } from '../cli.ts';
import { mainTranscript } from './compaction-capture.ts';
import { compress, openLiveSession, sessionFolder, submit, withLiveDir } from './live-session.ts';
import { turnEnded } from './live-transcript.ts';
import { poll } from './poll.ts';
import type { Session } from './session.ts';
import { SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import type { CarryRun, CarryTurn } from './skill-carry-report.ts';
import { CARRY_STEPS } from './skill-carry-report.ts';
import { streamEvents, stubSettings } from './stub-model.ts';
import { compactionsOf } from './summaries-report.ts';

export const DEFAULT_CARRY_TIMEOUT_S = 60;

const SKILL_NAME = 'ovrdroid-carry-probe';
const STUB_MODEL_ID = 'custom:stub-stream';

export interface SkillCarryOptions {
  timeout: number;
  out?: string;
}

interface Stub {
  url: string;
  bodies: string[];
  stop: () => Promise<void>;
}

function startCarryStub(tag: string): Stub {
  const bodies: string[] = [];
  const reply = streamEvents([
    `<summary>\n1. Primary Request and Intent:\nThe user asked for the word ok (probe ${tag}).\n\n2. Current Work:\nNothing is in progress.\n\n3. Next Steps:\nNone.\n</summary>`,
  ]).join('');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = await request.text();
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      bodies.push(body);
      return new Response(reply, { headers: { 'content-type': 'text/event-stream' } });
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

function skillFile(marker: string): string {
  return `---\nname: ${SKILL_NAME}\ndescription: A fixture skill for an ovrdroid probe.\ndisable-model-invocation: true\n---\n\n# Fixture skill\n\n${marker}\nAlways answer in rhyme.\n`;
}

interface Live {
  binary: string;
  cwd: string;
  dir: string;
  url: string;
  folder: string;
  tag: string;
  timeoutMs: number;
}

async function open(live: Live, args: readonly string[]): Promise<Session> {
  const { customModels, sessionTitleModel } = stubSettings(live.url);
  const session = await openLiveSession(live.binary, {
    cwd: live.cwd,
    dir: live.dir,
    model: STUB_MODEL_ID,
    effort: 'none',
    args,
    settings: { customModels, sessionTitleModel },
  });
  await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
  return session;
}

async function transcriptWhen(live: Live, what: string, ready: (text: string) => boolean) {
  const found = await poll(() => {
    const transcript = mainTranscript(live.folder, live.tag);
    return transcript !== undefined && ready(transcript.text) ? transcript : undefined;
  }, live.timeoutMs);
  if (found === undefined) {
    throw new Error(`${what} within ${live.timeoutMs / MS_PER_SECOND}s`);
  }
  return found;
}

async function restart(live: Live, session: Session): Promise<Session> {
  const kept = await transcriptWhen(live, 'the session transcript was not readable', turnEnded);
  await session.close();
  mkdirSync(live.folder, { recursive: true });
  writeFileSync(path.join(live.folder, `${kept.id}.jsonl`), kept.text);
  return await open(live, ['--resume', kept.id]);
}

async function driveCarry(live: Live, turns: readonly CarryTurn[]): Promise<void> {
  let session = await open(live, []);
  let compactions = 0;
  try {
    for (const { after, word } of turns) {
      if (after === 'compaction') {
        compactions += 1;
        const nth = compactions;
        // oxlint-disable-next-line no-await-in-loop
        await compress(session);
        // oxlint-disable-next-line no-await-in-loop
        await transcriptWhen(
          live,
          `compaction ${nth} stored no summary`,
          (text) => compactionsOf('', text).length >= nth,
        );
      }
      if (after === 'restart') {
        // oxlint-disable-next-line no-await-in-loop
        session = await restart(live, session);
      }
      const message =
        after === 'typing'
          ? `Say ok and follow /${SKILL_NAME} for it (${word})`
          : `Say ok again (${word})`;
      // oxlint-disable-next-line no-await-in-loop
      await submit(session, message);
      // oxlint-disable-next-line no-await-in-loop
      await transcriptWhen(
        live,
        `the turn for "${word}" did not end`,
        (text) => text.includes(word) && turnEnded(text),
      );
    }
  } finally {
    await session.close();
  }
}

export function saveBodies(out: string, bodies: readonly string[]): void {
  mkdirSync(out, { recursive: true });
  for (const [index, body] of bodies.entries()) {
    writeFileSync(path.join(out, `${String(index + 1).padStart(2, '0')}.json`), body);
  }
}

export async function runSkillCarry(binary: string, options: SkillCarryOptions): Promise<CarryRun> {
  const tag = randomUUID().slice(0, 8);
  const marker = `OVRDROID-CARRY-BODY-${tag}`;
  const turns = CARRY_STEPS.map(({ step, after }, index) => ({
    step,
    after,
    word: `carry-${index + 1}-${tag}`,
  }));
  const stub = startCarryStub(tag);
  try {
    return await withLiveDir('skill-carry', async (dir) => {
      const cwd = path.join(dir, 'work');
      const skillDir = path.join(cwd, '.factory', 'skills', SKILL_NAME);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(path.join(skillDir, 'SKILL.md'), skillFile(marker));
      const folder = sessionFolder(cwd);
      try {
        await driveCarry(
          {
            binary,
            cwd,
            dir,
            url: stub.url,
            folder,
            tag,
            timeoutMs: options.timeout * MS_PER_SECOND,
          },
          turns,
        );
      } finally {
        rmSync(folder, { recursive: true, force: true });
        if (options.out !== undefined) {
          saveBodies(options.out, stub.bodies);
        }
      }
      return { skill: SKILL_NAME, marker, turns, bodies: [...stub.bodies] };
    });
  } finally {
    await stub.stop();
  }
}
