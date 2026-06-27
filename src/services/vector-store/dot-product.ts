// Cosine similarity for L2-normalized embedding vectors.
//
// The embedding model emits unit vectors (it ends with an L2-normalize layer),
// and the query is embedded the same way, so both `a` and `b` are already
// normalized. For unit vectors, cosine similarity equals the dot product.
// Computing the dot product directly avoids recomputing both norms (two extra
// multiply-accumulates per dimension, a divide, and two square roots) on every
// comparison in the hot scan loop, which dominates vector search cost.
//
// Inputs are assumed L2-normalized. A zero vector returns 0 (its dot product
// with anything is 0), preserving the previous behavior for degenerate vectors.
export function dotProduct(a: Float32Array, b: Float32Array): number {
  if (!a || !b || !a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }

  return sum;
}
