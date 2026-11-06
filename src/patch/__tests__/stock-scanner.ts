import { patchSource } from '../../binary/apply.ts';
import type { App, AppModule } from '../../binary/graph.ts';
import { embedName, joinApp, readApp } from '../../binary/graph.ts';
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
  /function (?<name>[\w$]+)\((?<input>[\w$]+)\)\{let [\w$]+=\k<input>\.includes\(";base64,"\)\?\k<input>\.replace\(/u;

function scannerModule(app: App): AppModule {
  const module = app.find((candidate) => candidate.text.includes(SCANNER_ANCHOR));
  if (module === undefined) {
    throw new Error('no module carries the secret-scanner rules');
  }
  return module;
}

export function scannerText(app: App): string {
  return scannerModule(app).text;
}

const IMPORT = /import\{(?<names>[^}]*)\}from"(?<from>[^"]+)"/gu;

function importsOf(text: string): Map<string, { from: string; name: string }> {
  return new Map(
    [...text.matchAll(IMPORT)].flatMap((match) =>
      (match.groups?.['names'] ?? '')
        .split(',')
        .map((part): [string, { from: string; name: string }] => {
          const [name = '', local = name] = part.split(' as ');
          return [local, { from: match.groups?.['from'] ?? '', name }];
        }),
    ),
  );
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name.replaceAll('$', '\\$')}(?![\\w$])`, 'u').test(text);
}

function closureAcross(app: App, module: AppModule, roots: readonly string[]): string {
  const own = closureOf(module.text, roots);
  const byModule = new Map<AppModule, [string, string][]>();
  for (const [local, { from, name }] of importsOf(module.text)) {
    if (!mentions(own, local)) {
      continue;
    }
    const source = app.find((candidate) => embedName(candidate.name) === embedName(from));
    if (source === undefined) {
      throw new Error(`${local} is imported from ${from}, which is not in the app`);
    }
    byModule.set(source, [...(byModule.get(source) ?? []), [name, local]]);
  }
  const imported = [...byModule].map(([source, bindings]) => {
    const names = bindings.map(([name]) => name);
    const pattern = bindings.map(([name, local]) => `${name}:${local}`).join(',');
    return `var{${pattern}}=(()=>{${closureAcross(app, source, names)};return{${names.join(',')}}})()`;
  });
  return [...imported, own].join(';\n');
}

export function lineMatcherIn(app: App): LineMatcher {
  const module = scannerModule(app);
  const { text } = module;
  const name = LINE_MATCHER.exec(text.slice(text.indexOf(SCANNER_ANCHOR)))?.groups?.['name'];
  if (name === undefined) {
    throw new Error('the secret-scanner line matcher is not where the tests expect it');
  }
  const source = closureAcross(app, module, [name]);
  // SAFETY: the body is the shipped line matcher with the top-level declarations it reaches, across the modules it imports from.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(`${source};return ${name}`)() as LineMatcher;
}
