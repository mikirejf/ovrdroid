import path from 'node:path';

import type { RunOptions } from '../cli.ts';
import { say, seconds } from '../cli.ts';
import { withTempDir } from '../temp.ts';
import type { LaunchResult } from './launch.ts';
import { launch } from './launch.ts';
import { formatModules, parseModules } from './modules.ts';
import { formatTrace, parseTrace, TRACE_HEADER } from './trace.ts';

const BODY_WIDTH = 110;

export interface ModulesOptions {
  top: number;
}

interface Capture {
  binary: string;
  variable: 'OD_TRACE' | 'OD_MODULES';
  filename: string;
  runs?: number;
}

interface Captured {
  text: string;
  timing: LaunchResult;
}

interface Repeat {
  binary: string;
  variable: string;
  file: string;
  total: number;
}

async function captureRuns(request: Repeat, remaining: number): Promise<LaunchResult> {
  await Bun.write(request.file, '');
  const timing = await launch(request.binary, { env: { [request.variable]: request.file } });
  if (remaining === 1) {
    return timing;
  }
  say(`run ${request.total - remaining + 1} of ${request.total}: paint ${seconds(timing.paintMs)}`);
  return await captureRuns(request, remaining - 1);
}

async function capture(request: Capture): Promise<Captured> {
  const total = request.runs ?? 1;
  return await withTempDir(request.variable.toLowerCase(), async (dir) => {
    const file = path.join(dir, request.filename);
    const timing = await captureRuns(
      { binary: request.binary, variable: request.variable, file, total },
      total,
    );
    const text = await Bun.file(file)
      .text()
      .catch(() => '');
    return { text, timing };
  });
}

export async function trace(binary: string, options: RunOptions): Promise<void> {
  const captured = await capture({
    binary,
    variable: 'OD_TRACE',
    filename: 'trace.tsv',
    runs: options.runs,
  });
  const rows = parseTrace(captured.text);
  if (rows.length === 0) {
    say('no trace rows: was the binary built with --trace?');
    return;
  }
  say(`paint ${seconds(captured.timing.paintMs)}`);
  say('');
  say(TRACE_HEADER);
  say(formatTrace(rows));
}

export async function modules(binary: string, options: ModulesOptions): Promise<void> {
  const captured = await capture({ binary, variable: 'OD_MODULES', filename: 'modules.tsv' });
  const report = parseModules(captured.text);
  if (report.moduleCount === 0) {
    say('no module rows: was the binary built with --modules?');
    return;
  }
  say(`paint ${seconds(captured.timing.paintMs)}`);
  say(
    `${report.totalMs.toFixed(1)}ms across ${report.moduleCount} modules (${report.unlabelledCount} unlabelled, ${report.unlabelledMs.toFixed(1)}ms)`,
  );
  say(formatModules(report.rows.slice(0, options.top), BODY_WIDTH));
}
