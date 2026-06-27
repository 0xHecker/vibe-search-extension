import { describe, expect, test } from "bun:test";
import { analyzeQuery } from "../src/search-core/query-language";
import type { QueryAssistCatalogs } from "../src/search-core/contracts";

const catalogs: QueryAssistCatalogs = {
  sources: [],
  spaces: [],
  folders: [],
  tags: [],
  domains: [],
  authors: [],
  recentQueries: [],
};

const analyze = (input: string) =>
  analyzeQuery({
    type: "ANALYZE_QUERY",
    requestId: 1,
    input,
    cursor: input.length,
    catalogs,
    forceSuggestions: false,
  });

describe("query language filters (UI ↔ typing share one state)", () => {
  test("has:embed and has:video parse into hasAny media filters", () => {
    const analysis = analyze("songs has:embed has:video");
    expect(analysis.filters.hasAny).toContain("embed");
    expect(analysis.filters.hasAny).toContain("video");
    expect(analysis.freeText).toBe("songs");
  });

  test("mode + scope directives resolve (chips read these)", () => {
    const analysis = analyze("mode:hybrid scope:private");
    expect(analysis.directives.mode).toBe("keyword+vector");
    expect(analysis.directives.scope).toBe("private");
  });

  test("multi-space, tag and site filters accumulate", () => {
    const analysis = analyze('tag:music site:youtube.com space:Work space:"Side Projects"');
    expect(analysis.filters.tagNames).toContain("music");
    expect(analysis.filters.domains).toContain("youtube.com");
    expect(analysis.filters.spaceIds).toEqual(["Work", "Side Projects"]);
  });

  test("a directive pill carries its source range so the UI can toggle it", () => {
    const analysis = analyze("has:embed");
    const pill = analysis.pills.find((entry) => entry.field === "has" && entry.value === "embed");
    expect(pill).toBeTruthy();
    expect(typeof pill?.start).toBe("number");
    expect(typeof pill?.end).toBe("number");
  });
});
