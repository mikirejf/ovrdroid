import { describe, expect, test } from 'bun:test';

import type { Patch } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { freeNames } from '../tokens.ts';

export function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

export function rebasedNamed(rebased: readonly Rebase[], name: string): Rebase {
  const rebase = rebased.find((entry) => entry.name === name);
  if (rebase === undefined) {
    throw new TypeError(`${name} is missing from the rebased patches`);
  }
  return rebase;
}

export async function failureOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'the call did not fail';
}

export function strayNames(patch: Patch): string[] {
  const captured = new Set(
    freeNames([patch.find, patch.until ?? '', ...(patch.lookups ?? [])].join(';')),
  );
  return freeNames(patch.replace).filter((name) => !name.startsWith('$OD') && !captured.has(name));
}

export function describeStrayNames(patches: readonly Patch[]): void {
  describe('every name of three characters or fewer in a payload is captured or owned', () => {
    test.each(patches.map((patch) => [patch.name, patch] as const))('%s', (_name, patch) => {
      expect(strayNames(patch)).toEqual([]);
    });
  });
}

export function patchNamed(list: readonly Patch[], name: string): Patch {
  const patch = list.find((entry) => entry.name === name);
  if (patch === undefined) {
    throw new TypeError(`${name} is missing from the patch list`);
  }
  return patch;
}

export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(Bun.env, name);
  } else {
    Bun.env[name] = value;
  }
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
