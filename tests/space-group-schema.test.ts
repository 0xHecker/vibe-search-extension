import { describe, expect, test } from "bun:test";
import { spaceGroupSchema } from "@src/schemas/space_group_schema";

describe("spaceGroupSchema nesting (v1)", () => {
  test("is version 1 with a nullable parentGroupId defaulting to null", () => {
    expect(spaceGroupSchema.version).toBe(1);
    const prop = (spaceGroupSchema.properties as Record<string, any>).parentGroupId;
    expect(prop).toBeDefined();
    expect(prop.type).toEqual(["string", "null"]);
    expect(prop.default).toBeNull();
  });
});
