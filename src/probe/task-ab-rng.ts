const MODULUS = 2_147_483_647;
const MULTIPLIER = 48_271;
const HASH_MULTIPLIER = 31;
const WARM_UP_DRAWS = 3;

export interface Rng {
  int: (below: number) => number;
  pick: <T>(items: readonly T[]) => T;
  sample: <T>(items: readonly T[], size: number) => T[];
}

function seedOf(text: string): number {
  let hash = 0;
  for (const char of text) {
    hash = (hash * HASH_MULTIPLIER + (char.codePointAt(0) ?? 0)) % MODULUS;
  }
  return hash === 0 ? 1 : hash;
}

export function createRng(seed: string): Rng {
  let state = seedOf(seed);
  const unit = (): number => {
    state = (state * MULTIPLIER) % MODULUS;
    return (state - 1) / (MODULUS - 1);
  };
  for (let draw = 0; draw < WARM_UP_DRAWS; draw++) {
    unit();
  }
  const int = (below: number): number => Math.floor(unit() * below);
  const sample = <T>(items: readonly T[], size: number): T[] => {
    const pool = [...items];
    const chosen: T[] = [];
    while (chosen.length < size && pool.length > 0) {
      const [taken] = pool.splice(int(pool.length), 1);
      if (taken !== undefined) {
        chosen.push(taken);
      }
    }
    return chosen;
  };
  const pick = <T>(items: readonly T[]): T => {
    const [only] = sample(items, 1);
    if (only === undefined) {
      throw new Error('cannot pick from an empty list');
    }
    return only;
  };
  return { int, pick, sample };
}
