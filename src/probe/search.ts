import type { App, AppModule } from '../binary/graph.ts';
import { embedName } from '../binary/graph.ts';

export interface Place {
  module: string;
  at: number;
  context: string;
}

export interface Search {
  needle: string;
  places: Place[];
}

export type Origin =
  | { kind: 'import'; name: string; from: string; exported: string }
  | { kind: 'define'; name: string; at: number; context: string }
  | { kind: 'absent'; name: string };

const IMPORT = /import\{(?<names>[^}]*)\}from"(?<from>[^"]+)"/gu;

const WHOLE_IMPORT = /import(?:\*as | )(?<local>[\w$]+) ?from"(?<from>[^"]+)"/gu;

const ESCAPE = /[.*+?^${}()|[\]\\]/gu;

function definitionPattern(name: string): RegExp {
  const escaped = name.replace(ESCAPE, '\\$&');
  return new RegExp(
    String.raw`(?:(?:function|class|var|let|const) ${escaped}[\s({=]|[,;{}] ?${escaped}=)`,
    'gu',
  );
}

export interface Window {
  at: number;
  length: number;
  span: number;
}

export function contextAt(text: string, window: Window): string {
  const { at, length, span } = window;
  return JSON.stringify(text.slice(Math.max(0, at - span), at + length + span));
}

export function findPlaces(app: App, needle: string, span: number): Search {
  const places: Place[] = [];

  for (const module of app) {
    for (
      let at = module.text.indexOf(needle);
      at !== -1;
      at = module.text.indexOf(needle, at + Math.max(needle.length, 1))
    ) {
      places.push({
        module: embedName(module.name),
        at,
        context: contextAt(module.text, { at, length: needle.length, span }),
      });
    }
  }

  return { needle, places };
}

export function moduleHolding(app: App, needle: string): AppModule | undefined {
  return app.find((module) => module.text.includes(needle));
}

function importedAs(module: AppModule, name: string): Origin | undefined {
  for (const match of module.text.matchAll(IMPORT)) {
    for (const entry of (match.groups?.['names'] ?? '').split(',')) {
      const [exported = '', local = exported] = entry.trim().split(' as ');
      if (local.trim() === name) {
        return {
          kind: 'import',
          name,
          from: embedName(match.groups?.['from'] ?? ''),
          exported: exported.trim(),
        };
      }
    }
  }
  for (const match of module.text.matchAll(WHOLE_IMPORT)) {
    if (match.groups?.['local'] === name) {
      return {
        kind: 'import',
        name,
        from: embedName(match.groups['from'] ?? ''),
        exported: name,
      };
    }
  }
  return undefined;
}

function definedAt(module: AppModule, name: string, span: number): Origin | undefined {
  const match = definitionPattern(name).exec(module.text);
  if (match === null) {
    return undefined;
  }
  return {
    kind: 'define',
    name,
    at: match.index,
    context: contextAt(module.text, { at: match.index, length: match[0].length, span }),
  };
}

export function resolveName(module: AppModule, name: string, span: number): Origin {
  return importedAs(module, name) ?? definedAt(module, name, span) ?? { kind: 'absent', name };
}

export function describeSearch(search: Search): string {
  const { needle, places } = search;
  const [only] = places;

  if (only === undefined) {
    return `no place carries ${JSON.stringify(needle)}: it cannot anchor a patch`;
  }
  if (places.length === 1) {
    return `1 place, in ${only.module}: unique, so it can anchor a patch`;
  }
  const modules = new Set(places.map((place) => place.module));
  return `${places.length} places across ${modules.size} modules: too many to anchor a patch, widen it`;
}

export function formatPlaces(search: Search): string {
  return search.places
    .map((place) => `${place.module} @${place.at}\n${place.context}`)
    .join('\n\n');
}

export function describeOrigin(origin: Origin): string {
  if (origin.kind === 'import') {
    const alias = origin.exported === origin.name ? '' : ` (exported as ${origin.exported})`;
    return `${origin.name}  imported from ${origin.from}${alias}`;
  }
  if (origin.kind === 'define') {
    return `${origin.name}  defined in this module @${origin.at}\n${origin.context}`;
  }
  return `${origin.name}  neither imported nor defined here: it is free, and the patch will crash`;
}
