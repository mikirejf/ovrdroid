import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { RunOptions } from '../cli.ts';
import { messageOf, say } from '../cli.ts';
import { interleave } from './ab.ts';
import type { SessionUsage } from './cachekey.ts';
import { CACHEKEY_DIR, cachekeyArgv, formatCachekey, parseUsage, verdict } from './cachekey.ts';
import { checkRun, MODEL_VARIABLE, measureExec, requireModel } from './exec.ts';
import { sayPaired } from './paired.ts';

export const DEFAULT_CACHEKEY_DIR = path.join(tmpdir(), CACHEKEY_DIR);

export interface CachekeyOptions extends RunOptions {
  model: string | undefined;
  cwd: string;
}

async function session(binary: string, argv: readonly string[]): Promise<SessionUsage> {
  const run = await measureExec(binary, argv).catch((error: unknown) => {
    throw new Error(`${binary}: ${messageOf(error)}`);
  });
  const problem = checkRun(run, { exitCode: 0, contains: '"type":"result"' });
  if (problem !== undefined) {
    throw new Error(`${binary}: ${problem}`);
  }
  return parseUsage(run.stdout);
}

export async function cachekey(binaries: string[], options: CachekeyOptions): Promise<void> {
  const model = requireModel(options.model);
  mkdirSync(options.cwd, { recursive: true });
  const argv = cachekeyArgv(model, options.cwd);

  const results = await interleave(
    binaries,
    async (binary) => {
      await session(binary, argv);
      return await session(binary, argv);
    },
    options.runs,
  );

  say(`workload: two fresh exec sessions back to back on ${model}, in ${options.cwd}`);
  say('the first writes the prompt cache; only the second is measured');
  say('share: cache read / (input + cache read), since Droid reports input tokens as uncached');
  say(`model comes from ${MODEL_VARIABLE} in .env unless --model overrides it`);
  say('');

  for (const [index, [binary, sessions]] of results.entries()) {
    say(binary);
    say(formatCachekey(sessions));
    say(`  ${verdict(sessions)}`);
    if (index < results.length - 1) {
      say('');
    }
  }

  sayPaired(
    results.map(([binary, sessions]) => [binary, sessions.map((usage) => usage.ttftMs)] as const),
    'time to first token',
  );
}
