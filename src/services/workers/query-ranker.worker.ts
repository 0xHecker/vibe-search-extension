/// <reference lib="webworker" />
import type {
  QueryRankDebugScore,
  RankableItem,
  QuerySortBy,
  QuerySortOrder,
  QueryTextExpression,
  RankQueryCursor,
  RankQueryWorkerRequest,
  RankQueryWorkerResponse,
  RankQueryWorkerResult,
} from "@src/search-core/contracts";

const normalizeText = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const recencyBoost = (updatedAt: number, createdAt: number, now: number): number => {
  const reference = Math.max(updatedAt || 0, createdAt || 0);
  if (!reference) return 0;
  const ageDays = Math.max(0, (now - reference) / MS_PER_DAY);
  if (ageDays <= 3) return 0.06;
  if (ageDays >= 180) return 0;
  return (1 - ageDays / 180) * 0.06;
};

const getItemSearchText = (item: RankableItem): string => {
  const mediaText = (item.mediaTypes || []).join(" ");
  return normalizeText(
    [item.title, item.textContent, item.url, item.source, item.authorUsername, mediaText]
      .filter(Boolean)
      .join(" ")
  );
};

const compareByField = (
  a: RankableItem,
  b: RankableItem,
  sortBy: Exclude<QuerySortBy, "relevance">,
  sortOrder: QuerySortOrder
): number => {
  const direction = sortOrder === "asc" ? 1 : -1;

  if (sortBy === "title") {
    return direction * (a.title || "").localeCompare(b.title || "");
  }

  if (sortBy === "source") {
    return direction * (a.source || "").localeCompare(b.source || "");
  }

  const aValue = sortBy === "updatedAt" ? a.updatedAt || 0 : a.createdAt || 0;
  const bValue = sortBy === "updatedAt" ? b.updatedAt || 0 : b.createdAt || 0;
  return direction * (aValue - bValue);
};

const evaluateTextExpression = (itemText: string, node: QueryTextExpression): boolean => {
  if (node.type === "TERM") {
    const value = normalizeText(node.value || "").trim();
    if (!value) return true;
    return itemText.includes(value);
  }

  if (node.type === "NOT") {
    return !evaluateTextExpression(itemText, node.child);
  }

  if (node.type === "AND") {
    return node.children.every((child) => evaluateTextExpression(itemText, child));
  }

  return node.children.some((child) => evaluateTextExpression(itemText, child));
};

const matchesBooleanTerms = (
  itemText: string,
  groups: string[][],
  excludedTerms: string[]
): { matches: boolean; matchedTermCount: number } => {
  for (const excluded of excludedTerms) {
    if (excluded && itemText.includes(normalizeText(excluded))) {
      return { matches: false, matchedTermCount: 0 };
    }
  }

  if (groups.length === 0) {
    return { matches: true, matchedTermCount: 0 };
  }

  for (const group of groups) {
    let groupMatch = true;
    for (const term of group) {
      if (!term || !itemText.includes(normalizeText(term))) {
        groupMatch = false;
        break;
      }
    }
    if (groupMatch) {
      return { matches: true, matchedTermCount: group.length };
    }
  }

  return { matches: false, matchedTermCount: 0 };
};

type RankedEntry = {
  item: RankableItem;
  boolMatch: { matches: boolean; matchedTermCount: number };
  hasLexicalHit: boolean;
  relevance: number;
  hasVectorHit: boolean;
  lexicalScore: number;
  vectorScore: number;
  lexicalRank?: number;
  vectorRank?: number;
};

const compareByRelevance = (
  a: RankedEntry,
  b: RankedEntry,
  sortOrder: QuerySortOrder
): number => {
  const direction = sortOrder === "asc" ? 1 : -1;
  if (a.relevance !== b.relevance) {
    return direction * (a.relevance - b.relevance);
  }
  const createdCompare = (b.item.createdAt || 0) - (a.item.createdAt || 0);
  if (createdCompare !== 0) return createdCompare;
  return a.item.id.localeCompare(b.item.id);
};

const compareRankedEntry = (
  a: RankedEntry,
  b: RankedEntry,
  sortBy: QuerySortBy,
  sortOrder: QuerySortOrder
): number => {
  if (sortBy === "relevance") {
    return compareByRelevance(a, b, sortOrder);
  }

  const compare = compareByField(a.item, b.item, sortBy as Exclude<QuerySortBy, "relevance">, sortOrder);
  if (compare !== 0) return compare;
  return compareByRelevance(a, b, "desc");
};

