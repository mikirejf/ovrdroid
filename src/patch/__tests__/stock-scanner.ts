import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp, readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import type { Patch } from '../patches.ts';
import { findMarker } from '../patches.ts';
import { rebaseAll } from '../rebase.ts';
import { closureOf } from './module-closure.ts';
import { rebasedNamed as rebasedIn } from './payload.ts';

export interface Finding {
  ruleId: string;
  start: number;
  end: number;
  blocking: boolean;
  guessing: boolean;
}

export type LineMatcher = (line: string) => Finding[];

async function stockApp(target: string): Promise<App | undefined> {
  let app: App;
  try {
    app = readApp(await Bun.file(target).bytes());
  } catch {
    return undefined;
  }
  return findMarker(app[0].text) === undefined ? app : undefined;
}

export const stockDroid =
  (await stockApp(INSTALLED_DROID)) ?? (await stockApp(backupPath(INSTALLED_DROID)));

export function requireStock(): App {
  if (stockDroid === undefined) {
    throw new Error('no stock Droid to read');
  }
  return stockDroid;
}

export const stockText = stockDroid === undefined ? '' : joinApp(stockDroid);

export function shipped(patches: readonly Patch[]) {
  const rebased = rebaseAll(
    patches,
    (stockDroid ?? []).map((module) => module.text),
  );
  return {
    patchedText: stockDroid === undefined ? '' : joinApp(patchSource(stockDroid, patches)),
    rebasedNamed: (name: string) => rebasedIn(rebased, name),
  };
}

const SCANNER_ANCHOR = '"(?<name>(?<!\\\\w)(?=\\\\w*?(?:key|token|secret|pass"';

const LINE_MATCHER =
  /function (?<name>[\w$]+)\(\w+\)\{let \w+=\w+\.replace\(\w+,\(\w+\)=>" "\.repeat\(/u;

export function scannerText(app: App): string {
  const module = app.find((candidate) => candidate.text.includes(SCANNER_ANCHOR));
  if (module === undefined) {
    throw new Error('no module carries the secret-scanner rules');
  }
  return module.text;
}

export function lineMatcherIn(app: App): LineMatcher {
  const text = scannerText(app);
  const name = LINE_MATCHER.exec(text.slice(text.indexOf(SCANNER_ANCHOR)))?.groups?.['name'];
  if (name === undefined) {
    throw new Error('the secret-scanner line matcher is not where the tests expect it');
  }
  // SAFETY: the body is the shipped line matcher with the top-level declarations it reaches.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(`${closureOf(text, [name])};return ${name}`)() as LineMatcher;
}
