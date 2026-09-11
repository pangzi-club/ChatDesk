/**
 * Map over `items` with at most `limit` mapper calls in flight, resolving to the
 * results in input order. Used by the usage loaders, which previously swung
 * between a serial N-round-trip waterfall and an unbounded `Promise.all`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const concurrency = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
