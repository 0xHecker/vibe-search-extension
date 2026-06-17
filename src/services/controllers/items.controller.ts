import { getDb } from "@src/services/DatabaseService";
import { ItemDocType } from "@src/schemas/item_schema";
import { FolderDocType } from "@src/schemas/folder_schema";
import type {
  QueryDebugPayload,
  QueryTextExpression,
  RankQueryCursor,
  RankableItem,
} from "@src/search-core/contracts";
import { v4 as uuidv4 } from "uuid";
import { databaseManager } from "@src/services/db-manager";
import { vectorStoreService } from "@src/services/vector-store.service";
import { localSearchIndexService } from "@src/services/local-search-index.service";
import { PRIVATE_SPACE_ID, PUBLIC_SPACE_ID } from "@src/common/spaces";
import { spaceSessionService } from "@src/services/space-session.service";
import {
  queryRankerService,
  RANK_REQUEST_SUPERSEDED,
  SupersededRankRequestError,
} from "@src/services/query-ranker.service";

type LocalQuerySortBy = "relevance" | "createdAt" | "updatedAt" | "title" | "source";
type LocalQuerySortOrder = "asc" | "desc";
const MAX_VECTOR_TOPK = 4000;
const MAX_LEXICAL_SCORE_BUDGET = 8000;
const MAX_VECTOR_CANDIDATES_FROM_LEXICAL = 3000;
const MAX_RANK_INPUT_ITEMS = 12000;
const MIN_PRUNE_CANDIDATES = 80;
const MIN_SCORE_BUDGET = 600;
const SCORE_BUDGET_MULTIPLIER = 8;
const MAX_RANK_TEXT_CHARS = 6000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LEXICAL_SEARCH_TIMEOUT_MS = 4000;
const VECTOR_SEARCH_TIMEOUT_MS = 3500;
const VECTOR_QUERY_MIN_CHARS = 3;
const VECTOR_MIN_SCORE_VECTOR_ONLY = 0.28;
const VECTOR_MIN_SCORE_HYBRID = 0.2;
const VECTOR_MIN_TOP_SCORE_VECTOR_ONLY = 0.3;
const VECTOR_MIN_TOP_SCORE_HYBRID = 0.24;
const VECTOR_TAIL_DROP_DELTA = 0.18;
const VECTOR_RESERVED_SEMANTIC_CANDIDATES = 700;

type LocalQueryPayload = {
  query?: string;
  text?: {
    groups?: string[][];
    excludedTerms?: string[];
    expression?: QueryTextExpression;
  };
  useKeyword?: boolean;
  useVector?: boolean;
  useFuzzy?: boolean;
  topK?: number;
  pagination?: {
    limit?: number;
    page?: number;
    afterCursor?: RankQueryCursor | null;
  };
  filters?: {
    spaceIds?: string[];
    excludeSpaceIds?: string[];
    folderIds?: string[];
    excludeFolderIds?: string[];
    sources?: ItemDocType["source"][];
    excludeSources?: ItemDocType["source"][];
    favoritesOnly?: boolean;
    tagIds?: string[];
    tagNames?: string[];
    excludeTagNames?: string[];
    domains?: string[];
    excludeDomains?: string[];
    authors?: string[];
    excludeAuthors?: string[];
    hasAny?: Array<"image" | "video" | "media">;
    excludeHasAny?: Array<"image" | "video" | "media">;
    dateFrom?: number;
    dateTo?: number;
    createdFrom?: number;
    createdTo?: number;
    updatedFrom?: number;
    updatedTo?: number;
    likesMin?: number;
    likesMax?: number;
    upvotesMin?: number;
    upvotesMax?: number;
  };
  sort?: {
    by?: LocalQuerySortBy;
    order?: LocalQuerySortOrder;
  };
  accessContext?: {
    activeSpaceId?: string;
    searchScope?: "current" | "global" | "private" | "public";
  };
  debug?: boolean;
};

type LocalQueryResponse = {
  items: ItemDocType[];
  total: number;
  vectorHits: number;
  lexicalHits: number;
  vectorError?: string | null;
  sortBy: LocalQuerySortBy;
  sortOrder: LocalQuerySortOrder;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: RankQueryCursor | null;
  diagnostics?: {
    queryHash: string;
    candidateCount: number;
    rankInputCount: number;
    usedSimpleSortPath: boolean;
    scoreBudget: number;
    supersededCount: number;
    fallbackCount: number;
    selectorMs: number;
    filterMs: number;
    lexicalMs: number;
    vectorMs: number;
    vectorEmbedMs: number;
    vectorScanMs: number;
    rankMs: number;
    hydrateMs: number;
    totalMs: number;
  };
  debug?: QueryDebugPayload;
};

type CandidateLite = {
  id: string;
  spaceId: string;
  folderId: string;
  source: ItemDocType["source"];
  isFavorite: boolean;
  authorUsername: string;
  url: string;
  domain: string | null;
  mediaTypes: Array<"image" | "video">;
  hasMedia: boolean;
  vectorIndex: number;
  vectorIndexes: number[];
  title: string;
  createdAt: number;
  updatedAt: number;
};

type RankedLiteEntry = {
  item: Pick<RankableItem, "id" | "title" | "source" | "createdAt" | "updatedAt">;
  relevance: number;
};

type VectorScoreResult = {
  index: number;
  score: number;
};

export class ItemsController {
  [key: string]: any;
  private rankTelemetry = {
    supersededCount: 0,
    fallbackCount: 0,
  };

  private normalizeUserId(userId: string | null | undefined): string {
    return typeof userId === "string" ? userId : "";
  }

  private assertSpaceUnlocked(spaceId: string): void {
    if (spaceId === PRIVATE_SPACE_ID && !spaceSessionService.isUnlocked(PRIVATE_SPACE_ID)) {
      throw new Error("PRIVATE_SPACE_LOCKED");
    }
  }

  private sanitize<T extends Record<string, any>>(obj: T): T {
    const copy: Record<string, any> = {};
    Object.keys(obj).forEach((k) => {
      const v = (obj as any)[k];
      if (v !== undefined) copy[k] = v;
    });
    return copy as T;
  }

  markSearchIndexDirty() {
    localSearchIndexService.markDirty();
  }

  scheduleSearchIndexSync(changedItemIds?: string[]) {
    localSearchIndexService.scheduleItemSync(changedItemIds);
  }

