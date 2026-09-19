import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function jsonlAppender(file: string) {
  let ready: Promise<unknown> | undefined;
  return async (entry: unknown): Promise<void> => {
    ready ??= mkdir(path.dirname(file), { recursive: true });
    await ready;
    await appendFile(file, `${JSON.stringify(entry)}\n`);
  };
}
