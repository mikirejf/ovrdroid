import { say } from '../cli.ts';
import { FACTORY_MCP } from '../paths.ts';
import type { Footgun } from './checks.ts';
import type { FixOutcome } from './fix.ts';
import { scanMcpConfig } from './scan.ts';

export function formatFootgun(footgun: Footgun): string {
  return [
    `doctor: ${footgun.id} (${footgun.server})`,
    `  problem: ${footgun.problem}`,
    `  impact: ${footgun.impact}`,
    `  fix: ${footgun.fix}`,
    ...(footgun.fixHint === undefined ? [] : [`  run: ${footgun.fixHint}`]),
  ].join('\n');
}

export function formatReport(found: readonly Footgun[], mcpPath: string): string {
  const head = `doctor: ${found.length} footgun${found.length === 1 ? '' : 's'} in ${mcpPath}`;
  return [head, ...found.map((footgun) => formatFootgun(footgun))].join('\n');
}

export function formatFixed(outcome: FixOutcome, mcpPath: string): string {
  const head = `doctor: fixed ${outcome.fixed.length} server${outcome.fixed.length === 1 ? '' : 's'} in ${mcpPath} (backup at ${outcome.backup})`;
  const rows = outcome.fixed.map(
    (item) =>
      `  ${item.server}: ${item.fromCommand} ${item.fromArgs.join(' ')}\n    -> ${item.toCommand} ${item.toArgs.join(' ')}`,
  );
  return [head, ...rows].join('\n');
}

export function runDoctor(mcpPath: string = FACTORY_MCP): void {
  const found = scanMcpConfig(mcpPath);
  say(found.length === 0 ? `doctor: clean (${mcpPath})` : formatReport(found, mcpPath));
}
