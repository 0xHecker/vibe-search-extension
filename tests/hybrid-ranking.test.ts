import { expect, test, describe } from "bun:test";
import {
  computeBaseRelevance,
  VECTOR_HIT_FLOOR,
  type RankingSignals,
} from "@src/search-core/hybrid-ranking";

// --- Test fixtures: a tiny "library" with hand-assigned signals per query ---
//
// Each doc has a cosine similarity to the query (semantic relevance) and a raw
// FlexSearch lexical score (keyword relevance). This lets us assert ranking
// quality deterministically, and compare the previous RRF fusion against the
// new weighted fusion.

type Doc = {
  id: string;
  cosine: number; // semantic similarity to the query, [-1, 1]
  lexical: number; // raw FlexSearch score, 0 = no keyword hit
};

type Mode = { useVector: boolean; useLexical: boolean };

const buildSignals = (doc: Doc, docs: Doc[], mode: Mode): RankingSignals => {
  const maxLexicalScore = Math.max(0, ...docs.map((d) => d.lexical));
  return {
    useLexical: mode.useLexical,
    useVector: mode.useVector,
    // Mirror the worker: a near-orthogonal neighbour is not a vector hit.
    hasVectorHit: mode.useVector && doc.cosine >= VECTOR_HIT_FLOOR,
    hasLexicalHit: mode.useLexical && doc.lexical > 0,
    vectorScore: doc.cosine,
    lexicalScore: mode.useLexical ? doc.lexical : 0,
    maxLexicalScore,
    matchedTermCount: doc.lexical > 0 ? 1 : 0,
    positiveTermCount: 1,
  };
};

