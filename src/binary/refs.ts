import type { App } from './graph.ts';
import { EMBED_PREFIX, embedName } from './graph.ts';

const EMBED_REF = new RegExp(`"(?<path>${EMBED_PREFIX.replaceAll('$', '\\$')}[^"]+)"`, 'gu');
const RELATIVE_REQUIRE = /import\.meta\.require\("(?<path>\.\/[^"]+)"\)/gu;

function targetsOf(app: App, pattern: RegExp): Set<string> {
  const targets = new Set<string>();
  for (const module of app) {
    for (const match of module.text.matchAll(pattern)) {
      const target = match.groups?.['path'];
      if (target !== undefined) {
        targets.add(target);
      }
    }
  }
  return targets;
}

export function assertRefsResolve(app: App, embedded: ReadonlySet<string>): void {
  const unbundled = targetsOf(app, RELATIVE_REQUIRE);
  if (unbundled.size > 0) {
    throw new Error(
      `rebuilt app still requires files by relative path, which never resolve inside the binary: ${[...unbundled].join(', ')}`,
    );
  }

  const unresolved = [...targetsOf(app, EMBED_REF)].filter(
    (target) => !embedded.has(embedName(target)),
  );
  if (unresolved.length > 0) {
    throw new Error(
      `rebuilt app addresses embedded files the binary does not carry: ${unresolved.join(', ')}`,
    );
  }
}
