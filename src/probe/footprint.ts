import { KIB } from '../cli.ts';
import { stdoutOf } from './run.ts';

const VMMAP_TIMEOUT_MS = 5000;
const UNITS = new Map([
  ['K', 1],
  ['M', KIB],
  ['G', KIB * KIB],
]);

export function parseFootprint(text: string): number | undefined {
  const pattern = /^Physical footprint:\s+(?<size>[\d.]+)(?<unit>[KMG])/mu;
  const groups = pattern.exec(text)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const scale = UNITS.get(groups['unit'] ?? '');
  return scale === undefined ? undefined : Number(groups['size']) * scale;
}

export async function footprintOf(pid: number): Promise<number | undefined> {
  const listing = await stdoutOf(['vmmap', '-summary', String(pid)], {
    quiet: true,
    timeoutMs: VMMAP_TIMEOUT_MS,
  }).catch(() => '');
  return parseFootprint(listing);
}

export async function footprintsOf(pids: Iterable<number>): Promise<Map<number, number>> {
  const found = new Map<number, number>();
  const measured = await Promise.all(
    [...pids].map(async (pid) => [pid, await footprintOf(pid)] as const),
  );
  for (const [pid, kib] of measured) {
    if (kib !== undefined) {
      found.set(pid, kib);
    }
  }
  return found;
}
