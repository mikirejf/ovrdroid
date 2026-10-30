export async function inPool<T, R>(
  items: readonly T[],
  width: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.entries();
  const lane = async (): Promise<void> => {
    for (const [at, item] of queue) {
      // oxlint-disable-next-line no-await-in-loop
      results[at] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  return results;
}
