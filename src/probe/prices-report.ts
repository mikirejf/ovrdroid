import { fail, isoDate, say } from '../cli.ts';
import { cacheDir } from '../paths.ts';
import type { Catalog } from './prices.ts';
import { formatPrices, parseCatalog, resolvePrices } from './prices.ts';
import { readCustomModels } from './settings.ts';

const CATALOG_URL = 'https://models.dev/api.json';
const CATALOG_FILE = cacheDir('prices', 'api.json');

export interface PricesOptions {
  refresh: boolean;
}

interface LoadedCatalog {
  catalog: Catalog;
  from: 'the network' | 'cache';
  at: string;
}

async function download(): Promise<void> {
  const response = await fetch(CATALOG_URL);
  if (!response.ok) {
    throw new Error(`fetching ${CATALOG_URL} failed: ${response.status} ${response.statusText}`);
  }
  await Bun.write(CATALOG_FILE, response);
}

async function cachedCatalog(): Promise<Catalog | undefined> {
  try {
    return parseCatalog(await Bun.file(CATALOG_FILE).json());
  } catch {
    return undefined;
  }
}

async function loadCatalog(refresh: boolean): Promise<LoadedCatalog> {
  const held = refresh ? undefined : await cachedCatalog();
  if (held === undefined) {
    await download();
  }

  const file = Bun.file(CATALOG_FILE);
  const catalog = held ?? parseCatalog(await file.json());
  if (catalog.size === 0) {
    throw new Error(`${CATALOG_FILE} holds no providers: is it a models.dev catalog?`);
  }

  return {
    catalog,
    from: held === undefined ? 'the network' : 'cache',
    at: isoDate(file.lastModified),
  };
}

export async function prices(ids: string[], options: PricesOptions): Promise<void> {
  const [{ catalog, from, at }, customModels] = await Promise.all([
    loadCatalog(options.refresh),
    readCustomModels(),
  ]);

  say(`catalog from ${from}, dated ${at}`);
  say('');

  const wanted = ids.length > 0 ? ids : customModels.map((model) => model.id);
  const { priced, unmapped } = resolvePrices(catalog, wanted, customModels);
  say(formatPrices(priced));

  if (unmapped.length > 0) {
    fail(`unmapped, no price known: ${unmapped.join(', ')}`);
  }
}
