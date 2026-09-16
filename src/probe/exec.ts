import { summarise } from './ab.ts';
import { launchEnv, race } from './launch.ts';

export const DEFAULT_TIMEOUT_MS = 180_000;
const CLIP = 120;

export const STAGES = ['turn', 'help'] as const;

export type Stage = (typeof STAGES)[number];

export const MODEL_VARIABLE = 'OVRDROID_EXEC_MODEL';

export function defaultModel(
  env: Record<string, string | undefined> = Bun.env,
): string | undefined {
  const chosen = env[MODEL_VARIABLE]?.trim();
  return chosen === undefined || chosen === '' ? undefined : chosen;
}

export function requireModel(model: string | undefined): string {
  if (model === undefined) {
    throw new Error(
      `the turn stage needs a model: set ${MODEL_VARIABLE} in .env (see .env.example) or pass --model`,
    );
  }
  return model;
}

export interface ExecRun {
  firstMs: number;
  totalMs: number;
  tailMs: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface Expectation {
  exitCode: number;
  contains: string;
}

export interface Workload {
  argv: readonly string[];
  expect: Expectation;
  what: string;
  firstMeans: string;
}

export function turnWorkload(model: string, prompt: string, expect: string): Workload {
  return {
    argv: ['exec', '-m', model, prompt],
    expect: { exitCode: 0, contains: expect },
    what: `a real one-shot turn on ${model}`,
    firstMeans: 'the first byte of the answer, so it carries the model\u2019s own thinking time',
  };
}

export function helpWorkload(): Workload {
  return {
    argv: ['exec', '--help'],
    expect: { exitCode: 0, contains: 'Usage: droid exec' },
    what: 'exec startup and shutdown only, with no session, no login and no model',
    firstMeans: 'the first byte of the help text, so it is startup alone',
  };
}

export interface TurnSpec {
  model: string | undefined;
  prompt: string;
  expect: string;
}

export function workloadFor(stage: Stage, turn: TurnSpec): Workload {
  return stage === 'help'
    ? helpWorkload()
    : turnWorkload(requireModel(turn.model), turn.prompt, turn.expect);
}

function clip(text: string): string {
  const line = text.trim().split('\n').at(0) ?? '';
  return line.length > CLIP ? `${line.slice(0, CLIP)}\u2026` : line;
}

export function checkRun(run: ExecRun, expect: Expectation): string | undefined {
  if (run.signal !== null) {
    return `killed by ${run.signal}`;
  }
  if (run.exitCode !== expect.exitCode) {
    const said = clip(run.stderr) || clip(run.stdout) || 'no output at all';
    return `exit ${run.exitCode ?? 'none'}, wanted ${expect.exitCode}: ${said}`;
  }
  if (Number.isNaN(run.firstMs)) {
    return 'wrote nothing to stdout, so there is no first byte to time';
  }
  if (!run.stdout.includes(expect.contains)) {
    return `stdout never said ${JSON.stringify(expect.contains)}: ${clip(run.stdout)}`;
  }
  return undefined;
}

export async function measureExec(
  binary: string,
  argv: readonly string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExecRun> {
  const decoder = new TextDecoder();
  const startedAt = performance.now();
  const child = Bun.spawn([binary, ...argv], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: launchEnv(),
  });

  let firstMs = Number.NaN;
  let stdout = '';

  const readOut = (async () => {
    for await (const chunk of child.stdout) {
      if (Number.isNaN(firstMs)) {
        firstMs = performance.now() - startedAt;
      }
      stdout += decoder.decode(chunk, { stream: true });
    }
    stdout += decoder.decode();
  })();
  const readErr = new Response(child.stderr).text();

  try {
    await race(
      Promise.all([readOut, readErr, child.exited]),
      timeoutMs,
      `${binary} was still running ${timeoutMs}ms in`,
    );
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  const totalMs = performance.now() - startedAt;
  return {
    firstMs,
    totalMs,
    tailMs: Number.isNaN(firstMs) ? Number.NaN : totalMs - firstMs,
    exitCode: child.exitCode,
    signal: child.signalCode,
    stdout,
    stderr: await readErr,
  };
}

export function formatExec(runs: readonly ExecRun[]): string {
  return [
    `  first  ${summarise(runs.map((run) => run.firstMs))}`,
    `  tail   ${summarise(runs.map((run) => run.tailMs))}`,
    `  total  ${summarise(runs.map((run) => run.totalMs))}`,
  ].join('\n');
}
