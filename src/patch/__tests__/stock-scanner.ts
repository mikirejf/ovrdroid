import type { App } from '../../binary/graph.ts';
import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { findMarker } from '../patches.ts';
import { scannerSource } from './scanner-source.ts';

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

const SCANNER_ANCHOR = '"(?<name>(?<!\\\\w)(?=\\\\w*?(?:key|token|secret|pass"';

const LINE_MATCHER =
  /function (?<name>[\w$]+)\(\w+\)\{let \w+=\w+\.replace\(\w+,\(\w+\)=>" "\.repeat\(/u;

const REDACTOR = /function [\w$]+\(\w+\)\{if\(!\w+\)return\{success:!0,value:\w+\};try\{/u;

export function scannerText(app: App): string {
  const module = app.find((candidate) => candidate.text.includes(SCANNER_ANCHOR));
  if (module === undefined) {
    throw new Error('no module carries the secret-scanner rules');
  }
  return module.text;
}

export function lineMatcherIn(app: App): LineMatcher {
  const text = scannerText(app);
  const rules = text.indexOf(SCANNER_ANCHOR);
  const name = LINE_MATCHER.exec(text.slice(rules))?.groups?.['name'];
  const end = text.slice(rules).search(REDACTOR);
  if (name === undefined || end === -1) {
    throw new Error('the secret-scanner line matcher is not where the tests expect it');
  }
  // SAFETY: the body is the shipped scanner, from its rule helpers up to the redactor that follows the line matcher.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(`${scannerSource(text, rules, end)};return ${name}`)() as LineMatcher;
}
