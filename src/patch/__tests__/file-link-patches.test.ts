import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { patchSource } from '../../binary/apply.ts';
import {
  fileLinkPatches,
  IMAGE_LINK_DIRECTIVE,
  STOCK_IMAGE_DIRECTIVE,
} from '../file-link-patches.ts';
import { patches } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { describeStrayNames, payloadFunction, rebasedNamed } from './payload.ts';

const SLOW_PATCH_MS = 120_000;
const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

const rebases = rebaseAll(
  fileLinkPatches,
  (STOCK ?? []).map((module) => module.text),
);

function rebased(): Rebase {
  const found = rebases.find((rebase) => rebase.name === 'markdown-file-links');
  if (found === undefined) {
    throw new Error('markdown-file-links is missing from the file link patches');
  }
  return found;
}

describeStrayNames(fileLinkPatches);

describe.skipIf(STOCK === undefined)(
  'markdown-file-links applies to the shipped bundle once',
  () => {
    test.each(fileLinkPatches.map(({ name }) => name))('%s matches once', (name) => {
      const rebase = rebasedNamed(rebases, name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test('the template expression produces only the chat link directive at runtime', () => {
      const rebase = rebasedNamed(rebases, 'chat-image-file-links');
      const prompt = payloadFunction<[], string>([], `return \`before ${rebase.replace} after\``)();
      expect(prompt).toBe(`before ${IMAGE_LINK_DIRECTIVE} after`);
      expect(prompt).toContain('Save generated images inside the workspace.');
      expect(prompt).not.toContain('Save screenshots');
    });

    test(
      'it ships and applies on top of every other shipped patch',
      () => {
        for (const { name } of fileLinkPatches) {
          expect(patches.filter((patch) => patch.name === name)).toHaveLength(1);
        }
        const original = sourceApp()
          .map((module) => module.text)
          .join('\n');
        expect(original.split(STOCK_IMAGE_DIRECTIVE)).toHaveLength(2);
        expect(original).not.toContain(IMAGE_LINK_DIRECTIVE);
        const shipped = patchSource(sourceApp(), patches)
          .map((module) => module.text)
          .join('\n');
        expect(shipped.split(rebased().replace)).toHaveLength(2);
        expect(shipped.split(IMAGE_LINK_DIRECTIVE)).toHaveLength(2);
        expect(shipped).not.toContain(STOCK_IMAGE_DIRECTIVE);
      },
      SLOW_PATCH_MS,
    );
  },
);

type Sanitize = (value: unknown) => string | null;

function sanitizerFrom(replacement: boolean): Sanitize {
  const rebase = rebased();
  const { renames } = rebase;
  const named = (name: string): string => renames[name] ?? name;
  const holder = (STOCK ?? []).find((entry) => entry.text.includes(rebase.find));
  if (holder === undefined) {
    throw new Error('no module carries the URL sanitizer');
  }
  const text = replacement ? holder.text.replace(rebase.find, () => rebase.replace) : holder.text;
  const start = text.indexOf(`function ${named('Wd')}(`);
  const end = text.indexOf('}function ', start);
  if (start === -1 || end === -1) {
    throw new Error('the URL sanitizer is missing from the module');
  }
  const make = payloadFunction<[(value: string) => string, NodeJS.Require], Sanitize>(
    [named('p'), 'require'],
    `${text.slice(start, end + 1)}return ${named('Wd')}`,
  );
  return make((value) => value, createRequire(import.meta.url));
}

describe.skipIf(STOCK === undefined)('markdown-file-links', () => {
  const stock = sanitizerFrom(false);
  const patched = sanitizerFrom(true);
  const originalCwd = process.cwd();
  let dir = '';

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ovrdroid-links-')));
    mkdirSync(path.join(dir, 'notes'));
    writeFileSync(path.join(dir, 'notes', 'a.md'), 'a');
    writeFileSync(path.join(dir, 'a.md'), 'a');
    writeFileSync(path.join(dir, 'shot one#2.png'), 'a');
  });

  beforeEach(() => {
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('stock rejects an existing absolute file path', () => {
    expect(stock(path.join(dir, 'notes', 'a.md'))).toBeNull();
  });

  test('an existing absolute file becomes a file url', () => {
    expect(patched(path.join(dir, 'notes', 'a.md'))).toBe(`file://${dir}/notes/a.md`);
  });

  test('a missing absolute path behaves as in stock', () => {
    expect(stock(path.join(dir, 'missing.md'))).toBeNull();
    expect(patched(path.join(dir, 'missing.md'))).toBe(stock(path.join(dir, 'missing.md')));
  });

  test.each(['notes/a.md', './notes/a.md', 'notes/../notes/a.md'])(
    'the relative path %p resolves against the working folder',
    (value) => {
      expect(patched(value)).toBe(`file://${process.cwd()}/notes/a.md`);
    },
  );

  test('a missing relative path behaves as in stock', () => {
    expect(patched('notes/missing.md')).toBe(stock('notes/missing.md'));
    expect(patched('./missing.md')).toBe(stock('./missing.md'));
  });

  test.each(['notes/a.md:12', 'notes/a.md:12:3'])('the line suffix of %p is dropped', (value) => {
    expect(patched(value)).toBe(`file://${dir}/notes/a.md`);
  });

  test('a bare file name with a line suffix is a file, not a scheme', () => {
    expect(patched('a.md:12')).toBe(`file://${dir}/a.md`);
  });

  test('spaces and hash signs are percent-encoded', () => {
    expect(patched('shot one#2.png')).toBe(`file://${dir}/shot%20one%232.png`);
  });

  test('an existing folder becomes a file url', () => {
    expect(patched('notes')).toBe(`file://${dir}/notes`);
    expect(patched(dir)).toBe(pathToFileURL(dir).href);
  });

  test('a home path expands to the home directory', () => {
    expect(patched('~/')).toBe(pathToFileURL(homedir()).href);
  });

  test('a missing home path behaves as in stock', () => {
    const missing = `~/ovrdroid-missing-${crypto.randomUUID()}`;
    expect(patched(missing)).toBe(stock(missing));
  });

  test.each([
    'https://example.com/p',
    'file:///etc/hosts',
    '#section',
    'mailto:a@b.c',
    SCRIPT_URL,
    'example.com',
    '//host/p',
    '',
    '   ',
    42,
    undefined,
  ])('%p behaves as in stock', (value) => {
    expect(patched(value)).toBe(stock(value));
  });

  test('web and file links keep their form', () => {
    expect(patched('https://example.com/p')).toBe('https://example.com/p');
    expect(patched('file:///etc/hosts')).toBe('file:///etc/hosts');
  });
});
