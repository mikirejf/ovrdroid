export interface Lane<T> {
  readonly items: readonly T[];
}

export interface Phase<T> {
  readonly name: string;
  readonly lanesAtOnce: number;
  readonly lanes: readonly Lane<T>[];
}

export async function runPhase<T, R>(phase: Phase<T>, run: (item: T) => Promise<R>): Promise<R[]> {
  const perLane: R[][] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const lane = phase.lanes[index];
      if (lane === undefined) {
        return;
      }
      const results: R[] = [];
      for (const item of lane.items) {
        // oxlint-disable-next-line no-await-in-loop
        results.push(await run(item));
      }
      perLane[index] = results;
    }
  };

  const workers = Math.min(phase.lanesAtOnce, phase.lanes.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      await worker();
    }),
  );
  return perLane.flat();
}

export function itemsOf<T>(phases: readonly Phase<T>[]): T[] {
  return phases.flatMap((phase) => phase.lanes.flatMap((lane) => lane.items));
}
