import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { count, guard, MS_PER_SECOND, say } from '../cli.ts';
import { INSTALLED_DROID } from '../paths.ts';
import type { DotenvReading } from './dotenv-leak-report.ts';
import { describeDotenvLeak, dotenvText, plantsFor, readDotenvLeak } from './dotenv-leak-report.ts';
import { withFixtureDir } from './mcp-fixture.ts';
import { poll } from './poll.ts';
import { stdoutOf } from './run.ts';
import { openSession } from './session.ts';
import type { Parented } from './tree.ts';
import { descendants, parseParents } from './tree.ts';

const DEFAULT_DUMP_TIMEOUT_S = 40;
const DUMP_FILE = 'env-dump.txt';
const SERVER_NAME = 'envdump';
const TOKEN_LENGTH = 8;
const DUMP_SCRIPT = 'env > "$1.part" && mv "$1.part" "$1"; exec cat > /dev/null';

function mcpConfig(dump: string) {
  return {
    mcpServers: {
      [SERVER_NAME]: { type: 'stdio', command: 'sh', args: ['-c', DUMP_SCRIPT, 'sh', dump] },
    },
  };
}

async function processTable(): Promise<Parented[]> {
  return parseParents(await stdoutOf(['ps', '-Ao', 'pid,ppid,command']));
}

async function treeOf(root: number): Promise<Parented[]> {
  const rows = await processTable();
  const wanted = new Set(descendants(rows, root));
  return rows.filter((row) => wanted.has(row.pid));
}

async function killSurvivors(tree: readonly Parented[]): Promise<void> {
  const alive = await processTable();
  for (const row of tree) {
    if (alive.some((other) => other.pid === row.pid && other.command === row.command)) {
      process.kill(row.pid, 'SIGKILL');
    }
  }
}

export async function runDotenvLeak(binary: string, timeoutS: number): Promise<DotenvReading> {
  return await withFixtureDir(async (dir) => {
    const plants = plantsFor(randomUUID().slice(0, TOKEN_LENGTH));
    for (const plant of plants) {
      writeFileSync(path.join(dir, plant.file), dotenvText(plant));
    }
    const dump = path.join(dir, DUMP_FILE);
    mkdirSync(path.join(dir, '.factory'));
    writeFileSync(path.join(dir, '.factory', 'mcp.json'), JSON.stringify(mcpConfig(dump)));

    const session = await openSession(binary, { cwd: dir, collect: false });
    let tree: Parented[] = [];
    try {
      const text = await poll(
        () => (existsSync(dump) ? readFileSync(dump, 'utf-8') : undefined),
        timeoutS * MS_PER_SECOND,
      );
      tree = await treeOf(session.pid);
      return readDotenvLeak(text, plants);
    } finally {
      await session.close();
      await killSurvivors(tree);
    }
  });
}

async function dotenvLeak(binary: string, options: { timeout: number }): Promise<void> {
  say(
    `launching ${binary} in a fresh directory holding .env and .env.local, with one stdio MCP server that dumps its environment`,
  );
  const reading = await runDotenvLeak(binary, options.timeout);
  say(describeDotenvLeak(reading));
  if (reading.outcome !== 'clean') {
    process.exitCode = 1;
  }
}

export function registerDotenvLeakCommand(program: Command): void {
  program
    .command('dotenv-leak')
    .description(
      "does this Droid binary leak its launch directory's .env files into the processes it spawns? Starts it, from a directory under the current one (which Droid must trust), in a directory holding .env and .env.local with unique markers and one stdio MCP server that dumps its environment; makes no model call",
    )
    .argument('[binary]', 'binary to launch', INSTALLED_DROID)
    .option(
      '--timeout <seconds>',
      'how long to wait for the MCP server to dump',
      count,
      DEFAULT_DUMP_TIMEOUT_S,
    )
    .action(guard(dotenvLeak));
}
