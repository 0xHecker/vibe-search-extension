import { describe, expect, test } from "bun:test";
import { tagSchema } from "@src/schemas/tag_schema";

describe("tagSchema color + favorite (v1)", () => {
  test("is version 1 with nullable color and boolean isFavorite", () => {
    expect(tagSchema.version).toBe(1);
    const props = tagSchema.properties as Record<string, any>;
    expect(props.color).toBeDefined();
    expect(props.color.type).toEqual(["string", "null"]);
    expect(props.color.default).toBeNull();
    expect(props.isFavorite).toBeDefined();
    expect(props.isFavorite.default).toBe(false);
  });
});
