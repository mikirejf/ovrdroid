import type { Fields } from './fields.ts';
import { fieldsOf, numberAt, worded } from './fields.ts';

const PER_MILLION = 1_000_000;
export const ANTHROPIC = 'anthropic';
const ONE_HOUR_WRITE_MULTIPLE = 2;
const DROIDPROXY = 'custom:droidproxy:';
const OPENAI_PREFIX = 'gpt';
const MONEY_DECIMALS = 4;
const MULTIPLE_DECIMALS = 3;
const MISSING = '-';
const NUMERIC_FROM = 2;

const EFFORT_SUFFIXES: readonly string[] = ['-low', '-medium', '-high', '-xhigh', '-max'];

const PREFERRED_PROVIDERS: readonly string[] = [ANTHROPIC, 'openai', 'openrouter'];

const HINTED_PROVIDERS: readonly string[] = [ANTHROPIC, 'openai'];

const HEADINGS: readonly string[] = [
  'droid id',
  'provider/models.dev id',
  'input',
  'output',
  'read',
  'write 5m',
  'write 1h',
];

interface CatalogCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type Catalog = Map<string, Map<string, CatalogCost>>;

export interface CustomModel {
  id: string;
  model: string;
  provider: string;
}

export interface ModelPrice {
  droidId: string;
  provider: string;
  modelId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h?: number | undefined;
}

interface ModelsDevId {
  modelId: string;
  hint?: string | undefined;
}

interface ResolvedPrices {
  priced: ModelPrice[];
  unmapped: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
}

function costIn(model: unknown): CatalogCost | undefined {
  const cost = fieldsOf(fieldsOf(model).get('cost'));
  const input = numberAt(cost, 'input');
  const output = numberAt(cost, 'output');

  if (input === undefined || output === undefined) {
    return undefined;
  }

  return {
    input,
    output,
    cacheRead: numberAt(cost, 'cache_read') ?? 0,
    cacheWrite: numberAt(cost, 'cache_write') ?? 0,
  };
}

export function parseCatalog(value: unknown): Catalog {
  const catalog: Catalog = new Map();

  for (const [providerId, provider] of fieldsOf(value)) {
    const models = new Map<string, CatalogCost>();
    for (const [modelId, model] of fieldsOf(fieldsOf(provider).get('models'))) {
      const cost = costIn(model);
      if (cost !== undefined) {
        models.set(modelId, cost);
      }
    }
    catalog.set(providerId, models);
  }

  return catalog;
}

export function customModelsIn(settings: Fields): CustomModel[] {
  const declared = settings.get('customModels');
  if (!Array.isArray(declared)) {
    return [];
  }

  const models: CustomModel[] = [];
  for (const entry of declared) {
    const fields = fieldsOf(entry);
    const model: CustomModel = {
      id: worded(fields, 'id'),
      model: worded(fields, 'model'),
      provider: worded(fields, 'provider'),
    };
    if (model.id !== '' && model.model !== '') {
      models.push(model);
    }
  }

  return models;
}

function hintFor(provider: string): string | undefined {
  return HINTED_PROVIDERS.find((known) => known === provider);
}

function withoutEffort(name: string): string {
  const suffix = EFFORT_SUFFIXES.find((candidate) => name.endsWith(candidate));
  return suffix === undefined ? name : name.slice(0, -suffix.length);
}

export function modelsDevIdFor(droidId: string, customModels: readonly CustomModel[]): ModelsDevId {
  const declared = customModels.find((model) => model.id === droidId);
  if (declared !== undefined) {
    return { modelId: declared.model, hint: hintFor(declared.provider) };
  }

  if (droidId.startsWith(DROIDPROXY)) {
    const name = withoutEffort(droidId.slice(DROIDPROXY.length));
    return name.startsWith(OPENAI_PREFIX)
      ? { modelId: name, hint: 'openai' }
      : { modelId: `claude-${name}`, hint: ANTHROPIC };
  }

  return { modelId: droidId };
}