  private tokenizeQuery(query: string): string[] {
    return query
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private normalizeText(input: string): string {
    return input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  private stableHash(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  private buildQueryHash(payload: {
    query: string;
    expression?: QueryTextExpression;
    groups: string[][];
    excludedTerms: string[];
    filters: LocalQueryPayload["filters"];
    accessContext?: LocalQueryPayload["accessContext"];
    sortBy: LocalQuerySortBy;
    sortOrder: LocalQuerySortOrder;
    useKeyword: boolean;
    useVector: boolean;
    useFuzzy: boolean;
  }): string {
    const normalizedPayload = {
      query: payload.query,
      expression: payload.expression || null,
      groups: payload.groups,
      excludedTerms: payload.excludedTerms,
      filters: payload.filters || {},
      accessContext: payload.accessContext || {},
      sortBy: payload.sortBy,
      sortOrder: payload.sortOrder,
      useKeyword: payload.useKeyword,
      useVector: payload.useVector,
      useFuzzy: payload.useFuzzy,
    };
    return this.stableHash(JSON.stringify(normalizedPayload));
  }

  private getItemSearchText(item: ItemDocType | RankableItem): string {
    const mediaText =
      "mediaTypes" in item
        ? (item.mediaTypes || []).join(" ")
        : (item.media || []).map((entry) => entry.type).join(" ");
    return this.normalizeText(
      [item.title, item.textContent, item.ocrText, item.url, item.source, item.authorUsername, mediaText]
        .filter(Boolean)
        .join(" ")
    );
  }

  private recencyBoost(updatedAt: number, createdAt: number, now: number): number {
    const reference = Math.max(updatedAt || 0, createdAt || 0);
    if (!reference) return 0;
    const ageDays = Math.max(0, (now - reference) / MS_PER_DAY);
    if (ageDays <= 3) return 0.06;
    if (ageDays >= 180) return 0;
    return (1 - ageDays / 180) * 0.06;
  }

  private toRankableItem(item: CandidateLite, textContent: string, ocrText: string): RankableItem {
    return {
      id: item.id,
      title: item.title || "",
      textContent: (textContent || "").slice(0, MAX_RANK_TEXT_CHARS),
      ocrText: (ocrText || "").slice(0, MAX_RANK_TEXT_CHARS),
      url: item.url || "",
      source: item.source,
      authorUsername: item.authorUsername,
      mediaTypes: item.mediaTypes,
      vector_index: item.vectorIndex,
      vector_indexes: item.vectorIndexes,
      createdAt: item.createdAt || 0,
      updatedAt: item.updatedAt || 0,
    };
  }

  private sanitizeVectorIndexes(raw: unknown, fallback: number): number[] {
    const indexes = Array.isArray(raw) ? raw : [];
    const normalized = indexes
      .filter((index): index is number => Number.isInteger(index) && index >= 0);
    if (normalized.length === 0 && fallback >= 0) normalized.push(fallback);
    return Array.from(new Set(normalized));
  }

  private toCandidateLite(doc: any): CandidateLite {
    const media = (doc.get("media") as ItemDocType["media"] | undefined) || [];
    const mediaTypes = Array.from(
      new Set(
        media
          .map((entry) => entry.type)
          .filter((type): type is "image" | "video" => type === "image" || type === "video")
      )
    );
    const url = (doc.get("url") as string | undefined) || "";
    const vectorIndexRaw = doc.get("vector_index");
    const vectorIndex =
      typeof vectorIndexRaw === "number" && Number.isInteger(vectorIndexRaw) && vectorIndexRaw >= 0
        ? vectorIndexRaw
        : -1;
    const vectorIndexes = this.sanitizeVectorIndexes(doc.get("vector_indexes"), vectorIndex);

    return {
      id: (doc.get("id") as string) || "",
      spaceId: (doc.get("spaceId") as string) || PUBLIC_SPACE_ID,
      folderId: (doc.get("folderId") as string) || "",
      source: ((doc.get("source") as ItemDocType["source"] | undefined) || "web") as ItemDocType["source"],
      isFavorite: !!doc.get("isFavorite"),
      authorUsername: ((doc.get("authorUsername") as string | undefined) || "").toLowerCase(),
      url,
      domain: this.parseHostname(url),
      mediaTypes,
      hasMedia: media.length > 0,
      vectorIndex,
      vectorIndexes,
      title: (doc.get("title") as string | undefined) || "",
      createdAt: (doc.get("createdAt") as number | undefined) || 0,
      updatedAt: (doc.get("updatedAt") as number | undefined) || 0,
    };
  }

  private async hydrateItemsByIds(db: any, itemIds: string[]): Promise<ItemDocType[]> {
    if (itemIds.length === 0) return [];
    const docsById = await db.items.findByIds(itemIds).exec();
    return itemIds
      .map((id) => {
        const doc = docsById.get(id);
        if (!doc) return null;
        return doc.toMutableJSON() as ItemDocType;
      })
      .filter((item): item is ItemDocType => !!item);
  }

  private matchesBooleanTerms(
    itemText: string,
    groups: string[][],
    excludedTerms: string[]
  ): { matches: boolean; matchedTermCount: number } {
    for (const excluded of excludedTerms) {
      if (excluded && itemText.includes(this.normalizeText(excluded))) {
        return { matches: false, matchedTermCount: 0 };
      }
    }

    if (groups.length === 0) {
      return { matches: true, matchedTermCount: 0 };
    }

    for (const group of groups) {
      let groupMatch = true;
      for (const term of group) {
        if (!term || !itemText.includes(this.normalizeText(term))) {
          groupMatch = false;
          break;
        }
      }
      if (groupMatch) {
        return { matches: true, matchedTermCount: group.length };
      }
    }

    return { matches: false, matchedTermCount: 0 };
  }

  private evaluateTextExpression(itemText: string, node: QueryTextExpression): boolean {
    if (node.type === "TERM") {
      const value = this.normalizeText(node.value || "").trim();
      if (!value) return true;
      return itemText.includes(value);
    }

    if (node.type === "NOT") {
      return !this.evaluateTextExpression(itemText, node.child);
    }

    if (node.type === "AND") {
      return node.children.every((child) => this.evaluateTextExpression(itemText, child));
    }

    return node.children.some((child) => this.evaluateTextExpression(itemText, child));
  }

  private collectPositiveExpressionTerms(
    node: QueryTextExpression,
    isNegated = false,
    result: string[] = []
  ): string[] {
    if (node.type === "TERM") {
      if (!isNegated && node.value.trim()) {
        result.push(node.value.trim());
      }
      return result;
    }

    if (node.type === "NOT") {
      return this.collectPositiveExpressionTerms(node.child, !isNegated, result);
    }

    for (const child of node.children) {
      this.collectPositiveExpressionTerms(child, isNegated, result);
    }
    return result;
  }

  private compareByRelevance(
    a: RankedLiteEntry,
    b: RankedLiteEntry,
    sortOrder: LocalQuerySortOrder
  ): number {
    const direction = sortOrder === "asc" ? 1 : -1;
    if (a.relevance !== b.relevance) {
      return direction * (a.relevance - b.relevance);
    }
    const createdCompare = (b.item.createdAt || 0) - (a.item.createdAt || 0);
    if (createdCompare !== 0) return createdCompare;
    return a.item.id.localeCompare(b.item.id);
  }

  private toRankCursor(entry: RankedLiteEntry, queryHash: string): RankQueryCursor {
    return {
      queryHash,
      id: entry.item.id,
      relevance: entry.relevance,
      createdAt: entry.item.createdAt || 0,
      updatedAt: entry.item.updatedAt || 0,
      title: entry.item.title || "",
      source: entry.item.source,
    };
  }

  private sampleSemanticReserveIndices(indices: number[], limit: number): number[] {
    if (indices.length <= limit) {
      return indices;
    }

    const sampled: number[] = [];
    const step = indices.length / limit;
    for (let i = 0; i < limit; i += 1) {
      const index = Math.min(indices.length - 1, Math.floor(i * step));
      sampled.push(indices[index]);
    }
    return Array.from(new Set(sampled));
  }

  private pruneVectorResults(
    results: VectorScoreResult[],
    useLexical: boolean
  ): {
    pruned: VectorScoreResult[];
    topScore: number;
    minAcceptedScore: number;
  } {
    if (results.length === 0) {
      return {
        pruned: [],
        topScore: Number.NEGATIVE_INFINITY,
        minAcceptedScore: Number.POSITIVE_INFINITY,
      };
    }

    const topScore = results[0]?.score ?? Number.NEGATIVE_INFINITY;
    const minTopScore = useLexical
      ? VECTOR_MIN_TOP_SCORE_HYBRID
      : VECTOR_MIN_TOP_SCORE_VECTOR_ONLY;
    if (topScore < minTopScore) {
      return {
        pruned: [],
        topScore,
        minAcceptedScore: minTopScore,
      };
    }

    const minAcceptedScore = Math.max(
      useLexical ? VECTOR_MIN_SCORE_HYBRID : VECTOR_MIN_SCORE_VECTOR_ONLY,
      topScore - VECTOR_TAIL_DROP_DELTA
    );
    const pruned = results.filter((result) => result.score >= minAcceptedScore);
    return {
      pruned,
      topScore,
      minAcceptedScore,
    };
  }

  private rankLocally(args: {
    items: RankableItem[];
    expression?: QueryTextExpression;
    groups: string[][];
    excludedTerms: string[];
    flatPositiveTerms: string[];
    hasTextConstraint: boolean;
    useLexical: boolean;
    useVector: boolean;
    sortBy: LocalQuerySortBy;
    sortOrder: LocalQuerySortOrder;
    page: number;
    limit: number;
    queryHash: string;
    afterCursor?: RankQueryCursor | null;
    lexicalScores: Map<string, number>;
    vectorScoresByIndex: Map<number, number>;
    includeDebug?: boolean;
  }): {
    itemIds: string[];
    total: number;
    vectorHits: number;
    lexicalHits: number;
    hasMore: boolean;
    nextCursor?: RankQueryCursor | null;
    debugScores?: QueryDebugPayload["perItem"];
  } {
    const RRF_K = 60;
    const RECENCY_TIE_BREAK_WEIGHT = 0.45;
    const hasPositiveTextTerms = args.flatPositiveTerms.length > 0;
    const hasLexicalScores = args.lexicalScores.size > 0;
    const needsTextEvaluation = args.hasTextConstraint || (args.useLexical && !hasLexicalScores);
    const itemTextCache = new Map<string, string>();
    const now = Date.now();
    const maxLexicalScore = (() => {
      let max = 0;
      for (const score of args.lexicalScores.values()) {
        if (score > max) max = score;
      }
      return max;
    })();
    const reciprocalRank = (rank?: number): number => (rank ? 1 / (RRF_K + rank) : 0);
    const maxRrfScore = reciprocalRank(1) * 2;
    const lexicalRankById = new Map<string, number>(
      Array.from(args.lexicalScores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id], index) => [id, index + 1])
    );
    const vectorRankByIndex = new Map<number, number>(
      Array.from(args.vectorScoresByIndex.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([index], rank) => [index, rank + 1])
    );
    const getBestVectorHit = (item: RankableItem): { score: number; rank?: number; hasHit: boolean } => {
      const fallback =
        typeof item.vector_index === "number" && Number.isInteger(item.vector_index) ? item.vector_index : -1;
      const indexes = this.sanitizeVectorIndexes(item.vector_indexes, fallback);
      let bestScore = 0;
      let bestRank: number | undefined;
      let hasHit = false;
      for (const index of indexes) {
        if (!args.vectorScoresByIndex.has(index)) continue;
        const score = args.vectorScoresByIndex.get(index) || 0;
        const rank = vectorRankByIndex.get(index);
        if (!hasHit || score > bestScore) {
          bestScore = score;
          bestRank = rank;
          hasHit = true;
        }
      }
      return { score: bestScore, rank: bestRank, hasHit };
    };

    const ranked = args.items.map((item) => {
      let itemText = "";
      let boolMatch: { matches: boolean; matchedTermCount: number } = {
        matches: true,
        matchedTermCount: 0,
      };

      if (needsTextEvaluation) {
        itemText = itemTextCache.get(item.id) || this.getItemSearchText(item);
        itemTextCache.set(item.id, itemText);

        boolMatch = args.expression
          ? {
              matches: this.evaluateTextExpression(itemText, args.expression),
              matchedTermCount: args.flatPositiveTerms.reduce((count, term) => {
                const normalizedTerm = this.normalizeText(term).trim();
                if (!normalizedTerm) return count;
                return itemText.includes(normalizedTerm) ? count + 1 : count;
              }, 0),
            }
          : this.matchesBooleanTerms(itemText, args.groups, args.excludedTerms);
      }

      const lexicalScore = args.useLexical ? args.lexicalScores.get(item.id) || 0 : 0;
      const hasLexicalHit = args.useLexical
        ? hasPositiveTextTerms
          ? lexicalScore > 0 || boolMatch.matchedTermCount > 0
          : boolMatch.matches
        : false;

      const vectorHit = getBestVectorHit(item);
      const vectorScore = vectorHit.score;
      const hasVectorHit = vectorHit.hasHit;
      const lexicalRank = args.useLexical ? lexicalRankById.get(item.id) : undefined;
      const vectorRank = args.useVector ? vectorHit.rank : undefined;

      const normalizedTextScore = args.useLexical
        ? lexicalScore > 0 && maxLexicalScore > 0
          ? Math.min(1, lexicalScore / maxLexicalScore)
          : Math.min(1, boolMatch.matchedTermCount / 4)
        : 0;
      const normalizedVectorScore = hasVectorHit ? (vectorScore + 1) / 2 : 0;
      let baseRelevance = 0;
      if (args.useVector && args.useLexical) {
        const lexicalRrf = hasLexicalHit ? reciprocalRank(lexicalRank) : 0;
        const vectorRrf = hasVectorHit ? reciprocalRank(vectorRank) : 0;
        baseRelevance = maxRrfScore > 0 ? (lexicalRrf + vectorRrf) / maxRrfScore : 0;
      } else if (args.useVector) {
        baseRelevance = normalizedVectorScore;
      } else if (args.useLexical) {
        const termCoverage = hasPositiveTextTerms
          ? Math.min(1, boolMatch.matchedTermCount / Math.max(1, args.flatPositiveTerms.length))
          : 0;
        baseRelevance = normalizedTextScore + termCoverage * 0.18;
      }
      const recencyTieBreak =
        this.recencyBoost(item.updatedAt || 0, item.createdAt || 0, now) *
        RECENCY_TIE_BREAK_WEIGHT;
      const relevance = baseRelevance + recencyTieBreak;

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
    if (args.hasTextConstraint) {
      filtered = ranked.filter((entry) => {
        if (args.useVector && args.useLexical) {
          if (!entry.boolMatch.matches) return false;
          if (hasPositiveTextTerms) {
            return entry.hasVectorHit || entry.hasLexicalHit;
          }
          return true;
        }
        if (args.useVector && !args.useLexical) {
          if (!entry.boolMatch.matches) return false;
          return hasPositiveTextTerms ? entry.hasVectorHit : true;
        }
        if (args.useLexical) {
          return entry.boolMatch.matches && entry.hasLexicalHit;
        }
        return entry.boolMatch.matches;
      });
    }
    if (args.useVector && !args.useLexical) {
      filtered = filtered.filter((entry) => entry.hasVectorHit);
    }

    const compareEntries = (
      a: { item: RankableItem; relevance: number },
      b: { item: RankableItem; relevance: number }
    ) => {
      if (args.sortBy === "relevance") {
        return this.compareByRelevance(a, b, args.sortOrder);
      }
      const fieldSortBy: Exclude<LocalQuerySortBy, "relevance"> = args.sortBy;
      const byField = this.compareByField(a.item, b.item, fieldSortBy, args.sortOrder);
      if (byField !== 0) return byField;
      return this.compareByRelevance(a, b, "desc");
    };

    filtered.sort(compareEntries);

    const hasAfterCursor = !!args.afterCursor && args.afterCursor?.queryHash === args.queryHash;
    const pageBase = hasAfterCursor
      ? (() => {
          const cursor = args.afterCursor as RankQueryCursor;
          const cursorComparable = {
            item: {
              id: cursor.id,
              title: cursor.title || "",
              textContent: "",
              ocrText: "",
              url: "",
              source: cursor.source,
              authorUsername: "",
              mediaTypes: [],
              vector_index: -1,
              vector_indexes: [],
              createdAt: cursor.createdAt || 0,
              updatedAt: cursor.updatedAt || 0,
            } as RankableItem,
            relevance: Number.isFinite(cursor.relevance) ? cursor.relevance : 0,
            boolMatch: { matches: true, matchedTermCount: 0 },
            hasLexicalHit: false,
            hasVectorHit: false,
          };
          return filtered.filter((entry) => compareEntries(entry, cursorComparable) > 0);
        })()
      : filtered;

    const total = filtered.length;
    const pageBaseTotal = pageBase.length;
    const offset = hasAfterCursor ? 0 : Math.max(0, (args.page - 1) * args.limit);
    const paged = pageBase.slice(offset, offset + args.limit);
    const hasMore = hasAfterCursor ? pageBaseTotal > args.limit : offset + args.limit < total;
    const nextCursor =
      hasMore && paged.length > 0
        ? this.toRankCursor({
            item: paged[paged.length - 1].item,
            relevance: paged[paged.length - 1].relevance,
          }, args.queryHash)
        : null;

    let vectorHits = 0;
    let lexicalHits = 0;
    for (const entry of filtered) {
      if (entry.hasVectorHit) vectorHits += 1;
      if (entry.hasLexicalHit) lexicalHits += 1;
    }

    const debugScores =
      args.includeDebug === true
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
  }

  private compareByField(
    a: Pick<RankableItem, "id" | "title" | "source" | "createdAt" | "updatedAt">,
    b: Pick<RankableItem, "id" | "title" | "source" | "createdAt" | "updatedAt">,
    sortBy: Exclude<LocalQuerySortBy, "relevance">,
    sortOrder: LocalQuerySortOrder
  ): number {
    const direction = sortOrder === "asc" ? 1 : -1;

    if (sortBy === "title") {
      const compare = direction * (a.title || "").localeCompare(b.title || "");
      if (compare !== 0) return compare;
      return a.id.localeCompare(b.id);
    }

    if (sortBy === "source") {
      const compare = direction * (a.source || "").localeCompare(b.source || "");
      if (compare !== 0) return compare;
      return a.id.localeCompare(b.id);
    }

    const aValue = sortBy === "updatedAt" ? a.updatedAt || 0 : a.createdAt || 0;
    const bValue = sortBy === "updatedAt" ? b.updatedAt || 0 : b.createdAt || 0;
    const compare = direction * (aValue - bValue);
    if (compare !== 0) return compare;
    return a.id.localeCompare(b.id);
  }

  async saveFetchedMetadata(payload: {
    metaMap: Record<string, Partial<ItemDocType>>;
  }): Promise<{ updated: number }> {
    const db = await getDb();
    const { metaMap } = payload;
    const urls = Object.keys(metaMap);
    if (urls.length === 0) return { updated: 0 };

    const itemsToUpdate = await db.items.find({ selector: { url: { $in: urls } } }).exec();

    for (const item of itemsToUpdate) {
      const MAX_TRIES = 5;
      let attempt = 0;

      while (attempt < MAX_TRIES) {
        attempt += 1;
        const fresh = await db.items.findOne(item.primary).exec();
        if (!fresh) break;

        const meta = metaMap[fresh.get("url") as string];
        const current = fresh.toMutableJSON() as ItemDocType;

        const patchData: Partial<ItemDocType> = {};
        if (!meta) {
          patchData.isMetaFetched = true;
        } else {
          const m = this.sanitize(meta);
          let embeddingRelevantChanged = false;

          if (m.title !== undefined && m.title !== current.title) {
            patchData.title = m.title as ItemDocType["title"];
            embeddingRelevantChanged = true;
          }

          if (m.textContent !== undefined) {
            if (m.textContent !== current.textContent) {
              patchData.textContent = m.textContent as ItemDocType["textContent"];
              embeddingRelevantChanged = true;
            }
          }

          if (m.iconUrl !== undefined) patchData.iconUrl = m.iconUrl as ItemDocType["iconUrl"];
          if (m.displayImageUrl !== undefined && !current.displayImageUrl) {
            patchData.displayImageUrl = m.displayImageUrl as ItemDocType["displayImageUrl"];
          }
          if (m.source && m.source !== current.source) {
            patchData.source = m.source as ItemDocType["source"];
            embeddingRelevantChanged = true;
          }
          if (m.authorUsername !== undefined) {
            patchData.authorUsername = m.authorUsername as ItemDocType["authorUsername"];
          }
          if (typeof m.updatedAt === "number" && m.updatedAt > 0) {
            patchData.updatedAt = m.updatedAt;
          }
          if (m.media !== undefined) patchData.media = m.media as ItemDocType["media"];

          if (embeddingRelevantChanged) {
            patchData.isDirty = true;
          }

          patchData.isMetaFetched = true;
        }

        try {
          await fresh.patch(patchData);
          break;
        } catch (e: any) {
          // 409 conflict -> retry with next revision; otherwise rethrow
          const status = e?.status ?? e?.rxdb?.status ?? e?.parameters?.writeError?.status;
          if (status !== 409) throw e;
          continue;
        }
      }
    }

    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}

    // Trigger embedding for newly updated items
    try {
      chrome.runtime.sendMessage({
        type: "TRIGGER_EMBEDDING",
        target: "offscreen",
        isForwarded: true,
      });
    } catch {}

    return { updated: itemsToUpdate.length };
  }

  private normalizeUrl(input: string): string | null {
    if (!input) return null;
    const tryMake = (raw: string) => {
      try {
        const u = new URL(raw);
        if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
        return null;
      } catch {
        return null;
      }
    };
    // already absolute?
    const first = tryMake(input);
    if (first) return first;
    return tryMake(`https://${input}`);
  }

  private parseHostname(input: string): string | null {
    try {
      return new URL(input).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private async resolveAllowedSpaceIds(
    db: any,
    payload: LocalQueryPayload
  ): Promise<string[]> {
    const activeSpaceId = payload.accessContext?.activeSpaceId || PUBLIC_SPACE_ID;
    const requestedScope = payload.accessContext?.searchScope || "current";
    const privateUnlocked = spaceSessionService.isUnlocked(PRIVATE_SPACE_ID);

    const spaceDocs = await db.spaces.find({ selector: { isArchived: { $eq: false } } }).exec();
    const spaces = spaceDocs.map((doc: any) => doc.toMutableJSON() as any);
    const allSpaceIds = spaces.map((space: any) => space.id as string);
    const nonPrivateSpaceIds = spaces
      .filter((space: any) => !space.isPrivate)
      .map((space: any) => space.id as string);
    const hasActiveSpace = spaces.some((space: any) => space.id === activeSpaceId);
    const safeActiveSpaceId = hasActiveSpace ? activeSpaceId : PUBLIC_SPACE_ID;
    const fallbackPublic = nonPrivateSpaceIds.length > 0 ? nonPrivateSpaceIds : [PUBLIC_SPACE_ID];
    const fallbackAll = allSpaceIds.length > 0 ? allSpaceIds : fallbackPublic;

    if (requestedScope === "global") {
      return privateUnlocked ? fallbackAll : fallbackPublic;
    }

    if (requestedScope === "public") {
      return fallbackPublic;
    }

    if (requestedScope === "private") {
      return privateUnlocked ? [PRIVATE_SPACE_ID] : [];
    }

    if (safeActiveSpaceId === PRIVATE_SPACE_ID) {
      return privateUnlocked ? [PRIVATE_SPACE_ID] : [];
    }
    return [safeActiveSpaceId];
  }

  private async resolveFolderSpaceId(
    db: any,
    folderId: string,
    options?: { allowLockedPrivateWrite?: boolean }
  ): Promise<string> {
    const folderDoc = await db.folders.findOne(folderId).exec();
    if (!folderDoc) {
      throw new Error("FOLDER_NOT_FOUND");
    }
    const folderSpaceId = (folderDoc.get("spaceId") as string | undefined) || PUBLIC_SPACE_ID;
    const bypassLockCheck = options?.allowLockedPrivateWrite === true && folderSpaceId === PRIVATE_SPACE_ID;
    if (!bypassLockCheck) {
      this.assertSpaceUnlocked(folderSpaceId);
    }
    return folderSpaceId;
  }

  private folderMirrorKey(folder: Pick<FolderDocType, "name" | "type" | "isPinned" | "isLocked" | "isCollapsed">): string {
    return [
      (folder.name || "").trim().toLowerCase(),
      folder.type || "folder",
      folder.isPinned ? "1" : "0",
      folder.isLocked ? "1" : "0",
      folder.isCollapsed ? "1" : "0",
    ].join("::");
  }

  async moveToSpace(payload: {
    itemIds: string[];
    targetSpaceId: string;
  }): Promise<{ updated: number; createdFolders: number }> {
    const db = await getDb();
    const itemIds = Array.from(new Set((payload.itemIds || []).filter(Boolean)));
    const targetSpaceId = (payload.targetSpaceId || "").trim();
    if (itemIds.length === 0 || !targetSpaceId) {
      return { updated: 0, createdFolders: 0 };
    }

    const targetSpaceDoc = await db.spaces.findOne(targetSpaceId).exec();
    if (!targetSpaceDoc) {
      throw new Error("TARGET_SPACE_NOT_FOUND");
    }
    if (targetSpaceDoc.get("isArchived") === true) {
      throw new Error("TARGET_SPACE_ARCHIVED");
    }
    this.assertSpaceUnlocked(targetSpaceId);

    const itemDocsById = await db.items.findByIds(itemIds).exec();
    const sourceItems = itemIds
      .map((id) => itemDocsById.get(id))
      .filter((doc): doc is any => !!doc)
      .map((doc) => doc.toMutableJSON() as ItemDocType)
      .filter((item) => (item.deletedAt || 0) === 0);
    if (sourceItems.length === 0) {
      return { updated: 0, createdFolders: 0 };
    }

    for (const item of sourceItems) {
      this.assertSpaceUnlocked(item.spaceId || PUBLIC_SPACE_ID);
    }

    const sourceFolderIds = Array.from(new Set(sourceItems.map((item) => item.folderId).filter(Boolean)));
    const sourceFolderDocs = await db.folders.findByIds(sourceFolderIds).exec();
    const sourceFoldersById = new Map<string, FolderDocType>();
    for (const [folderId, folderDoc] of sourceFolderDocs.entries()) {
      const folder = folderDoc.toMutableJSON() as FolderDocType;
      this.assertSpaceUnlocked(folder.spaceId || PUBLIC_SPACE_ID);
      sourceFoldersById.set(folderId, folder);
    }

    const targetFolderDocs = await db.folders.find({ selector: { spaceId: { $eq: targetSpaceId } } }).exec();
    const targetFolderByMirrorKey = new Map<string, string>();
    let maxSortOrder = 0;
    for (const doc of targetFolderDocs) {
      const folder = doc.toMutableJSON() as FolderDocType;
      const sortOrder = folder.sortOrder ?? 0;
      if (sortOrder > maxSortOrder) maxSortOrder = sortOrder;
      const key = this.folderMirrorKey(folder);
      if (!targetFolderByMirrorKey.has(key)) {
        targetFolderByMirrorKey.set(key, folder.id);
      }
    }

    const now = Date.now();
    const sourceToTargetFolderId = new Map<string, string>();
    const foldersToInsert: FolderDocType[] = [];
    let createdFolders = 0;

    for (const sourceFolderId of sourceFolderIds) {
      const sourceFolder = sourceFoldersById.get(sourceFolderId);
      if (!sourceFolder) continue;

      if ((sourceFolder.spaceId || PUBLIC_SPACE_ID) === targetSpaceId) {
        sourceToTargetFolderId.set(sourceFolderId, sourceFolderId);
        continue;
      }

      const mirrorKey = this.folderMirrorKey(sourceFolder);
      const existingTargetFolderId = targetFolderByMirrorKey.get(mirrorKey);
      if (existingTargetFolderId) {
        sourceToTargetFolderId.set(sourceFolderId, existingTargetFolderId);
        continue;
      }

      maxSortOrder += 1;
      const clonedFolder: FolderDocType = {
        id: uuidv4(),
        name: sourceFolder.name,
        userId: this.normalizeUserId(sourceFolder.userId),
        spaceId: targetSpaceId,
        parentId: null,
        type: sourceFolder.type || "folder",
        sortOrder: maxSortOrder,
        isLocked: !!sourceFolder.isLocked,
        isPinned: !!sourceFolder.isPinned,
        isCollapsed: !!sourceFolder.isCollapsed,
        isDirty: false,
        serverVersion: 0,
        createdAt: sourceFolder.createdAt || now,
        updatedAt: now,
      };
      foldersToInsert.push(clonedFolder);
      createdFolders += 1;
      sourceToTargetFolderId.set(sourceFolderId, clonedFolder.id);
      targetFolderByMirrorKey.set(mirrorKey, clonedFolder.id);
    }

    if (foldersToInsert.length > 0) {
      const insertResult = await db.folders.bulkInsert(foldersToInsert);
      if (insertResult.error.length > 0) {
        throw new Error(`Failed to create ${insertResult.error.length} destination folders.`);
      }
    }

    const targetFolderIds = Array.from(new Set(Array.from(sourceToTargetFolderId.values())));
    const existingTargetItems =
      targetFolderIds.length > 0
        ? await db.items
            .find({
              selector: {
                folderId: { $in: targetFolderIds },
                deletedAt: { $eq: 0 },
              },
            })
            .exec()
        : [];
    const maxChunkOrderByFolderId = new Map<string, number>();
    for (const doc of existingTargetItems) {
      const folderId = (doc.get("folderId") as string | undefined) || "";
      const chunkOrder = (doc.get("chunkOrder") as number | undefined) ?? -1;
      const current = maxChunkOrderByFolderId.get(folderId) ?? -1;
      if (chunkOrder > current) {
        maxChunkOrderByFolderId.set(folderId, chunkOrder);
      }
    }

    const itemsBySourceFolder = new Map<string, ItemDocType[]>();
    for (const item of sourceItems) {
      const list = itemsBySourceFolder.get(item.folderId) || [];
      list.push(item);
      itemsBySourceFolder.set(item.folderId, list);
    }

    const itemUpdates: ItemDocType[] = [];
    for (const [sourceFolderId, folderItems] of itemsBySourceFolder.entries()) {
      const targetFolderId = sourceToTargetFolderId.get(sourceFolderId);
      if (!targetFolderId) continue;

      const ordered = [...folderItems].sort((a, b) => {
        const ao = a.chunkOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.chunkOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.createdAt - b.createdAt;
      });

      let nextOrder = (maxChunkOrderByFolderId.get(targetFolderId) ?? -1) + 1;
      for (const item of ordered) {
        if (
          (item.spaceId || PUBLIC_SPACE_ID) === targetSpaceId &&
          item.folderId === targetFolderId
        ) {
          continue;
        }
        itemUpdates.push({
          ...item,
          userId: this.normalizeUserId(item.userId),
          folderId: targetFolderId,
          spaceId: targetSpaceId,
          chunkOrder: nextOrder,
          updatedAt: now,
        });
        nextOrder += 1;
      }
      maxChunkOrderByFolderId.set(targetFolderId, nextOrder - 1);
    }

    if (itemUpdates.length > 0) {
      await db.items.bulkUpsert(itemUpdates);
    }

    if (createdFolders > 0) {
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
      } catch {}
    }
    if (itemUpdates.length > 0) {
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
      } catch {}
    }

    return {
      updated: itemUpdates.length,
      createdFolders,
    };
  }

  async queryLocal(payload: LocalQueryPayload): Promise<LocalQueryResponse> {
    const now = () =>
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    const startedAt = now();
    let selectorMs = 0;
    let filterMs = 0;
    let lexicalMs = 0;
    let vectorMs = 0;
    let vectorEmbedMs = 0;
    let vectorScanMs = 0;
    let rankMs = 0;
    let hydrateMs = 0;
    let rankInputCount = 0;
    let usedSimpleSortPath = false;

    const db = await getDb();
    const query = (payload.query || "").trim();
    const fallbackTerms = this.tokenizeQuery(query);
    const expression = payload.text?.expression;
    const groups =
      payload.text?.groups?.map((group) => group.map((term) => term.trim()).filter(Boolean)).filter((group) => group.length > 0) ||
      [];
    const excludedTerms =
      payload.text?.excludedTerms?.map((term) => term.trim()).filter(Boolean) || [];
    const normalizedGroups = groups.length > 0 ? groups : fallbackTerms.length > 0 ? [fallbackTerms] : [];
    const expressionPositiveTerms = expression
      ? Array.from(new Set(this.collectPositiveExpressionTerms(expression)))
      : [];
    const flatPositiveTerms = Array.from(
      new Set(expressionPositiveTerms.length > 0 ? expressionPositiveTerms : normalizedGroups.flat())
    );
    const useKeyword = payload.useKeyword !== false;
    const useFuzzy = payload.useFuzzy === true;
    const useLexical = useKeyword || useFuzzy;
    const useVectorRequested = payload.useVector === true;
    const includeDebug = payload.debug === true;
    const vectorQuery = flatPositiveTerms.length > 0 ? flatPositiveTerms.join(" ") : query;
    const useVector = useVectorRequested && vectorQuery.trim().length >= VECTOR_QUERY_MIN_CHARS;
    const filters = payload.filters || {};
    const baseAllowedSpaceIds = await this.resolveAllowedSpaceIds(db, payload);
    const includeSpaceFilters = Array.from(new Set((filters.spaceIds || []).filter(Boolean)));
    const excludeSpaceFilters = new Set((filters.excludeSpaceIds || []).filter(Boolean));
    let allowedSpaceIds = includeSpaceFilters.length
      ? baseAllowedSpaceIds.filter((spaceId) => includeSpaceFilters.includes(spaceId))
      : baseAllowedSpaceIds;
    if (excludeSpaceFilters.size > 0) {
      allowedSpaceIds = allowedSpaceIds.filter((spaceId) => !excludeSpaceFilters.has(spaceId));
    }
    allowedSpaceIds = Array.from(new Set(allowedSpaceIds));

    const sortBy: LocalQuerySortBy =
      payload.sort?.by || (flatPositiveTerms.length > 0 || query.length > 0 ? "relevance" : "createdAt");
    const sortOrder: LocalQuerySortOrder =
      payload.sort?.order || (sortBy === "title" || sortBy === "source" ? "asc" : "desc");
    const page = Math.max(1, payload.pagination?.page || 1);
    const rawAfterCursor = payload.pagination?.afterCursor || null;
    const limit = Math.max(1, Math.min(payload.pagination?.limit || payload.topK || 100, 500));
    const scoreBudget = Math.max(
      MIN_SCORE_BUDGET,
      payload.topK || MIN_SCORE_BUDGET,
      limit * SCORE_BUDGET_MULTIPLIER
    );
    const lexicalScoreLimit = Math.min(MAX_LEXICAL_SCORE_BUDGET, scoreBudget);
    const vectorTopKLimit = Math.min(MAX_VECTOR_TOPK, scoreBudget);
    const queryHash = this.buildQueryHash({
      query: query,
      expression,
      groups: normalizedGroups,
      excludedTerms,
      filters,
      accessContext: payload.accessContext,
      sortBy,
      sortOrder,
      useKeyword,
      useVector,
      useFuzzy,
    });
    const afterCursor =
      rawAfterCursor && rawAfterCursor.queryHash === queryHash ? rawAfterCursor : null;

    if (allowedSpaceIds.length === 0) {
      return {
        items: [],
        total: 0,
        vectorHits: 0,
        lexicalHits: 0,
        vectorError: null,
        sortBy,
        sortOrder,
        page,
        limit,
        hasMore: false,
        nextCursor: null,
        diagnostics: {
          queryHash,
          candidateCount: 0,
          rankInputCount: 0,
          usedSimpleSortPath: false,
          scoreBudget,
          supersededCount: this.rankTelemetry.supersededCount,
          fallbackCount: this.rankTelemetry.fallbackCount,
          selectorMs,
          filterMs,
          lexicalMs,
          vectorMs,
          vectorEmbedMs,
          vectorScanMs,
          rankMs,
          hydrateMs,
          totalMs: now() - startedAt,
        },
      };
    }

    const selector: Record<string, any> = { deletedAt: { $eq: 0 } };
    selector.spaceId = { $in: allowedSpaceIds };
    if (filters.folderIds && filters.folderIds.length > 0) {
      selector.folderId = { $in: filters.folderIds.filter(Boolean) };
    }
    if (filters.sources && filters.sources.length > 0) {
      selector.source = { $in: filters.sources };
    }
    if (filters.favoritesOnly === true) {
      selector.isFavorite = { $eq: true };
    }
    const createdFrom =
      typeof filters.createdFrom === "number" ? filters.createdFrom : filters.dateFrom;
    const createdTo = typeof filters.createdTo === "number" ? filters.createdTo : filters.dateTo;
    if (typeof createdFrom === "number" || typeof createdTo === "number") {
      const createdAt: Record<string, number> = {};
      if (typeof createdFrom === "number") {
        createdAt.$gte = createdFrom;
      }
      if (typeof createdTo === "number") {
        createdAt.$lte = createdTo;
      }
      selector.createdAt = createdAt;
    }
    if (typeof filters.updatedFrom === "number" || typeof filters.updatedTo === "number") {
      const updatedAt: Record<string, number> = {};
      if (typeof filters.updatedFrom === "number") {
        updatedAt.$gte = filters.updatedFrom;
      }
      if (typeof filters.updatedTo === "number") {
        updatedAt.$lte = filters.updatedTo;
      }
      selector.updatedAt = updatedAt;
    }
    if (typeof filters.likesMin === "number" || typeof filters.likesMax === "number") {
      const likes: Record<string, number> = {};
      if (typeof filters.likesMin === "number") likes.$gte = filters.likesMin;
      if (typeof filters.likesMax === "number") likes.$lte = filters.likesMax;
      selector.likes = likes;
    }
    if (typeof filters.upvotesMin === "number" || typeof filters.upvotesMax === "number") {
      const upvotes: Record<string, number> = {};
      if (typeof filters.upvotesMin === "number") upvotes.$gte = filters.upvotesMin;
      if (typeof filters.upvotesMax === "number") upvotes.$lte = filters.upvotesMax;
      selector.upvotes = upvotes;
    }

    const hasExplicitTextConstraint = !!expression || excludedTerms.length > 0;
    const hasImplicitTextConstraint = normalizedGroups.length > 0 || query.length > 0;
    const lexicalQuery = useLexical ? vectorQuery : "";

    let lexicalScores = new Map<string, number>();
    if (useLexical && lexicalQuery) {
      const lexicalStartedAt = now();
      try {
        lexicalScores = await this.withTimeout(
          localSearchIndexService.search({
            query: lexicalQuery,
            limit: lexicalScoreLimit,
            keyword: useKeyword,
            fuzzy: useFuzzy,
          }),
          LEXICAL_SEARCH_TIMEOUT_MS,
          `Lexical search timed out after ${LEXICAL_SEARCH_TIMEOUT_MS}ms.`
        );
      } catch (error) {
        console.error("FlexSearch query failed in queryLocal:", error);
      } finally {
        lexicalMs = now() - lexicalStartedAt;
      }
    }

    const useLexicalFirstSelector =
      useLexical && !useVector && lexicalQuery.length > 0 && lexicalScores.size > 0;
    if (useLexicalFirstSelector) {
      selector.id = { $in: Array.from(lexicalScores.keys()) };
    }

    const selectorStartedAt = now();
    const docs = await db.items.find({ selector }).exec();
    const docById = new Map<string, any>();
    let candidates: CandidateLite[] = [];
    for (const doc of docs) {
      const candidate = this.toCandidateLite(doc);
      if (!candidate.id) continue;
      docById.set(candidate.id, doc);
      candidates.push(candidate);
    }
    selectorMs = now() - selectorStartedAt;

    const hydrateFromDocMap = async (itemIds: string[]): Promise<ItemDocType[]> => {
      if (itemIds.length === 0) return [];
      const itemById = new Map<string, ItemDocType>();
      const missingIds: string[] = [];
      for (const id of itemIds) {
        const doc = docById.get(id);
        if (!doc) {
          missingIds.push(id);
          continue;
        }
        itemById.set(id, doc.toMutableJSON() as ItemDocType);
      }
      if (missingIds.length > 0) {
        const missingById = await db.items.findByIds(missingIds).exec();
        for (const id of missingIds) {
          const doc = missingById.get(id);
          if (!doc) continue;
          itemById.set(id, doc.toMutableJSON() as ItemDocType);
        }
      }
      return itemIds
        .map((id) => itemById.get(id) || null)
        .filter((item): item is ItemDocType => !!item);
    };

    const filterStartedAt = now();
    if (filters.excludeFolderIds && filters.excludeFolderIds.length > 0) {
      const excluded = new Set(filters.excludeFolderIds.filter(Boolean));
      candidates = candidates.filter((item) => !excluded.has(item.folderId));
    }

    if (filters.excludeSources && filters.excludeSources.length > 0) {
      const excluded = new Set(filters.excludeSources);
      candidates = candidates.filter((item) => !excluded.has(item.source));
    }

    if (filters.authors && filters.authors.length > 0) {
      const includedAuthors = new Set(filters.authors.map((author) => author.toLowerCase()));
      candidates = candidates.filter(
        (item) => item.authorUsername.length > 0 && includedAuthors.has(item.authorUsername)
      );
    }

    if (filters.excludeAuthors && filters.excludeAuthors.length > 0) {
      const excludedAuthors = new Set(filters.excludeAuthors.map((author) => author.toLowerCase()));
      candidates = candidates.filter(
        (item) => item.authorUsername.length === 0 || !excludedAuthors.has(item.authorUsername)
      );
    }

    if (filters.domains && filters.domains.length > 0) {
      const includedDomains = new Set(filters.domains.map((domain) => domain.toLowerCase()));
      candidates = candidates.filter((item) => !!item.domain && includedDomains.has(item.domain));
    }

    if (filters.excludeDomains && filters.excludeDomains.length > 0) {
      const excludedDomains = new Set(filters.excludeDomains.map((domain) => domain.toLowerCase()));
      candidates = candidates.filter((item) => !item.domain || !excludedDomains.has(item.domain));
    }

    if (filters.hasAny && filters.hasAny.length > 0) {
      const required = new Set(filters.hasAny);
      candidates = candidates.filter((item) => {
        if (required.has("media") && !item.hasMedia) return false;
        if (required.has("image") && !item.mediaTypes.includes("image")) return false;
        if (required.has("video") && !item.mediaTypes.includes("video")) return false;
        return true;
      });
    }

    if (filters.excludeHasAny && filters.excludeHasAny.length > 0) {
      const excluded = new Set(filters.excludeHasAny);
      candidates = candidates.filter((item) => {
        if (excluded.has("media") && item.hasMedia) return false;
        if (excluded.has("image") && item.mediaTypes.includes("image")) return false;
        if (excluded.has("video") && item.mediaTypes.includes("video")) return false;
        return true;
      });
    }

    const requestedTagIds = (filters.tagIds || []).filter(Boolean);
    const requestedTagNames = (filters.tagNames || []).map((name) => name.toLowerCase()).filter(Boolean);
    const excludedTagNames = (filters.excludeTagNames || [])
      .map((name) => name.toLowerCase())
      .filter(Boolean);

    let tagIds = requestedTagIds;
    const needsTagNameLookup = requestedTagNames.length > 0 || excludedTagNames.length > 0;
    let allTags: any[] = [];
    if (needsTagNameLookup) {
      allTags = await db.tags.find().exec();
    }

    if (requestedTagNames.length > 0) {
      const requestedSet = new Set(requestedTagNames);
      const idsByName = allTags
        .filter((tag) => requestedSet.has((tag.get("name") as string).toLowerCase()))
        .map((tag) => tag.get("id") as string);
      tagIds = Array.from(new Set([...tagIds, ...idsByName]));
    }

    let excludedTagIds: string[] = [];
    if (excludedTagNames.length > 0) {
      const excludedSet = new Set(excludedTagNames);
      excludedTagIds = allTags
        .filter((tag) => excludedSet.has((tag.get("name") as string).toLowerCase()))
        .map((tag) => tag.get("id") as string);
    }

    if (tagIds.length > 0) {
      const uniqueTagIds = Array.from(new Set(tagIds));
      const joins = await db.item_tags.find({ selector: { tagId: { $in: uniqueTagIds } } }).exec();
      const tagsByItemId = new Map<string, Set<string>>();

      for (const join of joins) {
        const itemId = join.get("itemId") as string;
        const tagId = join.get("tagId") as string;
        const set = tagsByItemId.get(itemId) || new Set<string>();
        set.add(tagId);
        tagsByItemId.set(itemId, set);
      }

      candidates = candidates.filter((item) => {
        const itemTagSet = tagsByItemId.get(item.id);
        if (!itemTagSet) return false;
        return uniqueTagIds.every((tagId) => itemTagSet.has(tagId));
      });
    }

    if (excludedTagIds.length > 0) {
      const excludedSet = new Set(excludedTagIds);
      const joins = await db.item_tags
        .find({ selector: { tagId: { $in: Array.from(excludedSet) } } })
        .exec();
      const excludedItemIds = new Set(joins.map((join) => join.get("itemId") as string));
      candidates = candidates.filter((item) => !excludedItemIds.has(item.id));
    }
    filterMs = now() - filterStartedAt;

    if (candidates.length === 0) {
      return {
        items: [],
        total: 0,
        vectorHits: 0,
        lexicalHits: 0,
        vectorError: null,
        sortBy,
        sortOrder,
        page,
        limit,
        hasMore: false,
        nextCursor: null,
        diagnostics: {
          queryHash,
          candidateCount: 0,
          rankInputCount: 0,
          usedSimpleSortPath: false,
          scoreBudget,
          supersededCount: this.rankTelemetry.supersededCount,
          fallbackCount: this.rankTelemetry.fallbackCount,
          selectorMs,
          filterMs,
          lexicalMs,
          vectorMs,
          vectorEmbedMs,
          vectorScanMs,
          rankMs,
          hydrateMs,
          totalMs: now() - startedAt,
        },
      };
    }

    const candidateIdSet = new Set(candidates.map((item) => item.id));

    if (lexicalScores.size > 0) {
      const filteredLexicalScores = new Map<string, number>();
      for (const [id, score] of lexicalScores.entries()) {
        if (candidateIdSet.has(id)) {
          filteredLexicalScores.set(id, score);
        }
      }
      lexicalScores = filteredLexicalScores;
    }

    const effectiveHasTextConstraint =
      hasExplicitTextConstraint ||
      (!useVector && useLexical && hasImplicitTextConstraint && lexicalScores.size === 0);

    let vectorError: string | null = null;
    let vectorScoresByIndex = new Map<number, number>();
    let vectorTopHits: QueryDebugPayload["vectorTopHits"] = [];
    let vectorTopScore: number | null = null;
    let vectorMinAcceptedScore: number | null = null;
    let rawVectorHitCount = 0;

    if (useVector) {
      const vectorStartedAt = now();
      const allCandidateIndices = Array.from(
        new Set(candidates.flatMap((item) => item.vectorIndexes).filter((index) => index >= 0))
      );
      let candidateIndices = allCandidateIndices;

      if (lexicalScores.size > 0 && allCandidateIndices.length > MAX_VECTOR_CANDIDATES_FROM_LEXICAL) {
        const lexicalTopIds = Array.from(lexicalScores.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_VECTOR_CANDIDATES_FROM_LEXICAL)
          .map(([id]) => id);
        const lexicalTopSet = new Set(lexicalTopIds);
        const lexicalCandidateIndices = Array.from(
          new Set(
            candidates
              .filter((item) => lexicalTopSet.has(item.id))
              .flatMap((item) => item.vectorIndexes)
              .filter((index) => index >= 0)
          )
        );
        const semanticReservedIndices = Array.from(
          new Set(
            this.sampleSemanticReserveIndices(
              [...allCandidateIndices].sort((a, b) => a - b),
              VECTOR_RESERVED_SEMANTIC_CANDIDATES
            )
          )
        );
        if (lexicalCandidateIndices.length > 0) {
          candidateIndices = Array.from(
            new Set([...lexicalCandidateIndices, ...semanticReservedIndices])
          );
        }
      }

      if (candidateIndices.length > 0) {
        try {
          const requestedTopK = Math.max(
            1,
            Math.min(
              vectorTopKLimit,
              candidateIndices.length
            )
          );
          const vectorSearch = await this.withTimeout(
            vectorStoreService.search({
              query: vectorQuery,
              topK: requestedTopK,
              candidateIndices,
            }),
            VECTOR_SEARCH_TIMEOUT_MS,
            `Vector search timed out after ${VECTOR_SEARCH_TIMEOUT_MS}ms.`
          );
          vectorEmbedMs = vectorSearch.timings.embeddingMs;
          vectorScanMs = vectorSearch.timings.scanMs;
          const rawVectorResults = vectorSearch.results;
          rawVectorHitCount = rawVectorResults.length;
          const vectorPrune = this.pruneVectorResults(rawVectorResults, useLexical);
          vectorTopScore = Number.isFinite(vectorPrune.topScore) ? vectorPrune.topScore : null;
          vectorMinAcceptedScore = Number.isFinite(vectorPrune.minAcceptedScore)
            ? vectorPrune.minAcceptedScore
            : null;
          const prunedVectorResults = vectorPrune.pruned;
          vectorScoresByIndex = new Map(
            prunedVectorResults.map((result) => [result.index, result.score])
          );
          if (includeDebug) {
            const candidateByVectorIndex = new Map<number, CandidateLite>(
              candidates.flatMap((item) => item.vectorIndexes.map((index) => [index, item] as [number, CandidateLite]))
            );
            vectorTopHits = prunedVectorResults.slice(0, 12).map((entry) => {
              const candidate = candidateByVectorIndex.get(entry.index);
              return {
                index: entry.index,
                score: entry.score,
                itemId: candidate?.id,
                title: candidate?.title || "",
              };
            });
          }
        } catch (error) {
          vectorError = error instanceof Error ? error.message : "Vector search failed";
          console.error("Vector search failed in queryLocal:", error);
        }
      }
      vectorMs = now() - vectorStartedAt;
    }

    const canUseSimpleFieldSortPath =
      !effectiveHasTextConstraint && !useVector && sortBy !== "relevance";
    if (canUseSimpleFieldSortPath) {
      usedSimpleSortPath = true;
      const fieldSortBy = sortBy as Exclude<LocalQuerySortBy, "relevance">;
      candidates.sort((a, b) => this.compareByField(a, b, fieldSortBy, sortOrder));
      const total = candidates.length;
      const hasAfterCursor = !!afterCursor;
      const pageBase = hasAfterCursor
        ? candidates.filter((entry) => {
            const cursor = afterCursor as RankQueryCursor;
            return (
              this.compareByField(
                entry,
                {
                  id: cursor.id,
                  title: cursor.title || "",
                  source: cursor.source,
                  createdAt: cursor.createdAt || 0,
                  updatedAt: cursor.updatedAt || 0,
                },
                fieldSortBy,
                sortOrder
              ) > 0
            );
          })
        : candidates;
      const offset = hasAfterCursor ? 0 : Math.max(0, (page - 1) * limit);
      const pagedSlice = pageBase.slice(offset, offset + limit);
      const pagedIds = pagedSlice.map((entry) => entry.id);
      const hydrateStartedAt = now();
      const items = await hydrateFromDocMap(pagedIds);
      hydrateMs = now() - hydrateStartedAt;
      const hasMore = hasAfterCursor ? pageBase.length > limit : offset + limit < total;
      const nextCursor =
        hasMore && pagedSlice.length > 0
          ? ({
              queryHash,
              id: pagedSlice[pagedSlice.length - 1].id,
              relevance: 0,
              createdAt: pagedSlice[pagedSlice.length - 1].createdAt || 0,
              updatedAt: pagedSlice[pagedSlice.length - 1].updatedAt || 0,
              title: pagedSlice[pagedSlice.length - 1].title || "",
              source: pagedSlice[pagedSlice.length - 1].source,
            } as RankQueryCursor)
          : null;
      return {
        items,
        total,
        vectorHits: 0,
        lexicalHits: 0,
        vectorError,
        sortBy,
        sortOrder,
        page,
        limit,
        hasMore,
        nextCursor,
        diagnostics: {
          queryHash,
          candidateCount: candidates.length,
          rankInputCount: 0,
          usedSimpleSortPath,
          scoreBudget,
          supersededCount: this.rankTelemetry.supersededCount,
          fallbackCount: this.rankTelemetry.fallbackCount,
          selectorMs,
          filterMs,
          lexicalMs,
          vectorMs,
          vectorEmbedMs,
          vectorScanMs,
          rankMs,
          hydrateMs,
          totalMs: now() - startedAt,
        },
      };
    }

    let itemsForRanking = candidates;
    const canPruneRankInput =
      candidates.length > MAX_RANK_INPUT_ITEMS &&
      ((effectiveHasTextConstraint && !expression && excludedTerms.length === 0) ||
        (useVector && !hasExplicitTextConstraint));
    if (canPruneRankInput && (lexicalScores.size > 0 || vectorScoresByIndex.size > 0)) {
      const candidateIds = new Set<string>();
      for (const [id] of lexicalScores.entries()) {
        candidateIds.add(id);
      }

      if (vectorScoresByIndex.size > 0) {
        const idByVectorIndex = new Map<number, string>();
        for (const item of candidates) {
          for (const index of item.vectorIndexes) {
            idByVectorIndex.set(index, item.id);
          }
        }
        for (const [vectorIndex] of vectorScoresByIndex.entries()) {
          const id = idByVectorIndex.get(vectorIndex);
          if (id) candidateIds.add(id);
        }
      }

      if (candidateIds.size >= Math.min(Math.max(limit * 2, MIN_PRUNE_CANDIDATES), candidates.length)) {
        itemsForRanking = candidates.filter((item) => candidateIds.has(item.id));
      }
    }

    const needsTextForRanking =
      effectiveHasTextConstraint || (useLexical && lexicalScores.size === 0);
    const rankableItems = itemsForRanking.map((item) => {
      const doc = docById.get(item.id);
      const textContent = needsTextForRanking
        ? (doc?.get("textContent") as string | undefined) || ""
        : "";
      const ocrText = needsTextForRanking
        ? (doc?.get("ocrText") as string | undefined) || ""
        : "";
      return this.toRankableItem(item, textContent, ocrText);
    });
    rankInputCount = rankableItems.length;

    let rankedItemIds: string[] = [];
    let rankTotal = 0;
    let rankVectorHits = 0;
    let rankLexicalHits = 0;
    let rankHasMore = false;
    let rankNextCursor: RankQueryCursor | null = null;
    let rankDebugScores: QueryDebugPayload["perItem"] | undefined;

    const rankStartedAt = now();
    try {
      const rankResult = await queryRankerService.rank({
        items: rankableItems,
        expression,
        groups: normalizedGroups,
        excludedTerms,
        flatPositiveTerms,
        hasTextConstraint: effectiveHasTextConstraint,
        useLexical,
        useVector,
        sortBy,
        sortOrder,
        page,
        limit,
        queryHash,
        afterCursor,
        lexicalScores: Array.from(lexicalScores.entries()),
        vectorScoresByIndex: Array.from(vectorScoresByIndex.entries()),
        includeDebug,
      });

      rankedItemIds = rankResult.itemIds;
      rankTotal = rankResult.total;
      rankVectorHits = rankResult.vectorHits;
      rankLexicalHits = rankResult.lexicalHits;
      rankHasMore = rankResult.hasMore;
      rankNextCursor = rankResult.nextCursor || null;
      rankDebugScores = rankResult.debugScores;
    } catch (error) {
      if (
        error instanceof SupersededRankRequestError ||
        error instanceof Error &&
        (error.message === RANK_REQUEST_SUPERSEDED || error.name === RANK_REQUEST_SUPERSEDED)
      ) {
        this.rankTelemetry.supersededCount += 1;
        throw error;
      }
      console.warn("[ItemsController] Query rank worker failed, using local fallback.", error);
      this.rankTelemetry.fallbackCount += 1;
      const fallback = this.rankLocally({
        items: rankableItems,
        expression,
        groups: normalizedGroups,
        excludedTerms,
        flatPositiveTerms,
        hasTextConstraint: effectiveHasTextConstraint,
        useLexical,
        useVector,
        sortBy,
        sortOrder,
        page,
        limit,
        queryHash,
        afterCursor,
        lexicalScores,
        vectorScoresByIndex,
        includeDebug,
      });

      rankedItemIds = fallback.itemIds;
      rankTotal = fallback.total;
      rankVectorHits = fallback.vectorHits;
      rankLexicalHits = fallback.lexicalHits;
      rankHasMore = fallback.hasMore;
      rankNextCursor = fallback.nextCursor || null;
      rankDebugScores = fallback.debugScores;
    } finally {
      rankMs = now() - rankStartedAt;
    }

    const hydrateStartedAt = now();
    const rankedItems = await hydrateFromDocMap(rankedItemIds);
    hydrateMs = now() - hydrateStartedAt;

    return {
      items: rankedItems,
      total: rankTotal,
      vectorHits: rankVectorHits,
      lexicalHits: rankLexicalHits,
      vectorError,
      sortBy,
      sortOrder,
      page,
      limit,
      hasMore: rankHasMore,
      nextCursor: rankNextCursor,
      diagnostics: {
        queryHash,
        candidateCount: candidates.length,
        rankInputCount,
        usedSimpleSortPath,
        scoreBudget,
        supersededCount: this.rankTelemetry.supersededCount,
        fallbackCount: this.rankTelemetry.fallbackCount,
        selectorMs,
        filterMs,
        lexicalMs,
        vectorMs,
        vectorEmbedMs,
        vectorScanMs,
        rankMs,
        hydrateMs,
        totalMs: now() - startedAt,
      },
      debug: includeDebug
        ? {
            queryHash,
            perItem: rankDebugScores || [],
            vectorTopHits,
            vectorStats: useVector
              ? {
                  candidateCount: Array.from(
                    new Set(candidates.flatMap((item) => item.vectorIndexes).filter((index) => index >= 0))
                  ).length,
                  rawHitCount: rawVectorHitCount,
                  keptHitCount: vectorScoresByIndex.size,
                  topScore: vectorTopScore,
                  minAcceptedScore: vectorMinAcceptedScore,
                  mode: useLexical ? "hybrid" : "vector",
                }
              : undefined,
          }
        : undefined,
    };
  }

  async addToFolder(payload: {
    folderId: string;
    url: string;
    title?: string;
    userId?: string | null;
    iconUrl?: string;
    displayImageUrl?: string;
    textContent?: string;
    source?: ItemDocType["source"];
    authorUsername?: string;
    likes?: number;
    upvotes?: number;
    media?: ItemDocType["media"];
    ocrText?: string;
    ocrStatus?: ItemDocType["ocrStatus"];
    ocrConfidence?: number | null;
    ocrLineCount?: number;
    ocrModelVersion?: string;
    ocrSourceHash?: string;
    isMetaFetched?: boolean;
    isDirty?: boolean;
    shouldFetchMetadata?: boolean;
    allowLockedPrivateWrite?: boolean;
    parentId?: string | null;
    chunkOrder?: number;
    createdAt?: number;
    updatedAt?: number;
  }): Promise<ItemDocType> {
    const db = await getDb();
    const now = Date.now();
    const createdAt = payload.createdAt ?? now;
    const updatedAt = payload.updatedAt ?? createdAt;
    const folderSpaceId = await this.resolveFolderSpaceId(db, payload.folderId, {
      allowLockedPrivateWrite: payload.allowLockedPrivateWrite === true,
    });
    const normalizedUrl = this.normalizeUrl(payload.url);
    if (!normalizedUrl) {
      throw new Error("INVALID_URL");
    }

    const base: ItemDocType = {
      id: uuidv4(),
      userId: this.normalizeUserId(payload.userId),
      title: (payload.title || normalizedUrl).slice(0, 80),
      textContent: payload.textContent ?? "",
      url: normalizedUrl,
      source: payload.source ?? "web",
      folderId: payload.folderId,
      spaceId: folderSpaceId,
      isFavorite: false,
      authorUsername: payload.authorUsername,
      likes: payload.likes,
      upvotes: payload.upvotes,
      media: payload.media,
      displayImageUrl: payload.displayImageUrl,
      parentId: payload.parentId ?? null,
      chunkOrder: payload.chunkOrder ?? createdAt,
      vector_index: -1,
      vector_indexes: [],
      ocrText: payload.ocrText,
      ocrStatus: payload.ocrStatus ?? "pending",
      ocrConfidence: payload.ocrConfidence,
      ocrLineCount: payload.ocrLineCount,
      ocrModelVersion: payload.ocrModelVersion ?? "",
      ocrSourceHash: payload.ocrSourceHash,
      ocrUpdatedAt: payload.ocrStatus ? updatedAt : 0,
      isEmbedded: false,
      isMetaFetched: payload.isMetaFetched ?? false,
      isDirty: payload.isDirty ?? true,
      serverVersion: 0,
      createdAt,
      updatedAt,
      deletedAt: 0,
    };
    const item = this.sanitize({
      ...base,
      iconUrl: payload.iconUrl,
    });
    await db.items.insert(item as any);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    try {
      if (payload.shouldFetchMetadata !== false) {
        chrome.runtime.sendMessage({
          type: "FETCH_METADATA",
          payload: { urls: [normalizedUrl], revalidate: false },
          target: "background",
        });
      }
    } catch {}
    // Trigger embedding immediately
    try {
      chrome.runtime.sendMessage({
        type: "TRIGGER_EMBEDDING",
        target: "offscreen",
        isForwarded: true,
      });
    } catch {}
    return item as ItemDocType;
  }

  async addMany(payload: { items: ItemDocType[] }): Promise<{ inserted: number }> {
    const db = await getDb();
    if (!payload.items?.length) return { inserted: 0 };

    const folderIds = Array.from(new Set(payload.items.map((item) => item.folderId).filter(Boolean)));
    const folderDocs =
      folderIds.length > 0
        ? await db.folders.find({ selector: { id: { $in: folderIds } } }).exec()
        : [];
    const folderSpaceById = new Map<string, string>();
    for (const folderDoc of folderDocs) {
      folderSpaceById.set(
        folderDoc.get("id") as string,
        (folderDoc.get("spaceId") as string | undefined) || PUBLIC_SPACE_ID
      );
    }

    const toInsert = payload.items.map((item) => {
      const targetSpaceId = folderSpaceById.get(item.folderId) || item.spaceId || PUBLIC_SPACE_ID;
      this.assertSpaceUnlocked(targetSpaceId);
      return {
        ...item,
        userId: this.normalizeUserId(item.userId),
        spaceId: targetSpaceId,
        isMetaFetched: false,
      };
    });

    const result = await db.items.bulkInsert(toInsert);
    if (result.error.length > 0) {
      throw new Error(`Failed to insert ${result.error.length} items.`);
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}

    // Trigger metadata fetch for all newly inserted URLs
    const urlsToFetch = toInsert.map((item) => item.url).filter((url): url is string => !!url);
    if (urlsToFetch.length > 0) {
      try {
        chrome.runtime.sendMessage({
          type: "FETCH_METADATA",
          payload: { urls: urlsToFetch, revalidate: false },
          target: "background",
        });
      } catch {}
    }

    // Trigger embedding immediately for new items
    try {
      chrome.runtime.sendMessage({
        type: "TRIGGER_EMBEDDING",
        target: "offscreen",
        isForwarded: true,
      });
    } catch {}

    return { inserted: toInsert.length };
  }

  async refetchMetadata(itemIds: string[]): Promise<void> {
    const db = await getDb();
    const itemsToRefetch = await db.items.findByIds(itemIds).exec();
    const items = Array.from(itemsToRefetch.values()).filter((doc) => {
      const spaceId = (doc.get("spaceId") as string | undefined) || PUBLIC_SPACE_ID;
      return spaceId !== PRIVATE_SPACE_ID || spaceSessionService.isUnlocked(PRIVATE_SPACE_ID);
    });
    if (items.length === 0) return;

    const urls = items.map((i) => i.url);
    chrome.runtime.sendMessage({
      type: "FETCH_METADATA",
      payload: { urls, revalidate: true },
      target: "background",
    });
  }

  async moveToFolder(payload: {
    itemIds: string[];
    targetFolderId: string;
  }): Promise<{ updated: number }> {
    const db = await getDb();
    const targetFolderId = (payload.targetFolderId || "").trim();
    const itemIds = Array.from(new Set((payload.itemIds || []).filter(Boolean)));

    if (!targetFolderId || itemIds.length === 0) {
      return { updated: 0 };
    }
    const targetFolderDoc = await db.folders.findOne(targetFolderId).exec();
    if (!targetFolderDoc) {
      throw new Error("TARGET_FOLDER_NOT_FOUND");
    }
    const targetSpaceId = (targetFolderDoc.get("spaceId") as string | undefined) || PUBLIC_SPACE_ID;
    this.assertSpaceUnlocked(targetSpaceId);

    const targetDocs = await db.items
      .find({ selector: { folderId: { $eq: targetFolderId }, deletedAt: { $eq: 0 } } })
      .exec();

    const maxTargetOrder = targetDocs.reduce((max, doc) => {
      const chunkOrder = (doc.get("chunkOrder") as number | undefined) ?? -1;
      return Math.max(max, chunkOrder);
    }, -1);

    let nextTargetOrder = maxTargetOrder + 1;
    let updated = 0;
    const affectedSourceFolders = new Set<string>();

    for (const id of itemIds) {
      const doc = await db.items.findOne(id).exec();
      if (!doc) continue;

      const current = doc.toMutableJSON() as ItemDocType;
      if (current.deletedAt !== 0) continue;
      this.assertSpaceUnlocked(current.spaceId || PUBLIC_SPACE_ID);
      if (current.folderId !== targetFolderId) {
        affectedSourceFolders.add(current.folderId);
      }

      const desiredOrder = current.folderId === targetFolderId ? current.chunkOrder : nextTargetOrder;
      if (
        current.folderId !== targetFolderId ||
        current.chunkOrder !== desiredOrder ||
        current.spaceId !== targetSpaceId
      ) {
        await doc.patch({
          folderId: targetFolderId,
          spaceId: targetSpaceId,
          chunkOrder: desiredOrder,
          updatedAt: Date.now(),
        });
        updated++;
      }

      if (current.folderId !== targetFolderId) {
        nextTargetOrder += 1;
      }
    }

    // Normalize source folder ordering after moving items out.
    for (const sourceFolderId of affectedSourceFolders) {
      const sourceDocs = await db.items
        .find({ selector: { folderId: { $eq: sourceFolderId }, deletedAt: { $eq: 0 } } })
        .exec();
      const ordered = sourceDocs
        .map((doc) => doc.toMutableJSON() as ItemDocType)
        .sort((a, b) => {
          const ao = a.chunkOrder ?? Number.MAX_SAFE_INTEGER;
          const bo = b.chunkOrder ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return b.createdAt - a.createdAt;
        });

      for (let i = 0; i < ordered.length; i++) {
        const item = ordered[i];
        if (item.chunkOrder === i) continue;
        const doc = await db.items.findOne(item.id).exec();
        if (!doc) continue;
        await doc.patch({ chunkOrder: i, updatedAt: Date.now() });
        updated++;
      }
    }

    if (updated > 0) {
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
      } catch {}
    }

    return { updated };
  }

  async reorder(payload: {
    folders: { folderId: string; orderedIds: string[] }[];
  }): Promise<{ updated: number }> {
    const db = await getDb();
    let updated = 0;

    for (const entry of payload.folders || []) {
      const { folderId, orderedIds } = entry;
      if (!folderId) continue;
      const folderDoc = await db.folders.findOne(folderId).exec();
      if (!folderDoc) continue;
      const folderSpaceId = (folderDoc.get("spaceId") as string | undefined) || PUBLIC_SPACE_ID;
      this.assertSpaceUnlocked(folderSpaceId);
      const docs = await db.items
        .find({ selector: { folderId: { $eq: folderId }, deletedAt: { $eq: 0 } } })
        .exec();
      const allIds = docs.map((d) => d.primary);
      const remainder = allIds.filter((id) => !orderedIds.includes(id));
      const finalOrder = [...orderedIds, ...remainder];

      for (let i = 0; i < finalOrder.length; i++) {
        const id = finalOrder[i];
        const doc = await db.items.findOne(id).exec();
        if (!doc) continue;
        const current = doc.toMutableJSON() as ItemDocType;
        const needsPatch =
          current.folderId !== folderId || current.chunkOrder !== i || current.spaceId !== folderSpaceId;
        if (needsPatch) {
          await doc.patch({ folderId, spaceId: folderSpaceId, chunkOrder: i, updatedAt: Date.now() });
          updated++;
        }
      }
    }

    if (updated > 0) {
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
      } catch {}
    }

    return { updated };
  }

  async delete(payload: {
    id: string;
    scope?: "current" | "all";
  }): Promise<{ success: boolean; error?: string }> {
    const db = await getDb();
    const doc = await db.items.findOne(payload.id).exec();
    if (!doc) {
      return { success: false, error: "NOT_FOUND" };
    }

    const item = doc.toMutableJSON();
    this.assertSpaceUnlocked((item.spaceId as string | undefined) || PUBLIC_SPACE_ID);
    const idsToDelete = new Set<string>([payload.id]);

    if (payload.scope === "all") {
      const siblings = await db.items
        .find({ selector: { url: { $eq: item.url }, deletedAt: { $eq: 0 } } })
        .exec();
      for (const sibling of siblings) {
        const siblingSpaceId = (sibling.get("spaceId") as string | undefined) || PUBLIC_SPACE_ID;
        if (siblingSpaceId === PRIVATE_SPACE_ID && !spaceSessionService.isUnlocked(PRIVATE_SPACE_ID)) {
          continue;
        }
        idsToDelete.add(sibling.primary);
      }
    }

    for (const id of idsToDelete) {
      await databaseManager.deleteItem({ id });
    }

    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}

    return { success: true };
  }
}

export const itemsController = new ItemsController();
