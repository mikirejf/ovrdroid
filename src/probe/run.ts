import { race } from './launch.ts';

export interface RunSpawnOptions {
  quiet?: boolean;
  timeoutMs?: number;
}

export async function stdoutOf(argv: string[], options: RunSpawnOptions = {}): Promise<string> {
  const child = Bun.spawn(argv, options.quiet === true ? { stderr: 'ignore' } : {});
  const read = new Response(child.stdout).text();
  try {
    return options.timeoutMs === undefined
      ? await read
      : await race(read, options.timeoutMs, `${argv[0] ?? 'command'} hung, gave up waiting`);
  } finally {
    child.kill();
  }
}