function searchOrder(hint: string | undefined): string[] {
  return [...new Set(hint === undefined ? PREFERRED_PROVIDERS : [hint, ...PREFERRED_PROVIDERS])];
}

function priceOf(catalog: Catalog, droidId: string, target: ModelsDevId): ModelPrice | undefined {
  for (const provider of searchOrder(target.hint)) {
    const cost = catalog.get(provider)?.get(target.modelId);
    if (cost === undefined) {
      continue;
    }
    return {
      droidId,
      provider,
      modelId: target.modelId,
      input: cost.input,
      output: cost.output,
      cacheRead: cost.cacheRead,
      cacheWrite5m: cost.cacheWrite,
      cacheWrite1h: provider === ANTHROPIC ? cost.input * ONE_HOUR_WRITE_MULTIPLE : undefined,
    };
  }
  return undefined;
}

export function resolvePrices(
  catalog: Catalog,
  droidIds: readonly string[],
  customModels: readonly CustomModel[],
): ResolvedPrices {
  const resolved: ResolvedPrices = { priced: [], unmapped: [] };

  for (const droidId of droidIds) {
    const price = priceOf(catalog, droidId, modelsDevIdFor(droidId, customModels));
    if (price === undefined) {
      resolved.unmapped.push(droidId);
    } else {
      resolved.priced.push(price);
    }
  }

  return resolved;
}

export function costOf(price: ModelPrice, usage: TokenUsage): number {
  if (usage.cacheWrite1hTokens > 0 && price.cacheWrite1h === undefined) {
    throw new Error(`${price.droidId} has no 1 hour cache write price`);
  }

  const dollars =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWrite5mTokens * price.cacheWrite5m +
    usage.cacheWrite1hTokens * (price.cacheWrite1h ?? 0);

  return dollars / PER_MILLION;
}

function trimmed(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/0+$/u, '').replace(/\.$/u, '');
}

function money(value: number | undefined): string {
  return value === undefined ? MISSING : trimmed(value, MONEY_DECIMALS);
}

function rowsOf(priced: readonly ModelPrice[]): string[][] {
  return priced.map((price) => [
    price.droidId,
    `${price.provider}/${price.modelId}`,
    money(price.input),
    money(price.output),
    money(price.cacheRead),
    money(price.cacheWrite5m),
    money(price.cacheWrite1h),
  ]);
}

function widthsOf(rows: readonly (readonly string[])[]): number[] {
  const widths = HEADINGS.map((heading) => heading.length);
  for (const row of rows) {
    for (const [column, cell] of row.entries()) {
      widths[column] = Math.max(widths[column] ?? 0, cell.length);
    }
  }
  return widths;
}

function aligned(rows: readonly (readonly string[])[]): string[] {
  const widths = widthsOf(rows);
  return rows.map((row) =>
    row
      .map((cell, column) => {
        const width = widths[column] ?? 0;
        return column < NUMERIC_FROM ? cell.padEnd(width) : cell.padStart(width);
      })
      .join('  ')
      .trimEnd(),
  );
}

function multiple(value: number | undefined, input: number): string {
  if (value === undefined || input === 0) {
    return MISSING;
  }
  return `${trimmed(value / input, MULTIPLE_DECIMALS)}x`;
}

function multipleLines(priced: readonly ModelPrice[]): string[] {
  return priced.map((price) =>
    [
      `${price.droidId}: read ${multiple(price.cacheRead, price.input)}`,
      `write5m ${multiple(price.cacheWrite5m, price.input)}`,
      `write1h ${multiple(price.cacheWrite1h, price.input)}`,
    ].join(', '),
  );
}

export function formatPrices(priced: readonly ModelPrice[]): string {
  if (priced.length === 0) {
    return 'no priced models';
  }

  return [
    'dollars per million tokens:',
    ...aligned([HEADINGS, ...rowsOf(priced)]),
    '',
    'as multiples of input:',
    ...multipleLines(priced),
  ].join('\n');
}
