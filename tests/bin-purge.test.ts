import { describe, expect, test } from "bun:test";
import {
  BIN_RETENTION_MS,
  computeBinPurgeAt,
  isSpacePurgeable,
  LIVE_SPACE_SELECTOR,
  SPACE_NOT_BINNED,
} from "../src/common/spaces";

describe("bin purge helpers", () => {
  test("computeBinPurgeAt schedules the purge 30 days out", () => {
    expect(computeBinPurgeAt(1_000_000)).toBe(1_000_000 + BIN_RETENTION_MS);
  });

  test("computeBinPurgeAt returns 0 for invalid inputs", () => {
    expect(computeBinPurgeAt(0)).toBe(0);
    expect(computeBinPurgeAt(Number.NaN)).toBe(0);
    expect(computeBinPurgeAt(-1)).toBe(0);
  });

  test("isSpacePurgeable only fires when the retention window has elapsed", () => {
    const now = 10_000_000;
    expect(isSpacePurgeable({ deletedAt: 1_000, purgeAt: now }, now)).toBe(true);
    expect(isSpacePurgeable({ deletedAt: 1_000, purgeAt: now + 1 }, now)).toBe(false);
    expect(isSpacePurgeable({ deletedAt: 0, purgeAt: 0 }, now)).toBe(false);
    expect(isSpacePurgeable({ deletedAt: 1_000, purgeAt: 0 }, now)).toBe(false);
  });

  test("LIVE_SPACE_SELECTOR excludes binned spaces", () => {
    expect(LIVE_SPACE_SELECTOR).toMatchObject({
      isArchived: { $eq: false },
      deletedAt: { $eq: SPACE_NOT_BINNED },
    });
  });
});