const selectTopWindow = (
  entries: RankedEntry[],
  windowSize: number,
  compare: (a: RankedEntry, b: RankedEntry) => number
): RankedEntry[] => {
  if (windowSize >= entries.length) {
    return [...entries];
  }

  const heap: RankedEntry[] = [];

  const isWorse = (left: RankedEntry, right: RankedEntry): boolean => compare(left, right) > 0;
  const swap = (i: number, j: number) => {
    const tmp = heap[i];
    heap[i] = heap[j];
    heap[j] = tmp;
  };
  const bubbleUp = (index: number) => {
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!isWorse(heap[i], heap[parent])) break;
      swap(i, parent);
      i = parent;
    }
  };
  const bubbleDown = (index: number) => {
    let i = index;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let worst = i;

      if (left < heap.length && isWorse(heap[left], heap[worst])) {
        worst = left;
      }
      if (right < heap.length && isWorse(heap[right], heap[worst])) {
        worst = right;
      }
      if (worst === i) break;
      swap(i, worst);
      i = worst;
    }
  };

  for (const entry of entries) {
    if (heap.length < windowSize) {
      heap.push(entry);
      bubbleUp(heap.length - 1);
      continue;
    }

    if (compare(entry, heap[0]) < 0) {
      heap[0] = entry;
      bubbleDown(0);
    }
  }

  return heap;
};

const toCursor = (entry: RankedEntry, queryHash: string): RankQueryCursor => ({
  queryHash,
  id: entry.item.id,
  relevance: entry.relevance,
  createdAt: entry.item.createdAt || 0,
  updatedAt: entry.item.updatedAt || 0,
  title: entry.item.title || "",
  source: entry.item.source,
});

const fromCursor = (cursor: RankQueryCursor): RankedEntry => ({
  item: {
    id: cursor.id,
    title: cursor.title || "",
    textContent: "",
    url: "",
    source: cursor.source,
    authorUsername: "",
    mediaTypes: [],
    vector_index: -1,
    createdAt: cursor.createdAt || 0,
    updatedAt: cursor.updatedAt || 0,
  },
  boolMatch: { matches: true, matchedTermCount: 0 },
  hasLexicalHit: false,
  relevance: Number.isFinite(cursor.relevance) ? cursor.relevance : 0,
  hasVectorHit: false,
  lexicalScore: 0,
  vectorScore: 0,
  lexicalRank: undefined,
  vectorRank: undefined,
});

