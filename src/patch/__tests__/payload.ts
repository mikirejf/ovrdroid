import type { Patch } from '../patches.ts';
import { freeNames } from '../tokens.ts';

export function strayNames(patch: Patch): string[] {
  const captured = new Set(
    freeNames([patch.find, patch.until ?? '', ...(patch.lookups ?? [])].join(';')),
  );
  return freeNames(patch.replace).filter((name) => !name.startsWith('$OD') && !captured.has(name));
}

export function patchNamed(list: readonly Patch[], name: string): Patch {
  const patch = list.find((entry) => entry.name === name);
  if (patch === undefined) {
    throw new TypeError(`${name} is missing from the patch list`);
  }
  return patch;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function payloadFunction<Args extends unknown[], Result>(
  parameters: readonly string[],
  body: string,
): (...args: Args) => Result {
  // SAFETY: the body is a patch payload, evaluated with stand-ins for the bindings the shipped
  // chunk gives it. Each caller names the argument and result shapes its payload has.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion
  return new Function(...parameters, body) as (...args: Args) => Result;
}
