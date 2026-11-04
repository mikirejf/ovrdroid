import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { makeTempDir } from '../../temp.ts';
import { sessionFilesUnder } from '../transcript-files.ts';

const dir = makeTempDir('session-files');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('lists only files directly inside session folders', () => {
  const root = path.join(dir, 'listing');
  const folder = path.join(root, 'project');
  mkdirSync(path.join(folder, 'nested'), { recursive: true });
  writeFileSync(path.join(root, 'index.json'), '{}');
  const transcript = path.join(folder, 'session.jsonl');
  const settings = path.join(folder, 'session.settings.json');
  writeFileSync(transcript, '');
  writeFileSync(settings, '{}');
  writeFileSync(path.join(folder, 'nested', 'ignored.jsonl'), '');
  expect([...sessionFilesUnder(root)].toSorted()).toEqual([transcript, settings].toSorted());
});

test('a concurrent probe can remove another session folder during a scan', () => {
  const root = path.join(dir, 'cleanup');
  const folders = ['one', 'two'].map((name) => path.join(root, name));
  for (const folder of folders) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'session.jsonl'), '');
  }
  const files = sessionFilesUnder(root);
  const first = files.next();
  if (first.done === true) {
    throw new Error('the scan found neither session folder');
  }
  for (const folder of folders) {
    if (folder !== path.dirname(first.value)) {
      rmSync(folder, { recursive: true });
    }
  }
  expect([...files]).toEqual([]);
});

test('a missing sessions directory has no files', () => {
  expect([...sessionFilesUnder(path.join(dir, 'missing'))]).toEqual([]);
});

test('an invalid sessions path still fails loudly', () => {
  const file = path.join(dir, 'not-a-directory');
  writeFileSync(file, '');
  expect(() => [...sessionFilesUnder(file)]).toThrow();
});
