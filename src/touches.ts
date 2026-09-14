import { statSync } from 'node:fs';

const FIELDS = [
  'mode',
  'owner',
  'size',
  'links',
  'inode',
  'modifiedAt',
  'metadataChangedAt',
  'content',
] as const;

type Field = (typeof FIELDS)[number];

export type Facts = Readonly<Record<Field, string>>;

export interface Reading {
  changes: readonly string[];
  verdict: string;
}

export interface Touch extends Reading {
  file: string;
}

const ABSENT = 'absent before and after';
const CREATED = 'created by the run';
const DELETED = 'deleted by the run';
const UNTOUCHED = 'untouched';
const REWRITTEN = 'rewritten: the bytes changed';
const METADATA_ONLY =
  'touched but byte-identical: a no-op permission or timestamp write, which still fires a change event for every watcher';
const UNREADABLE_VERDICT =
  'unreadable: the file is there but its bytes could not be read, so a rewrite cannot be told from a touch';

export const UNREADABLE = 'unreadable';

export function readingOf(before: Facts | undefined, after: Facts | undefined): Reading {
  if (before?.content === UNREADABLE || after?.content === UNREADABLE) {
    return { changes: [], verdict: UNREADABLE_VERDICT };
  }
  if (before === undefined && after === undefined) {
    return { changes: [], verdict: ABSENT };
  }
  if (before === undefined) {
    return { changes: [], verdict: CREATED };
  }
  if (after === undefined) {
    return { changes: [], verdict: DELETED };
  }

  const changes = FIELDS.filter((field) => before[field] !== after[field]);
  if (changes.length === 0) {
    return { changes, verdict: UNTOUCHED };
  }
  return { changes, verdict: changes.includes('content') ? REWRITTEN : METADATA_ONLY };
}

async function contentOf(file: string): Promise<string> {
  try {
    return Bun.hash(await Bun.file(file).arrayBuffer()).toString();
  } catch {
    return UNREADABLE;
  }
}

export async function factsOf(file: string): Promise<Facts | undefined> {
  let stat;
  try {
    stat = statSync(file, { bigint: true });
  } catch {
    return undefined;
  }

  return {
    // oxlint-disable-next-line no-bitwise
    mode: (stat.mode & 0o7777n).toString(8),
    owner: `${stat.uid}:${stat.gid}`,
    size: stat.size.toString(),
    links: stat.nlink.toString(),
    inode: stat.ino.toString(),
    modifiedAt: stat.mtimeNs.toString(),
    metadataChangedAt: stat.ctimeNs.toString(),
    content: await contentOf(file),
  };
}

async function snapshot(files: readonly string[]): Promise<Map<string, Facts | undefined>> {
  const entries = await Promise.all(
    files.map(async (file) => [file, await factsOf(file)] as const),
  );
  return new Map(entries);
}

export async function touchesDuring(
  files: readonly string[],
  action: () => Promise<void>,
): Promise<readonly Touch[]> {
  const before = await snapshot(files);
  await action();
  const after = await snapshot(files);

  return files.map((file) => ({ file, ...readingOf(before.get(file), after.get(file)) }));
}