const rankNew = (docs: Doc[], mode: Mode): string[] =>
  [...docs]
    .map((doc) => ({ id: doc.id, score: computeBaseRelevance(buildSignals(doc, docs, mode)) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((entry) => entry.id);

// Reimplementation of the PREVIOUS Reciprocal Rank Fusion hybrid scoring, so we
// can demonstrate the regression the new fusion fixes.
const RRF_K = 60;
const rankOldRrf = (docs: Doc[], mode: Mode): string[] => {
  const lexById = new Map(docs.map((d) => [d.id, d.lexical]));
  const lexRankById = new Map(
    [...docs]
      .filter((d) => d.lexical > 0)
      .sort((a, b) => b.lexical - a.lexical)
      .map((d, i) => [d.id, i + 1])
  );
  const vecRankById = new Map(
    [...docs].sort((a, b) => b.cosine - a.cosine).map((d, i) => [d.id, i + 1])
  );
  const rr = (rank?: number) => (rank ? 1 / (RRF_K + rank) : 0);
  const maxRrf = rr(1) * 2;
  return [...docs]
    .map((doc) => {
      const hasLex = mode.useLexical && (lexById.get(doc.id) || 0) > 0;
      const hasVec = mode.useVector; // old code: any in-set vector counted as a hit
      let score = 0;
      if (mode.useVector && mode.useLexical) {
        const lexRrf = hasLex ? rr(lexRankById.get(doc.id)) : 0;
        const vecRrf = hasVec ? rr(vecRankById.get(doc.id)) : 0;
        score = maxRrf > 0 ? (lexRrf + vecRrf) / maxRrf : 0;
      } else if (mode.useVector) {
        score = (doc.cosine + 1) / 2;
      }
      return { id: doc.id, score };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((entry) => entry.id);
};

const HYBRID: Mode = { useVector: true, useLexical: true };
const VECTOR_ONLY: Mode = { useVector: true, useLexical: false };
const LEXICAL_ONLY: Mode = { useVector: false, useLexical: true };

describe("hybrid ranking fusion", () => {
  // The canonical failure: a perfect semantic match with no keyword overlap vs.
  // an irrelevant document that merely contains a query keyword.
  const canonical: Doc[] = [
    { id: "perfect-semantic", cosine: 0.72, lexical: 0 },
    { id: "keyword-coincidence", cosine: 0.12, lexical: 3.0 },
    { id: "strong-both", cosine: 0.6, lexical: 1.5 },
    { id: "irrelevant", cosine: 0.05, lexical: 0 },
  ];

  test("OLD RRF mis-ranks an irrelevant keyword match above a perfect semantic match", () => {
    const ranked = rankOldRrf(canonical, HYBRID);
    // Demonstrates the bug being fixed: the coincidence outranks the best match.
    expect(ranked.indexOf("keyword-coincidence")).toBeLessThan(ranked.indexOf("perfect-semantic"));
  });

  test("NEW fusion ranks the perfect semantic match above the keyword coincidence", () => {
    const ranked = rankNew(canonical, HYBRID);
    expect(ranked.indexOf("perfect-semantic")).toBeLessThan(ranked.indexOf("keyword-coincidence"));
  });

  test("NEW fusion puts a strong-both document first and the irrelevant one last", () => {
    const ranked = rankNew(canonical, HYBRID);
    expect(ranked[0]).toBe("strong-both");
    expect(ranked[ranked.length - 1]).toBe("irrelevant");
  });

  test("a single keyword coincidence cannot outrank a strong semantic match", () => {
    const semantic = computeBaseRelevance(buildSignals(canonical[0], canonical, HYBRID));
    const coincidence = computeBaseRelevance(buildSignals(canonical[1], canonical, HYBRID));
    expect(semantic).toBeGreaterThan(coincidence);
  });

  test("hybrid never scores below what the vector channel alone would justify being beaten by noise", () => {
    // A document strong in vector should not be dragged below a noise document.
    const strongVector = computeBaseRelevance(buildSignals({ id: "v", cosine: 0.65, lexical: 0 }, canonical, HYBRID));
    const noise = computeBaseRelevance(buildSignals({ id: "n", cosine: 0.1, lexical: 0.5 }, canonical, HYBRID));
    expect(strongVector).toBeGreaterThan(noise);
  });

  test("all scores stay within [0, 1]", () => {
    for (const mode of [HYBRID, VECTOR_ONLY, LEXICAL_ONLY]) {
      for (const doc of canonical) {
        const score = computeBaseRelevance(buildSignals(doc, canonical, mode));
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  test("vector-only ranking follows cosine order for above-floor docs", () => {
    const ranked = rankNew(canonical, VECTOR_ONLY);
    // Only the two above-floor docs are real hits; their order follows cosine.
    expect(ranked.slice(0, 2)).toEqual(["perfect-semantic", "strong-both"]);
    // The two sub-floor docs are non-hits (score 0), so their relative order is
    // not meaningful — just assert they are not ranked as hits.
    expect(computeBaseRelevance(buildSignals(canonical[1], canonical, VECTOR_ONLY))).toBe(0);
    expect(computeBaseRelevance(buildSignals(canonical[3], canonical, VECTOR_ONLY))).toBe(0);
  });

  test("documents below the vector floor are not vector hits", () => {
    const below = buildSignals({ id: "x", cosine: VECTOR_HIT_FLOOR - 0.01, lexical: 0 }, canonical, VECTOR_ONLY);
    expect(below.hasVectorHit).toBe(false);
    expect(computeBaseRelevance(below)).toBe(0);
  });

  // A broader relevance scenario: query "machine learning tutorial".
  test("ranks a realistic mixed result set with relevant docs on top", () => {
    const docs: Doc[] = [
      { id: "ml-tutorial", cosine: 0.78, lexical: 4.0 }, // exact + semantic -> best
      { id: "deep-learning-guide", cosine: 0.66, lexical: 0 }, // semantic, no keyword
      { id: "ml-paper-dense", cosine: 0.58, lexical: 1.2 },
      { id: "cooking-tutorial", cosine: 0.08, lexical: 2.5 }, // "tutorial" coincidence
      { id: "sports-news", cosine: 0.03, lexical: 0 },
      { id: "learning-piano", cosine: 0.18, lexical: 1.0 }, // "learning" coincidence
    ];
    const ranked = rankNew(docs, HYBRID);
    const top3 = new Set(ranked.slice(0, 3));
    expect(top3.has("ml-tutorial")).toBe(true);
    expect(top3.has("deep-learning-guide")).toBe(true);
    expect(top3.has("ml-paper-dense")).toBe(true);
    // Keyword coincidences must not crack the top 3.
    expect(ranked.indexOf("cooking-tutorial")).toBeGreaterThanOrEqual(3);
    expect(ranked.indexOf("learning-piano")).toBeGreaterThanOrEqual(3);
  });
});
