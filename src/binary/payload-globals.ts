import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

import type { App } from './graph.ts';

const PAYLOAD_PREFIX = '$OD';

interface ModuleNames {
  declared: Set<string>;
  reads: Set<string>;
  published: Set<string>;
}

function publishedName(node: t.AssignmentExpression): string | undefined {
  const { left } = node;
  if (
    t.isMemberExpression(left) &&
    !left.computed &&
    t.isIdentifier(left.object, { name: 'globalThis' }) &&
    t.isIdentifier(left.property)
  ) {
    return left.property.name;
  }
  return undefined;
}

function scan(text: string): ModuleNames {
  const names: ModuleNames = { declared: new Set(), reads: new Set(), published: new Set() };
  traverse(parse(text, { sourceType: 'module' }), {
    noScope: true,
    Identifier(path) {
      const { name } = path.node;
      if (!name.startsWith(PAYLOAD_PREFIX)) {
        return;
      }
      if (path.isBindingIdentifier()) {
        names.declared.add(name);
      }
      if (path.isReferencedIdentifier()) {
        names.reads.add(name);
      }
    },
    AssignmentExpression(path) {
      const name = publishedName(path.node);
      if (name !== undefined) {
        names.published.add(name);
      }
    },
  });
  return names;
}

export function assertPayloadNamesBound(app: App): void {
  const scanned = app
    .filter((module) => module.text.includes(PAYLOAD_PREFIX))
    .map((module) => ({ module, names: scan(module.text) }));
  const published = new Set(scanned.flatMap(({ names }) => [...names.published]));

  const problems: string[] = [];
  for (const { module, names } of scanned) {
    for (const name of names.reads) {
      if (!names.declared.has(name) && !published.has(name)) {
        problems.push(
          `patch code reads ${name} in ${module.name}, but that module never declares it and no module publishes globalThis.${name}: a helper declared in one module is invisible from another, so declare it in the module that calls it or publish it with globalThis.${name}=`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}
