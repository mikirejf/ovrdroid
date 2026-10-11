export type Fields = Map<string, unknown>;

export function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export function fieldsOf(value: unknown): Fields {
  return new Map(isObject(value) ? Object.entries(value) : []);
}

export function fieldsOfJson(line: string): Fields {
  try {
    return fieldsOf(JSON.parse(line));
  } catch {
    return new Map();
  }
}

export function worded(fields: Fields, name: string): string {
  const value = fields.get(name);
  return typeof value === 'string' ? value : '';
}

export function numberAt(fields: Fields, name: string): number | undefined {
  const value = fields.get(name);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function hasNumbers(fields: Fields, names: readonly string[]): boolean {
  return names.every((name) => numberAt(fields, name) !== undefined);
}

export function parseJson<T>(text: string, guard: (value: unknown) => value is T): T | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return guard(value) ? value : undefined;
}

export function parseJsonLines<T>(text: string, guard: (value: unknown) => value is T): T[] {
  return text
    .split('\n')
    .map((line) => parseJson(line, guard))
    .filter((parsed) => parsed !== undefined);
}

export function counted(fields: Fields, name: string): number {
  return numberAt(fields, name) ?? 0;
}

export function entriesOf(fields: Fields, name: string): Fields[] {
  const value = fields.get(name);
  const entries: Fields[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    entries.push(fieldsOf(item));
  }
  return entries;
}
