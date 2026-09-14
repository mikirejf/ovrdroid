import path from 'node:path';

export async function fetchArchive(url: string, into: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`downloading ${url} failed: ${response.status} ${response.statusText}`);
  }

  const archive = path.join(into, path.basename(new URL(url).pathname));
  await Bun.write(archive, response);
  return archive;
}

export async function extract(argv: string[]): Promise<void> {
  const child = Bun.spawn(argv, { stderr: 'pipe' });
  const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (child.exitCode !== 0) {
    throw new Error(`${argv[0] ?? 'extract'} failed: ${stderr.trim()}`);
  }
}
