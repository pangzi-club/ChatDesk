import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./async.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("resolves results in input order", async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value));
      return value * 2;
    });

    expect(result).toEqual([6, 2, 4]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, () => deferred<void>());

    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gates[index]?.promise;
      inFlight -= 1;
      return index;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peak).toBe(2);

    for (const gate of gates) gate.resolve();
    await expect(run).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("handles empty input and clamps a non-positive limit", async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
    await expect(mapWithConcurrency([1, 2], 0, async (value) => value)).resolves.toEqual([1, 2]);
  });
});
