import { describe, expect, test } from "bun:test";
import { MAX_GRID_QUERY_LIMIT, splitLookaheadPage } from "../src/search-core/pagination";

describe("database lookahead pagination", () => {
  test("does not report the lookahead document as a fake total", () => {
    const page = splitLookaheadPage(Array.from({ length: 101 }, (_, index) => index), 100, 0);

    expect(page.items).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(100);
    expect(page.totalIsExact).toBe(false);
  });

  test("reports an exact total at the end of the result set", () => {
    const page = splitLookaheadPage(Array.from({ length: 476 }, (_, index) => index), 500, 0);

    expect(page.items).toHaveLength(476);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(476);
    expect(page.totalIsExact).toBe(true);
  });

  test("loads one complete capped space by default", () => {
    expect(MAX_GRID_QUERY_LIMIT).toBe(500);
  });
});
