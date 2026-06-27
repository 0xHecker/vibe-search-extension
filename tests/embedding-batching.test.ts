import { expect, test } from "bun:test";
import { chunkIndicesBySize, planLengthAwareBatches } from "@src/search-core/embedding-batching";

const flatten = (batches: number[][]): number[] => batches.flat().sort((a, b) => a - b);

test("planLengthAwareBatches returns no batches for empty input", () => {
  expect(planLengthAwareBatches([], { maxItems: 8, maxBatchWeight: 16000 })).toEqual([]);
});

test("planLengthAwareBatches covers every index exactly once", () => {
  const weights = [120, 5, 900, 30, 512, 7, 2048, 64, 64, 1];
  const batches = planLengthAwareBatches(weights, { maxItems: 4, maxBatchWeight: 4096 });
  expect(flatten(batches)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("planLengthAwareBatches never exceeds the item cap", () => {
  const weights = new Array(100).fill(10); // tiny, so weight never forces a split
  const batches = planLengthAwareBatches(weights, { maxItems: 8, maxBatchWeight: 1_000_000 });
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(8);
  }
  expect(flatten(batches)).toEqual(Array.from({ length: 100 }, (_, i) => i));
});

test("planLengthAwareBatches bounds padded work (count * longest weight)", () => {
  const weights = [2000, 1800, 100, 90, 80, 70, 60, 50, 40, 30];
  const maxBatchWeight = 4000;
  const batches = planLengthAwareBatches(weights, { maxItems: 16, maxBatchWeight });

  for (const batch of batches) {
    if (batch.length <= 1) continue; // a lone oversized sentence is unavoidable
    const longest = Math.max(...batch.map((index) => weights[index]));
    expect(batch.length * longest).toBeLessThanOrEqual(maxBatchWeight);
  }
});

test("planLengthAwareBatches keeps a lone oversized sentence in its own pass", () => {
  const weights = [10_000, 5, 5, 5];
  const batches = planLengthAwareBatches(weights, { maxItems: 8, maxBatchWeight: 4000 });
  const heavyBatch = batches.find((batch) => batch.includes(0));
  expect(heavyBatch).toEqual([0]);
});

test("planLengthAwareBatches emits batches as contiguous weight-sorted slices", () => {
  const weights = [1000, 10, 1000, 10, 1000, 10];
  const batches = planLengthAwareBatches(weights, { maxItems: 2, maxBatchWeight: 1_000_000 });
  // The planner consumes indices largest-weight-first (ties by index), so the
  // flattened plan is exactly that order — adjacent items share similar length.
  const expectedOrder = [...weights.keys()].sort((a, b) => weights[b] - weights[a] || a - b);
  expect(batches.flat()).toEqual(expectedOrder);
  // And the three heavy items cluster into the first two passes.
  expect(batches[0]).toEqual([0, 2]);
});

test("chunkIndicesBySize splits into contiguous order-preserving chunks", () => {
  expect(chunkIndicesBySize(0, 16)).toEqual([]);
  expect(chunkIndicesBySize(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  expect(chunkIndicesBySize(3, 10)).toEqual([[0, 1, 2]]);
});
