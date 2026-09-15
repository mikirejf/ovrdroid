import path from 'node:path';

import { stdoutOf } from './run.ts';

export interface Parented {
  pid: number;
  ppid: number;
  command: string;
}

const NAME_WIDTH = 64;

export function parseParents(text: string): Parented[] {
  const rows: Parented[] = [];

  for (const line of text.split('\n')) {
    const [pid = '', ppid = '', ...rest] = line.trim().split(/\s+/u);
    if (Number.isInteger(Number(pid)) && Number.isInteger(Number(ppid)) && pid !== '') {
      rows.push({ pid: Number(pid), ppid: Number(ppid), command: rest.join(' ') });
    }
  }

  return rows;
}

export function shortCommand(command: string): string {
  const [binary = '', ...args] = command.split(' ');
  return [path.basename(binary), ...args].join(' ').slice(0, NAME_WIDTH);
}

export function descendants(rows: readonly Parented[], root: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid);
    if (siblings === undefined) {
      children.set(row.ppid, [row.pid]);
    } else {
      siblings.push(row.pid);
    }
  }

  const found = new Set<number>([root]);
  const queue = [root];
  let current = queue.pop();

  while (current !== undefined) {
    for (const child of children.get(current) ?? []) {
      if (!found.has(child)) {
        found.add(child);
        queue.push(child);
      }
    }
    current = queue.pop();
  }

  return [...found];
}

export async function treeOf(root: number): Promise<Map<number, string>> {
  const listing = await stdoutOf(['ps', '-Ao', 'pid,ppid,command']);
  const rows = parseParents(listing);
  const wanted = new Set(descendants(rows, root));
  return new Map(
    rows
      .filter((row) => wanted.has(row.pid))
      .map((row) => [row.pid, shortCommand(row.command)] as const),
  );
}
