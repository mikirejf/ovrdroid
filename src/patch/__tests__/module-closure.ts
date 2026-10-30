import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

interface Unit {
  start: number;
  text: string;
  declares: string[];
  uses: Set<string>;
}

function unitsOf(text: string, body: t.Statement[]): Unit[] {
  return body.flatMap((node): Unit[] => {
    const start = node.start ?? 0;
    const slice = (part: t.Node) => text.slice(part.start ?? 0, part.end ?? 0);
    if (t.isImportDeclaration(node) || t.isExportNamedDeclaration(node)) {
      return [];
    }
    if (t.isVariableDeclaration(node)) {
      return node.declarations.map((declarator) => ({
        start: declarator.start ?? start,
        text: `var ${slice(declarator)};`,
        declares: Object.keys(t.getBindingIdentifiers(declarator.id)),
        uses: new Set<string>(),
      }));
    }
    const declares =
      (t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) && node.id
        ? [node.id.name]
        : [];
    return [{ start, text: slice(node), declares, uses: new Set<string>() }];
  });
}

function unitAt(units: readonly Unit[], position: number): Unit | undefined {
  let low = 0;
  let high = units.length - 1;
  let found: Unit | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const unit = units[middle];
    if (unit !== undefined && unit.start <= position) {
      found = unit;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function analysed(text: string): Unit[] {
  const ast = parse(text, { sourceType: 'module' });
  const units = unitsOf(text, ast.program.body);
  traverse(ast, {
    Program(path) {
      for (const [name, binding] of Object.entries(path.scope.bindings)) {
        if (binding.kind === 'module') {
          continue;
        }
        for (const use of [...binding.referencePaths, ...binding.constantViolations]) {
          unitAt(units, use.node.start ?? 0)?.uses.add(name);
        }
      }
      path.stop();
    },
  });
  return units;
}

const cache = new Map<string, Unit[]>();

function unitsFor(text: string): Unit[] {
  const units = cache.get(text) ?? analysed(text);
  cache.set(text, units);
  return units;
}

export function closureOf(text: string, roots: readonly string[]): string {
  const units = unitsFor(text);
  const declaring = new Map(units.flatMap((unit) => unit.declares.map((name) => [name, unit])));
  for (const root of roots) {
    if (!declaring.has(root)) {
      throw new Error(`${root} is not declared at the top of the module`);
    }
  }
  const included = new Set<Unit>();
  const names = new Set<string>();
  const pending = [...roots];
  const include = (unit: Unit) => {
    included.add(unit);
    pending.push(...unit.uses);
  };
  let grew = true;
  while (grew) {
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      const unit = declaring.get(name);
      names.add(name);
      if (unit !== undefined && !included.has(unit)) {
        include(unit);
      }
    }
    const filling = units.filter(
      (unit) =>
        unit.declares.length === 0 &&
        !included.has(unit) &&
        [...unit.uses].some((name) => names.has(name)),
    );
    for (const unit of filling) {
      include(unit);
    }
    grew = filling.length > 0;
  }
  return units
    .filter((unit) => included.has(unit))
    .map((unit) => unit.text)
    .join(';\n');
}

export function declarationText(text: string, name: string): string {
  const unit = unitsFor(text).find((candidate) => candidate.declares.includes(name));
  if (unit === undefined) {
    throw new Error(`${name} is not declared at the top of the module`);
  }
  return unit.text;
}

export function declarationAround(text: string, position: number): string {
  const unit = unitAt(unitsFor(text), position);
  const name = unit?.declares[0];
  if (name === undefined) {
    throw new Error('no top-level declaration holds that position');
  }
  return name;
}
