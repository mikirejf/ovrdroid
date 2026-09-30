import type { Rebase } from '../patch/rebase.ts';
import { applies, REBASE_STATUSES } from '../patch/rebase.ts';

const NAME_WIDTH = 34;
const STATUS_WIDTH = 10;

function formatRebase(result: Rebase): string {
  const notes = Object.entries(result.renames).map(([from, to]) => `${from}->${to}`);
  if (result.status === 'ambiguous') {
    notes.push(`${result.matches} places match`);
  }
  if (result.unresolved.length > 0) {
    notes.push(`free: ${result.unresolved.join(' ')}`);
  }
  if (result.collisions.length > 0) {
    notes.push(`share one name: ${result.collisions.join(' ')}`);
  }
  return [result.name.padEnd(NAME_WIDTH), result.status.padEnd(STATUS_WIDTH), notes.join(' ')]
    .join(' ')
    .trimEnd();
}

export function formatRebases(results: readonly Rebase[]): string {
  return results.map((result) => formatRebase(result)).join('\n');
}

export function summariseRebases(results: readonly Rebase[]): string {
  return REBASE_STATUSES.map(
    (status) => `${results.filter((result) => result.status === status).length} ${status}`,
  ).join(', ');
}

export function stuckRebases(results: readonly Rebase[]): Rebase[] {
  return results.filter((result) => !applies(result));
}
