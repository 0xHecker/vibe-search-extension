export type HybridRankHit = {
  hasLexicalHit: boolean;
  hasVectorHit: boolean;
};

export const shouldKeepHybridRankHit = (
  hit: HybridRankHit,
  options: { useLexical: boolean; useVector: boolean; hasPositiveTextTerms: boolean }
): boolean => {
  if (options.useVector && !options.useLexical) return hit.hasVectorHit;
  if (options.useVector && options.useLexical && options.hasPositiveTextTerms) {
    return hit.hasLexicalHit || hit.hasVectorHit;
  }
  return true;
};

// --- Relevance scoring ---
//
// Hybrid search previously fused lexical and vector signals with Reciprocal
// Rank Fusion (RRF). RRF is rank-based, so it discards how *strong* each match
// is: an irrelevant document that merely contains a query keyword lands at
// lexical rank ~1 and inherits a near-top fused score, while a semantically
// excellent document with no keyword overlap is capped low. That made hybrid
// results worse than pure vector search.
//
// We now fuse *normalized magnitudes* with the vector signal weighted higher.
// A keyword coincidence contributes at most `HYBRID_LEXICAL_WEIGHT`, so it can
// no longer outrank a strong semantic match, while documents strong in both
// channels still score highest.

export const HYBRID_VECTOR_WEIGHT = 0.7;
export const HYBRID_LEXICAL_WEIGHT = 0.3;

// Cosine similarities below this are treated as "no vector hit" for filtering
// and scoring. Relevant matches for the IR model sit well above it; this trims
// the long tail of near-orthogonal neighbours without dropping real matches.
export const VECTOR_HIT_FLOOR = 0.15;

export type RankingSignals = {
  useLexical: boolean;
  useVector: boolean;
  hasLexicalHit: boolean;
  hasVectorHit: boolean;
  /** Best cosine similarity across the item's chunks, in [-1, 1]. */
  vectorScore: number;
  /** Raw accumulated FlexSearch score (>= 0). */
  lexicalScore: number;
  /** Max lexical score across the candidate set, for normalization. */
  maxLexicalScore: number;
  /** Count of positive query terms found in the item's text. */
  matchedTermCount: number;
  /** Number of positive query terms in the query. */
  positiveTermCount: number;
};

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

// Cosine -> [0, 1] via ReLU + clamp. Unlike (cos + 1) / 2, this keeps the
// useful positive range spread out (so 0.7 stays 0.7 instead of compressing to
// 0.85) and collapses negative/near-zero similarities to ~0 so they cannot prop
// up a fused score.
export const normalizeVectorScore = (cosine: number): number => clamp01(cosine);

const normalizeLexicalScore = (signals: RankingSignals): number => {
  if (!signals.hasLexicalHit) return 0;
  if (signals.maxLexicalScore > 0 && signals.lexicalScore > 0) {
    return clamp01(signals.lexicalScore / signals.maxLexicalScore);
  }
  // Boolean/term match without a FlexSearch score: fall back to term coverage.
  if (signals.positiveTermCount > 0) {
    return clamp01(signals.matchedTermCount / signals.positiveTermCount);
  }
  return 0;
};

/**
 * Base relevance in [0, 1] for an item, before recency tie-breaking. Pure and
 * deterministic so it can be unit tested and shared by the ranker worker and
 * its in-process fallback.
 */
export const computeBaseRelevance = (signals: RankingSignals): number => {
  const vector = signals.hasVectorHit ? normalizeVectorScore(signals.vectorScore) : 0;
  const lexical = normalizeLexicalScore(signals);

  if (signals.useVector && signals.useLexical) {
    return clamp01(HYBRID_VECTOR_WEIGHT * vector + HYBRID_LEXICAL_WEIGHT * lexical);
  }
  if (signals.useVector) {
    return vector;
  }
  if (signals.useLexical) {
    const coverage =
      signals.positiveTermCount > 0
        ? clamp01(signals.matchedTermCount / signals.positiveTermCount)
        : 0;
    // Lexical-only keeps its term-coverage boost so exact multi-term matches
    // outrank single-term partials.
    return clamp01(lexical * 0.82 + coverage * 0.18);
  }
  return 0;
};
