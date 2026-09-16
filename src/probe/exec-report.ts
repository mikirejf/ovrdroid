import type { RunOptions } from '../cli.ts';
import { messageOf, say } from '../cli.ts';
import { interleave } from './ab.ts';
import type { ExecRun, Stage } from './exec.ts';
import { checkRun, formatExec, MODEL_VARIABLE, measureExec, workloadFor } from './exec.ts';
import { sayPaired } from './paired.ts';

export { defaultModel, STAGES } from './exec.ts';

export interface ExecOptions extends RunOptions {
  stage: Stage;
  model: string | undefined;
  prompt: string;
  expect: string;
}

export async function exec(binaries: string[], options: ExecOptions): Promise<void> {
  const workload = workloadFor(options.stage, options);

  const results = await interleave(
    binaries,
    async (binary) => {
      const run = await measureExec(binary, workload.argv).catch((error: unknown) => {
        throw new Error(`${binary}: ${messageOf(error)}`);
      });
      const problem = checkRun(run, workload.expect);
      if (problem !== undefined) {
        throw new Error(`${binary}: ${problem}`);
      }
      return run;
    },
    options.runs,
  );

  say(`workload: ${workload.what}`);
  say(`first: ${workload.firstMeans}`);
  say('tail: what runs after the last byte of output, which is shutdown');
  say('every run had to exit 0 and print the expected text, or the probe stops');
  say(`model comes from ${MODEL_VARIABLE} in .env unless --model overrides it`);
  say('');

  for (const [index, [binary, runs]] of results.entries()) {
    say(binary);
    say(formatExec(runs));
    if (index < results.length - 1) {
      say('');
    }
  }

  const pick = (choose: (run: ExecRun) => number) =>
    results.map(([binary, runs]) => [binary, runs.map((run) => choose(run))] as const);

  sayPaired(
    pick((run) => run.firstMs),
    'first byte',
  );
  sayPaired(
    pick((run) => run.tailMs),
    'shutdown tail',
  );
  sayPaired(
    pick((run) => run.totalMs),
    'total',
  );
}
