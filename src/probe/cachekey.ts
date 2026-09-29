import { quantile } from './ab.ts';
import type { Fields } from './fields.ts';
import { counted, fieldsOf, isObject, worded } from './fields.ts';

export const CACHEKEY_PROMPT = 'Reply with exactly: ok';
export const CACHEKEY_DIR = 'ovrdroid-cachekey';

export interface SessionUsage {
  inputTokens: number;
  cacheReadTokens: number;
  ttftMs: number;
}

export function cachekeyArgv(model: string, cwd: string): string[] {
  return ['exec', '-m', model, '-o', 'json', '--cwd', cwd, CACHEKEY_PROMPT];
}

function lineFields(line: string): Fields {
  if (!line.startsWith('{')) {
    return new Map();
  }
  try {
    return fieldsOf(JSON.parse(line));
  } catch {
    return new Map();
  }
}

function resultLine(stdout: string): Fields | undefined {
  let found: Fields | undefined;
  for (const line of stdout.split('\n')) {
    const fields = lineFields(line.trim());
    if (worded(fields, 'type') === 'result') {
      found = fields;
    }
  }
  return found;
}

export function parseUsage(stdout: string): SessionUsage {
  const result = resultLine(stdout);
  if (result === undefined) {
    throw new Error('exec printed no JSON line with "type":"result"');
  }
  const usage = result.get('usage');
  if (!isObject(usage)) {
    throw new Error('the exec result line carries no usage object');
  }
  const fields = fieldsOf(usage);
  return {
    inputTokens: counted(fields, 'input_tokens'),
    cacheReadTokens: counted(fields, 'cache_read_input_tokens'),
    ttftMs: counted(fields, 'ttft_ms'),
  };
}

function promptTokens(usage: SessionUsage): number {
  return usage.inputTokens + usage.cacheReadTokens;
}

function tokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0);
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

export function formatCachekey(sessions: readonly SessionUsage[]): string {
  const reads = sessions.map((usage) => usage.cacheReadTokens);
  const shares = sessions.map((usage) => {
    const prompt = promptTokens(usage);
    return prompt === 0 ? 0 : usage.cacheReadTokens / prompt;
  });
  const ttfts = sessions.map((usage) => usage.ttftMs);
  return [
    `  cache read  median ${tokens(quantile(reads, 0.5))}  range ${tokens(quantile(reads, 0))} to ${tokens(quantile(reads, 1))}`,
    `  share       median ${percent(quantile(shares, 0.5))} of prompt tokens`,
    `  ttft        median ${quantile(ttfts, 0.5).toFixed(0)}ms`,
  ].join('\n');
}

export function verdict(sessions: readonly SessionUsage[]): string {
  const read = quantile(
    sessions.map((usage) => usage.cacheReadTokens),
    0.5,
  );
  if (read === 0) {
    return 'a new session started cold: nothing reused from the earlier session';
  }
  const prompt = quantile(
    sessions.map((usage) => promptTokens(usage)),
    0.5,
  );
  return `a new session read ${tokens(read)} of ${tokens(prompt)} prompt tokens from the cache an earlier session wrote`;
}
