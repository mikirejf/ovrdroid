import fs from 'node:fs';

import type { Picker, Tree } from './session-mention-harness.ts';
import { pickerReading } from './session-mention-harness.ts';

export const HOME = '/home/me';
export const DIR = null;

export type Entries = Readonly<Record<string, string | null>>;

export interface Disk {
  tree: Tree;
  calls: () => number;
}

export function disk(entries: Entries): Disk {
  const folders = new Set(
    Object.keys(entries).flatMap((entry) => {
      const parts = entry.split('/').slice(1);
      return parts.map((_part, index) => `/${parts.slice(0, index).join('/')}`);
    }),
  );
  for (const [entry, content] of Object.entries(entries)) {
    if (content === DIR) {
      folders.add(entry);
    }
  }
  let calls = 0;
  return {
    calls: () => calls,
    tree: {
      statSync: (target) => {
        calls += 1;
        return folders.has(target) || target in entries
          ? { isDirectory: () => folders.has(target) }
          : undefined;
      },
      readFileSync: (target) => {
        calls += 1;
        const content = entries[target];
        if (typeof content !== 'string') {
          throw new TypeError(`no file at ${target}`);
        }
        return content;
      },
    },
  };
}

export function repoPicker(entries: Entries): Picker & { calls: () => number } {
  const { tree, calls } = disk(entries);
  return Object.assign(pickerReading(fs, tree, HOME), { calls });
}
