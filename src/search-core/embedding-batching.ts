// Embedding inference memory is dominated by transformer self-attention, which
// scales with (batchSize * maxSequenceLength^2). A single unbounded batch
// padded to its longest member is what makes a bulk import spike to multiple
// gigabytes. This planner bounds every inference pass two ways:
//
//   1. a hard cap on the number of sentences per pass (`maxItems`), and
//   2. a padding-aware cap on `count * longestWeightInBatch` (`maxBatchWeight`).
//
// Sentences are bucketed by weight (a cheap length proxy) so a pass never mixes
// one very long sequence with many short ones and pays full padding for all of
// them. The plan returns groups of ORIGINAL indices, so callers can scatter
// results back into input order.

export type MicroBatchPlanOptions = {
  /** Hard cap on sentences per inference pass. */
  maxItems: number;
  /** Cap on padded work per pass: count * largest weight in the batch. */
  maxBatchWeight: number;
};

/**
 * Group item indices into length-bucketed micro-batches.
 *
 * @param weights Per-sentence weight (e.g. character length or token estimate).
 * @returns Arrays of original indices, each array being one inference pass.
 */
export const planLengthAwareBatches = (
  weights: readonly number[],
  options: MicroBatchPlanOptions
): number[][] => {
  const count = weights.length;
  if (count === 0) return [];

  const maxItems = Math.max(1, Math.floor(options.maxItems));
  const maxBatchWeight = Math.max(1, options.maxBatchWeight);

  // Largest first: the first member of a fresh batch sets that batch's padded
  // width, so packing big sequences together keeps padded work predictable.
  const order = Array.from({ length: count }, (_, index) => index).sort((a, b) => {
    const diff = (weights[b] || 0) - (weights[a] || 0);
    return diff !== 0 ? diff : a - b;
  });

  const batches: number[][] = [];
  let current: number[] = [];
  let currentMaxWeight = 0;

  for (const index of order) {
    const weight = Math.max(0, weights[index] || 0);
    // Sorted descending, so the first item in `current` is always the heaviest.
    const padWidth = current.length === 0 ? weight : currentMaxWeight;
    const nextCount = current.length + 1;
    const nextWeight = nextCount * padWidth;
    const exceedsCount = nextCount > maxItems;
    const exceedsWeight = nextWeight > maxBatchWeight;

    if (current.length > 0 && (exceedsCount || exceedsWeight)) {
      batches.push(current);
      current = [];
      currentMaxWeight = 0;
    }

    if (current.length === 0) currentMaxWeight = weight;
    current.push(index);
  }

  if (current.length > 0) batches.push(current);
  return batches;
};

/**
 * Split N items into contiguous, order-preserving chunks of at most `size`.
 * Used to bound how many sentences a single embedding worker request carries so
 * a background batch cannot monopolize the worker ahead of interactive search.
 */
export const chunkIndicesBySize = (count: number, size: number): number[][] => {
  if (count <= 0) return [];
  const step = Math.max(1, Math.floor(size));
  const chunks: number[][] = [];
  for (let start = 0; start < count; start += step) {
    const end = Math.min(count, start + step);
    const chunk: number[] = [];
    for (let index = start; index < end; index += 1) chunk.push(index);
    chunks.push(chunk);
  }
  return chunks;
};
