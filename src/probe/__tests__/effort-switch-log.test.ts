import { expect, test } from 'bun:test';
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isolatedTurnLog } from '../effort-switch-turn.ts';
import { withLiveDir } from '../live-session.ts';

function usage(second: string, cacheReadInputTokens: number): string {
  const context = { tags: { sessionId: 'probe-session' }, cacheReadInputTokens };
  return `[2026-11-20T08:12:${second}.000Z] INFO: [Agent] Streaming result | Context: ${JSON.stringify(context)}\n`;
}

test('all three usage lines stay visible when the shared log rotates', async () => {
  await withLiveDir('effort-switch-log-test', async (dir) => {
    const sharedDir = path.join(dir, 'shared');
    await mkdir(sharedDir);
    const shared = isolatedTurnLog(sharedDir);
    const run = isolatedTurnLog(dir);
    expect(run.read('probe-session').usage).toEqual([]);
    const prefix = usage('01', 100) + usage('02', 200);
    await writeFile(run.env.FACTORY_LOG_FILE, prefix);
    await writeFile(shared.env.FACTORY_LOG_FILE, prefix);

    expect(run.read('probe-session').usage).toHaveLength(2);
    await rename(shared.env.FACTORY_LOG_FILE, `${shared.env.FACTORY_LOG_FILE}.2026-11-20`);
    await writeFile(shared.env.FACTORY_LOG_FILE, usage('03', 999));
    await appendFile(run.env.FACTORY_LOG_FILE, usage('03', 300));

    expect(run.read('probe-session').usage.map((line) => line.cacheReadInputTokens)).toEqual([
      100, 200, 300,
    ]);
  });
});
