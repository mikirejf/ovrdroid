import { FACTORY_SETTINGS } from '../paths.ts';
import type { Fields } from './fields.ts';
import { fieldsOf } from './fields.ts';
import type { CustomModel } from './prices.ts';
import { customModelsIn } from './prices.ts';

export async function settingsFields(): Promise<Fields> {
  try {
    return fieldsOf(await Bun.file(FACTORY_SETTINGS).json());
  } catch {
    return new Map();
  }
}

export async function readCustomModels(): Promise<CustomModel[]> {
  return customModelsIn(await settingsFields());
}
