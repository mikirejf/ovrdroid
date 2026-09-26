import { whole } from '../cli.ts';
import type { Usage } from './anthropic.ts';
import type { SendName } from './effort-cache.ts';

const KEPT_SHARE = 0.9;
const REWROTE_SHARE = 0.1;

export interface Outcomes {
  seed: Usage;
  control: Usage;
  switches: readonly { name: SendName; usage: Usage }[];
}

function kept(usage: Usage, cached: number): boolean {
  return usage.cacheRead >= cached * KEPT_SHARE;
}

function ruling(name: SendName, usage: Usage, cached: number): string {
  const read = whole(usage.cacheRead);
  if (kept(usage, cached)) {
    return `${name} kept the cache: read ${read} of ${whole(cached)} cached tokens`;
  }
  const wrote = whole(usage.cacheWrite);
  if (usage.cacheRead < cached * REWROTE_SHARE) {
    return `${name} re-wrote the cache: read ${read}, wrote ${wrote}`;
  }
  return `${name} partly kept the cache: read ${read} of ${whole(cached)} cached tokens, wrote ${wrote}`;
}

export function verdict(outcomes: Outcomes): string {
  const cached = outcomes.seed.cacheWrite;
  if (cached === 0) {
    return 'the seed wrote nothing to the cache, so the run cannot judge the switches';
  }
  if (!kept(outcomes.control, cached)) {
    return [
      `same effort read only ${whole(outcomes.control.cacheRead)} of ${whole(cached)} cached tokens,`,
      'so the cache never warmed and the run cannot judge the switches',
    ].join(' ');
  }
  const beforeSwitch = outcomes.control.cacheRead + outcomes.control.cacheWrite;
  return outcomes.switches.map(({ name, usage }) => ruling(name, usage, beforeSwitch)).join('\n');
}
