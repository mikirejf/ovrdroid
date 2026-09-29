import type { Usage } from '../anthropic.ts';
import type { SendOutcome } from '../ttl-verdict.ts';
import type { SendStep } from '../ttl.ts';

export interface Counts {
  input?: number;
  read?: number;
  write?: number;
  write5m?: number;
  write1h?: number;
}

const QUICK_SECONDS = 2;

export function send(ttl: SendStep['ttl'], slow = false, other = false): SendStep {
  return { kind: 'send', ttl, slow, other };
}

export function usage(counts: Counts): Usage {
  return {
    inputTokens: counts.input ?? 2,
    cacheRead: counts.read ?? 0,
    cacheWrite: counts.write ?? 0,
    write5m: counts.write5m ?? 0,
    write1h: counts.write1h ?? 0,
    outputTokens: 4,
  };
}

export function wrote(tokens: number): Usage {
  return usage({ read: 0, write: tokens, write5m: tokens });
}

export function read(tokens: number): Usage {
  return usage({ read: tokens, write: 0 });
}

export function outcomes(
  results: readonly Usage[],
  elapsed: readonly number[] = [],
): SendOutcome[] {
  return results.map((entry, index) => ({
    usage: entry,
    elapsedSeconds: elapsed[index] ?? QUICK_SECONDS,
  }));
}