const rank = (request: RankQueryWorkerRequest): RankQueryWorkerResult => {
  const RRF_K = 60;
  const RECENCY_TIE_BREAK_WEIGHT = 0.45;
  const { payload } = request;
  const lexicalScores = new Map(payload.lexicalScores);
  const vectorScoresByIndex = new Map(payload.vectorScoresByIndex);
  const now = Date.now();

  const itemTextCache = new Map<string, string>();
  let maxLexicalScore = 0;
  for (const score of lexicalScores.values()) {
    if (score > maxLexicalScore) maxLexicalScore = score;
  }

  const hasPositiveTextTerms = payload.flatPositiveTerms.length > 0;
  const hasLexicalScores = lexicalScores.size > 0;
  const needsTextEvaluation = payload.hasTextConstraint || (payload.useLexical && !hasLexicalScores);
  const reciprocalRank = (rank?: number): number => (rank ? 1 / (RRF_K + rank) : 0);
  const maxRrfScore = reciprocalRank(1) * 2;
  const lexicalRankById = new Map<string, number>(
    Array.from(lexicalScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id], index) => [id, index + 1])
  );
  const vectorRankByIndex = new Map<number, number>(
    Array.from(vectorScoresByIndex.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([index], rank) => [index, rank + 1])
  );

  const ranked: RankedEntry[] = payload.items.map((item) => {
    let itemText = "";
    let boolMatch: { matches: boolean; matchedTermCount: number } = {
      matches: true,
      matchedTermCount: 0,
    };

    if (needsTextEvaluation) {
      itemText = itemTextCache.get(item.id) || getItemSearchText(item);
      itemTextCache.set(item.id, itemText);

      boolMatch = payload.expression
        ? {
            matches: evaluateTextExpression(itemText, payload.expression),
            matchedTermCount: payload.flatPositiveTerms.reduce((count, term) => {
              const normalizedTerm = normalizeText(term).trim();
              if (!normalizedTerm) return count;
              return itemText.includes(normalizedTerm) ? count + 1 : count;
            }, 0),
          }
        : matchesBooleanTerms(itemText, payload.groups, payload.excludedTerms);
    }

    const lexicalScore = payload.useLexical ? lexicalScores.get(item.id) || 0 : 0;
    const hasLexicalHit = payload.useLexical
      ? hasPositiveTextTerms
        ? lexicalScore > 0 || boolMatch.matchedTermCount > 0
        : boolMatch.matches
      : false;

    const vectorScore =
      typeof item.vector_index === "number" && item.vector_index > -1
        ? vectorScoresByIndex.get(item.vector_index) || 0
        : 0;
    const hasVectorHit =
      typeof item.vector_index === "number" && vectorScoresByIndex.has(item.vector_index);
    const lexicalRank = payload.useLexical ? lexicalRankById.get(item.id) : undefined;
    const vectorRank =
      payload.useVector && typeof item.vector_index === "number" && item.vector_index > -1
        ? vectorRankByIndex.get(item.vector_index)
        : undefined;

    const normalizedTextScore = payload.useLexical
      ? lexicalScore > 0 && maxLexicalScore > 0
        ? Math.min(1, lexicalScore / maxLexicalScore)
        : Math.min(1, boolMatch.matchedTermCount / 4)
      : 0;
    const normalizedVectorScore = hasVectorHit ? (vectorScore + 1) / 2 : 0;
    let baseRelevance = 0;
    if (payload.useVector && payload.useLexical) {
      const lexicalRrf = hasLexicalHit ? reciprocalRank(lexicalRank) : 0;
      const vectorRrf = hasVectorHit ? reciprocalRank(vectorRank) : 0;
      baseRelevance = maxRrfScore > 0 ? (lexicalRrf + vectorRrf) / maxRrfScore : 0;
    } else if (payload.useVector) {
      baseRelevance = normalizedVectorScore;
    } else if (payload.useLexical) {
      const termCoverage = hasPositiveTextTerms
        ? Math.min(1, boolMatch.matchedTermCount / Math.max(1, payload.flatPositiveTerms.length))
        : 0;
      baseRelevance = normalizedTextScore + termCoverage * 0.18;
    }
    const relevance =
      baseRelevance +
      recencyBoost(item.updatedAt || 0, item.createdAt || 0, now) * RECENCY_TIE_BREAK_WEIGHT;

    return {
      item,
      boolMatch,
      hasLexicalHit,
      relevance,
      hasVectorHit,
      lexicalScore,
      vectorScore,
      lexicalRank,
      vectorRank,
    };
  });

  let filtered = ranked;
  if (payload.hasTextConstraint) {
    filtered = ranked.filter((entry) => {
      if (payload.useVector && payload.useLexical) {
        if (!entry.boolMatch.matches) return false;
        if (hasPositiveTextTerms) {
          return entry.hasVectorHit || entry.hasLexicalHit;
        }
        return true;
      }
      if (payload.useVector && !payload.useLexical) {
        if (!entry.boolMatch.matches) return false;
        return hasPositiveTextTerms ? entry.hasVectorHit : true;
      }
      if (payload.useLexical) {
        return entry.boolMatch.matches && entry.hasLexicalHit;
      }
      return entry.boolMatch.matches;
    });
  }
  if (payload.useVector && !payload.useLexical) {
    filtered = filtered.filter((entry) => entry.hasVectorHit);
  }

  let vectorHits = 0;
  let lexicalHits = 0;
  for (const entry of filtered) {
    if (entry.hasVectorHit) vectorHits += 1;
    if (entry.hasLexicalHit) lexicalHits += 1;
  }

  const total = filtered.length;
  const compare = (a: RankedEntry, b: RankedEntry) =>
    compareRankedEntry(a, b, payload.sortBy, payload.sortOrder);

  const hasAfterCursor = !!payload.afterCursor && payload.afterCursor?.queryHash === payload.queryHash;
  const pageBase = hasAfterCursor
    ? (() => {
        const cursorEntry = fromCursor(payload.afterCursor as RankQueryCursor);
        return filtered.filter((entry) => compare(entry, cursorEntry) > 0);
      })()
    : filtered;
  const pageBaseTotal = pageBase.length;
  const offset = hasAfterCursor ? 0 : Math.max(0, (payload.page - 1) * payload.limit);
  const windowSize = hasAfterCursor
    ? Math.min(pageBaseTotal, payload.limit)
    : Math.min(pageBaseTotal, offset + payload.limit);

  let sortedWindow: RankedEntry[] = [];
  if (windowSize > 0) {
    if (windowSize < pageBaseTotal) {
      sortedWindow = selectTopWindow(pageBase, windowSize, compare);
    } else {
      sortedWindow = [...pageBase];
    }
    sortedWindow.sort(compare);
  }

  const paged = sortedWindow.slice(offset, offset + payload.limit);
  const hasMore = hasAfterCursor
    ? pageBaseTotal > payload.limit
    : offset + payload.limit < total;
  const nextCursor =
    hasMore && paged.length > 0 ? toCursor(paged[paged.length - 1], payload.queryHash) : null;
  const debugScores: QueryRankDebugScore[] | undefined =
    payload.includeDebug === true
      ? paged.map((entry, index) => ({
          itemId: entry.item.id,
          rank: hasAfterCursor ? index + 1 : offset + index + 1,
          lexicalScore: entry.lexicalScore || 0,
          vectorScore: entry.vectorScore || 0,
          fusedScore: entry.relevance,
          lexicalRank: entry.lexicalRank,
          vectorRank: entry.vectorRank,
          matchedLexical: entry.hasLexicalHit,
          matchedVector: entry.hasVectorHit,
        }))
      : undefined;

  return {
    itemIds: paged.map((entry) => entry.item.id),
    total,
    vectorHits,
    lexicalHits,
    hasMore,
    nextCursor,
    debugScores,
  };
};

self.onmessage = (event: MessageEvent<RankQueryWorkerRequest>) => {
  const message = event.data;
  if (!message || message.type !== "RANK_QUERY") {
    return;
  }

  const payload = rank(message);
  const response: RankQueryWorkerResponse = {
    type: "RANK_QUERY_RESULT",
    requestId: message.requestId,
    payload,
  };
  self.postMessage(response);
};

export {};
