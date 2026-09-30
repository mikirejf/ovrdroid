import { describeDrift } from '../binary/apply.ts';
import type { Rebase } from '../patch/rebase.ts';
import { applies } from '../patch/rebase.ts';

export interface Verdict {
  line: string;
  drifts: boolean;
}

export function judgeBuild(host: string, version: string, rebases: readonly Rebase[]): Verdict {
  const drifted = rebases.filter((rebase) => !applies(rebase));
  const outcome =
    drifted.length === 0
      ? `all ${rebases.length} patches apply`
      : `${drifted.length} ${drifted.length === 1 ? 'patch drifts' : 'patches drift'}: ${drifted.map((rebase) => describeDrift(rebase)).join(', ')}`;
  return {
    line: `${host}  ${version}  ${outcome}`,
    drifts: drifted.length > 0,
  };
}
