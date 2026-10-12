import { readFileSync } from 'node:fs';
import path from 'node:path';

import { format } from 'oxfmt';

import { embedName, ENTRY_FILE, readApp } from '../binary/graph.ts';
import { say } from '../cli.ts';
import { checkReadable } from './readable-check.ts';
import { outputName } from './readable-model.ts';
import { describeProblems, describeReadable, makeReadable } from './readable.ts';
import type { Failure, Readable } from './readable.ts';

export interface ReadableOptions {
  out: string;
}

interface Formatted {
  name: string;
  code: string;
  failure: string | undefined;
}

async function formatted(name: string, code: string): Promise<Formatted> {
  const result = await format(name, code, {});
  const [first] = result.errors;
  return first === undefined
    ? { name, code: result.code, failure: undefined }
    : { name, code, failure: first.message };
}

async function formatAll(
  modules: ReadonlyMap<string, string>,
  failures: Failure[],
): Promise<Map<string, string>> {
  const done = await Promise.all(
    [...modules].map(async ([name, code]) => await formatted(name, code)),
  );
  for (const { name, failure } of done) {
    if (failure !== undefined) {
      failures.push({ module: name, what: `format: ${failure}` });
    }
  }
  return new Map(done.map((entry) => [entry.name, entry.code]));
}

async function write(
  out: string,
  files: ReadonlyMap<string, string>,
  result: Readable,
): Promise<void> {
  const renames = Object.fromEntries(result.renames);
  await Promise.all([
    Bun.write(path.join(out, 'renames.json'), `${JSON.stringify(renames, null, 2)}\n`),
    ...[...files].map(async ([name, code]) => await Bun.write(path.join(out, name), code)),
  ]);
}

export async function readable(binary: string, options: ReadableOptions): Promise<void> {
  const app = readApp(readFileSync(binary));
  const sources = app.map((module, index) => ({
    name: index === 0 ? ENTRY_FILE : embedName(module.name),
    text: module.text,
  }));

  const result = makeReadable(sources);
  const files = await formatAll(result.modules, result.failures);
  await write(options.out, files, result);

  const known = new Set(sources.map((source) => source.name));
  const failures = [...result.failures];
  const failed = new Set(failures.map((failure) => failure.module));
  for (const { name, text } of sources) {
    const output = files.get(outputName(name)) ?? '';
    for (const what of failed.has(name) ? [] : checkReadable(text, output, known)) {
      failures.push({ module: name, what });
    }
  }

  say(describeReadable(result, options.out).join('\n'));
  if (failures.length > 0) {
    throw new Error(describeProblems(failures, sources.length).join('\n'));
  }
}
