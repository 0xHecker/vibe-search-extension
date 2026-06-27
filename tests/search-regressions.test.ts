import { describe, expect, test } from "bun:test";
import { Charset, Document } from "flexsearch";
import { LocalSearchIndexService } from "../src/services/local-search-index.service";
import {
  hasEmbeddableText,
  hasVectorReference,
  isMetadataReadyForEmbedding,
} from "../src/search-core/embedding-state";
import { shouldKeepHybridRankHit } from "../src/search-core/hybrid-ranking";
import { resolveSearchSpaceIds } from "../src/search-core/space-scope";

describe("search regressions", () => {
  test("recognizes vector-backed records and embeddable records separately", () => {
    expect(hasVectorReference({ vector_index: -1, vector_indexes: [] })).toBe(false);
    expect(hasVectorReference({ vector_index: -1, vector_indexes: [7, 7] })).toBe(true);
    expect(hasEmbeddableText({ title: "Bookmark", textContent: "", ocrText: "", url: "" })).toBe(true);
    expect(hasEmbeddableText({ title: "", textContent: "", ocrText: "", url: "" })).toBe(false);
  });

  test("does not admit an item to embedding until metadata is complete", () => {
    expect(isMetadataReadyForEmbedding({ isMetaFetched: false })).toBe(false);
    expect(isMetadataReadyForEmbedding({ isMetaFetched: true })).toBe(true);
  });

  test("keeps hybrid results from either channel and excludes unrelated records", () => {
    const options = { useLexical: true, useVector: true, hasPositiveTextTerms: true };
    expect(shouldKeepHybridRankHit({ hasLexicalHit: true, hasVectorHit: false }, options)).toBe(true);
    expect(shouldKeepHybridRankHit({ hasLexicalHit: false, hasVectorHit: true }, options)).toBe(true);
    expect(shouldKeepHybridRankHit({ hasLexicalHit: false, hasVectorHit: false }, options)).toBe(false);
  });

  test("strict FlexSearch phrases do not expand into one-term suggestions", () => {
    const index = new Document({
      tokenize: "forward",
      encoder: Charset.LatinAdvanced,
      document: { id: "id", index: [{ field: "title", tokenize: "forward", resolution: 9 }] },
    });
    index.add({ id: "exact", title: "apple pie" });
    index.add({ id: "partial", title: "apple" });
    index.add({ id: "other", title: "banana pie" });

    expect(index.search("apple pie", { limit: 10, suggest: false })).toEqual([
      { field: "title", result: ["exact"] },
    ]);
  });

  test("uses strict lookup for keyword-only service searches", async () => {
    const index = new Document({
      tokenize: "forward",
      encoder: Charset.LatinAdvanced,
      document: { id: "id", index: [{ field: "title", tokenize: "forward", resolution: 9 }] },
    });
    index.add({ id: "exact", title: "apple pie" });
    index.add({ id: "partial", title: "apple" });
    index.add({ id: "other", title: "banana pie" });

    const service = new LocalSearchIndexService() as any;
    service.index = index;
    service.dirty = false;

    const scores = await service.search({
      query: "apple pie",
      queries: ["apple pie"],
      limit: 10,
      keyword: true,
      fuzzy: false,
    });
    expect(Array.from(scores.keys())).toEqual(["exact"]);
  });

  test("keeps global search global while constraining a selected space group", () => {
    expect(
      resolveSearchSpaceIds({
        activeSpaceId: "space-current",
        activeSpaceGroupId: null,
        activeSpaceGroupSpaceIds: [],
        requestedScope: "global",
        requestedSpaceIds: [],
      })
    ).toEqual([]);
    expect(
      resolveSearchSpaceIds({
        activeSpaceId: "space-current",
        activeSpaceGroupId: "group-1",
        activeSpaceGroupSpaceIds: ["space-a", "space-b"],
        requestedScope: "global",
        requestedSpaceIds: [],
      })
    ).toEqual(["space-a", "space-b"]);
    expect(
      resolveSearchSpaceIds({
        activeSpaceId: "space-current",
        activeSpaceGroupId: "group-1",
        activeSpaceGroupSpaceIds: ["space-a", "space-b"],
        requestedScope: "global",
        requestedSpaceIds: ["space-b", "space-c"],
      })
    ).toEqual(["space-b"]);
  });
});
