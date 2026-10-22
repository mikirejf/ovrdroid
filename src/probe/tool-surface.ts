import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { count, guard, MS_PER_SECOND, say } from '../cli.ts';
import { makeTempDir } from '../temp.ts';
import { parseBodies } from './bodies.ts';
import { openLiveSession, submit, withLiveDir } from './live-session.ts';
import { poll } from './poll.ts';
import { SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import { describeToolSurface, readToolSurface } from './tool-surface-report.ts';

const BODIES_VARIABLE = 'OD_BODIES';
const PROMPT = 'Reply with the single word "ok". Do not use any tool.';
const DEFAULT_MODEL = 'custom:droidproxy:sonnet-5-5';
const DEFAULT_EFFORT = 'low';
const DEFAULT_TOOL = 'TodoWrite';
const DEFAULT_TIMEOUT_S = 120;

export interface ToolSurfaceOptions {
  modelId: string;
  effort: string;
  tool: string;
  timeout: number;
  out?: string;
}

function readRows(file: string) {
  return parseBodies(existsSync(file) ? readFileSync(file, 'utf-8') : '');
}

export async function toolSurface(binary: string, options: ToolSurfaceOptions): Promise<void> {
  const out = path.resolve(options.out ?? path.join(makeTempDir('tool-surface'), 'bodies.jsonl'));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, '');
  say(
    `${options.modelId} at effort ${options.effort}: is ${options.tool} on its direct tool list?`,
  );

  await withLiveDir('tool-surface', async (dir) => {
    const cwd = path.join(dir, 'work');
    mkdirSync(cwd);
    const session = await openLiveSession(binary, {
      cwd,
      dir,
      model: options.modelId,
      effort: options.effort,
      env: { [BODIES_VARIABLE]: out },
    });
    try {
      await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
      await submit(session, PROMPT);
      await poll(
        () => readToolSurface(readRows(out), options.tool),
        options.timeout * MS_PER_SECOND,
      );
    } finally {
      await session.close();
    }
  });

  const surface = readToolSurface(readRows(out), options.tool);
  say(describeToolSurface(surface, options.tool));
  if (surface?.scriptOnly !== true || !surface.direct) {
    process.exitCode = 1;
  }
}

export function registerToolSurfaceCommand(program: Command): void {
  program
    .command('tool-surface')
    .description(
      'MAKES A REAL MODEL CALL: which tools does the model get as top-level tools in a script_only session, and is a given tool among them? Reads the request body of one turn. The binary must be a `probe build --bodies` build; a non-interactive `droid exec` never offers TodoWrite, so this drives the real TUI',
    )
    .argument('<binary>')
    .option(
      '--model-id <id>',
      'customModels id the session runs on; must run Script',
      DEFAULT_MODEL,
    )
    .option('--effort <level>', 'reasoning effort of the session', DEFAULT_EFFORT)
    .option('--tool <name>', 'tool that must be on the direct list', DEFAULT_TOOL)
    .option('-o, --out <file>', 'bodies file to write (default: a new /tmp file)')
    .option('--timeout <seconds>', 'how long to wait for the request', count, DEFAULT_TIMEOUT_S)
    .action(guard(toolSurface));
}
