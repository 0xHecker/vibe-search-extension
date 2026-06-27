import { expect, test } from "bun:test";
import { dotProduct } from "@src/services/vector-store/dot-product";

const normalize = (values: number[]): Float32Array => {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;
  return new Float32Array(values.map((v) => v / norm));
};

test("dotProduct equals cosine for identical normalized vectors", () => {
  const v = normalize([1, 2, 3, 4]);
  expect(dotProduct(v, v)).toBeCloseTo(1, 5);
});

test("dotProduct is ~0 for orthogonal normalized vectors", () => {
  const a = normalize([1, 0, 0]);
  const b = normalize([0, 1, 0]);
  expect(dotProduct(a, b)).toBeCloseTo(0, 6);
});

test("dotProduct is ~-1 for opposite normalized vectors", () => {
  const a = normalize([1, 1, 1]);
  const b = normalize([-1, -1, -1]);
  expect(dotProduct(a, b)).toBeCloseTo(-1, 5);
});

test("dotProduct matches the cosine of two arbitrary normalized vectors", () => {
  const a = normalize([0.2, 0.5, 0.1, 0.8]);
  const b = normalize([0.9, 0.1, 0.4, 0.3]);
  // Reference cosine via explicit norms (both already unit, so == dot).
  const raw = a.reduce((sum, v, i) => sum + v * b[i], 0);
  expect(dotProduct(a, b)).toBeCloseTo(raw, 6);
});

test("dotProduct guards mismatched lengths and empties", () => {
  expect(dotProduct(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
  expect(dotProduct(new Float32Array([]), new Float32Array([]))).toBe(0);
});

test("dotProduct returns 0 against a zero vector", () => {
  const a = normalize([1, 2, 3]);
  expect(dotProduct(a, new Float32Array([0, 0, 0]))).toBe(0);
});
