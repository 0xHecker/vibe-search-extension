import { describe, expect, test } from "bun:test";
import { appendUnorderedIds } from "../src/utils/ordered-ids";

describe("appendUnorderedIds", () => {
  test("preserves supplied order and appends only IDs that are absent", () => {
    expect(appendUnorderedIds(["b", "a"], ["a", "b", "c", "d"])).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  test("preserves duplicate and unknown supplied IDs for compatibility", () => {
    expect(appendUnorderedIds(["missing", "a", "a"], ["a", "b", "c"])).toEqual([
      "missing",
      "a",
      "a",
      "b",
      "c",
    ]);
  });

  test("does not mutate either input", () => {
    const ordered = ["b"];
    const available = ["a", "b"];

    appendUnorderedIds(ordered, available);

    expect(ordered).toEqual(["b"]);
    expect(available).toEqual(["a", "b"]);
  });
});
