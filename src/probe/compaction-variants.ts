import { say } from '../cli.ts';
import { readSaved } from './compaction-saved.ts';
import { variantsReport } from './compaction-variants-report.ts';
import { modelPrice } from './prices-report.ts';

export interface CompactionVariantsOptions {
  modelId: string;
}

export async function printVariants(dir: string, modelId: string): Promise<void> {
  const [replies, price] = await Promise.all([readSaved(dir), modelPrice(modelId)]);
  for (const line of variantsReport(replies, price)) {
    say(line);
  }
}

export async function compactionVariants(
  dir: string,
  options: CompactionVariantsOptions,
): Promise<void> {
  await printVariants(dir, options.modelId);
}
