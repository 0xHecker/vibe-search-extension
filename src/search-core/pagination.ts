/**
 * A space never receives more than this many imported items. Loading that
 * bounded set in one request makes a selected space complete without turning
 * a cross-space/global search into an unbounded query.
 */
export const MAX_GRID_QUERY_LIMIT = 500;

export type LookaheadPage<T> = {
  items: T[];
  hasMore: boolean;
  /**
   * Exact only when this page has no lookahead row. Counting every matching
   * document would make opening a space needlessly expensive.
   */
  total: number;
  totalIsExact: boolean;
};

export const splitLookaheadPage = <T>(
  documents: readonly T[],
  limit: number,
  offset: number
): LookaheadPage<T> => {
  const hasMore = documents.length > limit;
  const items = hasMore ? documents.slice(0, limit) : [...documents];

  return {
    items,
    hasMore,
    total: offset + items.length,
    totalIsExact: !hasMore,
  };
};
