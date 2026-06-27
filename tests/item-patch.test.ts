import { describe, expect, test } from "bun:test";
import { mergeItemsById } from "@src/search-core/item-patch";
import type { ItemDocType } from "@src/schemas/item_schema";

const item = (id: string, title: string) => ({ id, title }) as ItemDocType;

describe("mergeItemsById", () => {
  test("replaces only enriched visible rows while keeping result order", () => {
    const first = item("first", "Before");
    const second = item("second", "Unchanged");
    const enriched = item("first", "After");

    const merged = mergeItemsById([first, second], [enriched]);

    expect(merged).toEqual([enriched, second]);
    expect(merged[1]).toBe(second);
  });

  test("does not add rows outside the active result set", () => {
    const first = item("first", "Visible");
    const current = [first];

    expect(mergeItemsById(current, [item("other", "Not visible")])).toBe(current);
  });
});
