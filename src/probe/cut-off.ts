import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { say } from '../cli.ts';
import { cutOffVerdict, describeRequests, readCutOff } from './cut-off-report.ts';
import { describeVerdict } from './escape-report.ts';
import { poll } from './poll.ts';
import { ENTER, openSettledSession } from './session.ts';
import type { Session } from './session.ts';
import type { ReplyPlan } from './stub-model.ts';
import { startStubModel, STUB_END, stubSettings } from './stub-model.ts';

const PLAN: ReplyPlan = { chars: 600, chunk: 40, gapMs: 50 };
const DELTAS_BEFORE_CUT = 3;
const PROMPT = 'Explain the pipeline.';
const PASTE_QUIET_MS = 300;
const PASTE_TIMEOUT_MS = 3000;
const RETRY_TIMEOUT_MS = 60_000;
const QUIET_MS = 1500;
const QUIET_TIMEOUT_MS = 10_000;

function screens(session: Session): string[] {
  return session.frames().map((frame) => frame.text);
}

async function askOnce(session: Session): Promise<string[]> {
  session.paste(PROMPT);
  await session.quiet(PASTE_QUIET_MS, PASTE_TIMEOUT_MS);
  session.mark();
  await session.type(ENTER);
  const finished = (): true | undefined =>
    screens(session).some((screen) => screen.includes(STUB_END)) ? true : undefined;
  await poll(finished, RETRY_TIMEOUT_MS);
  await session.quiet(QUIET_MS, QUIET_TIMEOUT_MS);
  return screens(session);
}

export async function cutOff(binary: string): Promise<void> {
  say(
    `a stub model streams ${DELTAS_BEFORE_CUT} pieces of a reply and then ends the stream with no message_stop; later requests get the whole reply`,
  );
  const stub = startStubModel(PLAN, undefined, { cutFirstReplyAfter: DELTAS_BEFORE_CUT });
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-cut-off-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(stubSettings(stub.url)));
  try {
    const { session } = await openSettledSession(binary, {
      env: { FACTORY_RUNTIME_SETTINGS_PATH: file },
    });
    try {
      const reading = readCutOff(stub.served(), await askOnce(session));
      say(describeRequests(reading.served));
      const verdict = cutOffVerdict(reading);
      say(describeVerdict(verdict));
      if (!verdict.pass) {
        process.exitCode = 1;
      }
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
