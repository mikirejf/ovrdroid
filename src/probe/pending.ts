import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { Recorder } from './counter-file.ts';
import { endSpan, withRecorder } from './counter-file.ts';
import type { PendingPlan } from './pending-report.ts';
import {
  pendingCommand,
  pendingMissing,
  PENDING_TOOL,
  showsPendingTool,
  sleepSeconds,
} from './pending-report.ts';
import { ENTER, openSettledSession } from './session.ts';
import type { ReplyPlan } from './stub-model.ts';
import { startStubModel, stubSettings } from './stub-model.ts';

export const DEFAULT_PENDING: PendingPlan = { leadInMs: 2500, windowMs: 6000 };
const PLAN: ReplyPlan = { chars: 100, chunk: 50, gapMs: 20 };
const PROMPT = 'Run it.';
const PASTE_QUIET_MS = 300;
const PASTE_TIMEOUT_MS = 3000;
const SLEEP_MARGIN_MS = 5000;

export async function measurePending<R extends object>(
  binary: string,
  pending: PendingPlan,
  recorder: Recorder<R>,
): Promise<R> {
  const command = pendingCommand(sleepSeconds(pending, SLEEP_MARGIN_MS));
  const stub = startStubModel(PLAN, {
    name: PENDING_TOOL,
    input: { command, riskLevel: 'low', timeout: 60 },
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-pending-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(stubSettings(stub.url)));
  try {
    return await withRecorder(recorder, async (recorderEnv) => {
      const { session } = await openSettledSession(binary, {
        env: { FACTORY_RUNTIME_SETTINGS_PATH: file, ...recorderEnv },
      });
      try {
        session.paste(PROMPT);
        await session.quiet(PASTE_QUIET_MS, PASTE_TIMEOUT_MS);
        session.mark();
        await session.type(ENTER);
        await delay(pending.leadInMs);
        session.mark();
        const from = performance.now();
        await delay(pending.windowMs);
        const window = await endSpan(from);
        if (!showsPendingTool(session.frames(), command)) {
          throw new Error(pendingMissing(session.frames(), command));
        }
        return { reading: {}, spans: { pending: window } };
      } finally {
        await session.close();
      }
    });
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
