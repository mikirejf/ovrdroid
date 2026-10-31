import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { say } from '../cli.ts';
import { anyFailed, describeVerdicts } from './busy-signal-report.ts';
import { COPY_SELECT_PROMPT, COPY_SELECT_REPLY, DRAFT_LINES } from './copy-select-reply.ts';
import type { CopySelectEvidence } from './copy-select-report.ts';
import { copySelectVerdicts } from './copy-select-report.ts';
import { race } from './launch.ts';
import { serveReply } from './reply-server.ts';
import { ENTER, openSession, SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import { stubSettings } from './stub-model.ts';

const COLS = 80;
const ROWS = 60;
const CHUNK_CHARS = 12;
const CHUNK_GAP_MS = 40;
const PASTE_SETTLE_MS = 300;
const QUIET_MS = 1500;
const REPLY_TIMEOUT_MS = 30_000;

export async function captureCopySelect(binary: string): Promise<CopySelectEvidence> {
  const server = serveReply(COPY_SELECT_REPLY, CHUNK_CHARS, CHUNK_GAP_MS);
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-copy-select-'));
  const settings = path.join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify(stubSettings(server.url)));
  try {
    const session = await openSession(binary, {
      env: { FACTORY_RUNTIME_SETTINGS_PATH: settings },
      collect: false,
      screen: true,
    });
    try {
      session.resize(COLS, ROWS);
      await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
      session.paste(COPY_SELECT_PROMPT);
      await Bun.sleep(PASTE_SETTLE_MS);
      await session.type(ENTER);
      await race(server.streamed(), REPLY_TIMEOUT_MS, 'Droid never asked the stub model');
      await session.quiet(QUIET_MS, REPLY_TIMEOUT_MS);
      const reply = session.screen();
      session.paste(DRAFT_LINES.join('\n'));
      await Bun.sleep(PASTE_SETTLE_MS);
      await session.quiet(QUIET_MS, REPLY_TIMEOUT_MS);
      return { reply, draft: session.screen() };
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function copySelect(binary: string): Promise<void> {
  say(
    `a stub model replies with a quote that wraps, holds a nested list and a nested quote, and a quote inside a list item, in a terminal ${COLS} columns wide; then a ${DRAFT_LINES.length}-line draft is pasted into the input box`,
  );
  const verdicts = copySelectVerdicts(await captureCopySelect(binary));
  say(describeVerdicts(verdicts));
  if (anyFailed(verdicts)) {
    process.exitCode = 1;
  }
}
