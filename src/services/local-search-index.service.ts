import { Document, Charset } from "flexsearch";
import { getDb } from "@src/services/DatabaseService";
import type { ItemDocType } from "@src/schemas/item_schema";

type IndexedSearchDoc = {
  id: string;
  title: string;
  textContent: string;
  ocrText: string;
  url: string;
  author: string;
  tagsText: string;
  source: string;
  phoneticTitle: string;
  phoneticAuthor: string;
};

type SearchRequest = {
  query: string;
  queries?: string[];
  limit: number;
  keyword?: boolean;
  fuzzy?: boolean;
};

type SearchVariant = {
  query: string;
  boost: number;
  suggest: boolean;
};

type SearchStats = {
  indexedCount: number;
  lastBuiltAt: number;
  usingWorker: boolean;
};

type IndexProcessStatusState = "processing" | "success" | "error";

const FIELD_WEIGHTS: Record<string, number> = {
  title: 6,
  tagsText: 4.5,
  textContent: 3,
  ocrText: 2.8,
  url: 2.5,
  author: 2.5,
  phoneticTitle: 2,
  phoneticAuthor: 1.5,
  source: 1,
};
const ENABLE_FLEXSEARCH_WORKER = (import.meta as any)?.env?.VITE_FLEXSEARCH_WORKER === "1";

const normalizeForIndex = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._:/\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const soundexToken = (input: string): string => {
  const token = normalizeForIndex(input).replace(/[^a-z]/g, "");
  if (!token) return "";

  const first = token[0];
  const mappings: Record<string, string> = {
    b: "1",
    f: "1",
    p: "1",
    v: "1",
    c: "2",
    g: "2",
    j: "2",
    k: "2",
    q: "2",
    s: "2",
    x: "2",
    z: "2",
    d: "3",
    t: "3",
    l: "4",
    m: "5",
    n: "5",
    r: "6",
  };

  let encoded = first.toUpperCase();
  let previous = mappings[first] ?? "";
  for (let i = 1; i < token.length; i += 1) {
    const current = mappings[token[i]] ?? "";
    if (current && current !== previous) {
      encoded += current;
    }
    previous = current;
    if (encoded.length >= 4) break;
  }

  return encoded.padEnd(4, "0").slice(0, 4);
};

const toPhoneticQuery = (query: string): string => {
  const tokens = normalizeForIndex(query).split(/\s+/).filter(Boolean);
  return tokens.map(soundexToken).filter(Boolean).join(" ");
};

const toIndexDoc = (item: ItemDocType, tagsText: string): IndexedSearchDoc => {
  const title = normalizeForIndex(item.title || "");
  const author = normalizeForIndex(item.authorUsername || "");
  const textContent = normalizeForIndex(item.textContent || "").slice(0, 8000);
  const ocrText = normalizeForIndex(item.ocrText || "").slice(0, 8000);
  const url = normalizeForIndex(item.url || "");

  return {
    id: item.id,
    title,
    textContent,
    ocrText,
    url,
    author,
    tagsText: normalizeForIndex(tagsText).slice(0, 2000),
    source: normalizeForIndex(item.source || ""),
    phoneticTitle: toPhoneticQuery(title),
    phoneticAuthor: toPhoneticQuery(author),
  };
};

const toIdString = (entry: unknown): string | null => {
  if (typeof entry === "string" || typeof entry === "number") return String(entry);
  if (entry && typeof entry === "object" && "id" in entry) {
    const idValue = (entry as { id?: unknown }).id;
    if (typeof idValue === "string" || typeof idValue === "number") return String(idValue);
  }
  return null;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class LocalSearchIndexService {
  private index: Document<IndexedSearchDoc, any> | null = null;
  private buildPromise: Promise<void> | null = null;
  private dirty = true;
  private indexedCount = 0;
  private usingWorker = true;
  private lastBuiltAt = 0;
  private lastItemSyncAt = 0;
  private incrementalTimer: ReturnType<typeof setTimeout> | null = null;
  private incrementalSyncInFlight = false;
  private incrementalSyncQueued = false;
  private pendingItemIds = new Set<string>();

  private emitProcessStatus(
    state: IndexProcessStatusState,
    detail: string,
    retryAction?: "REBUILD_INDEX"
  ) {
    try {
      chrome.runtime.sendMessage({
        type: "PROCESS_STATUS",
        payload: {
          id: "search-index",
          label: "Search index",
          state,
          detail,
          retryAction,
          updatedAt: Date.now(),
        },
      });
    } catch {}
  }

  markDirty() {
    this.dirty = true;
  }

  scheduleItemSync(changedItemIds?: string[]) {
    // A full rebuild supersedes every queued per-item update. This is especially
    // important for bulk imports, where holding thousands of IDs only creates
    // duplicate work and a temporary memory spike.
    if (this.dirty) return;

    if (changedItemIds && changedItemIds.length > 0) {
      for (const itemId of changedItemIds) {
        if (itemId) {
          this.pendingItemIds.add(itemId);
        }
      }
    }

    if (this.incrementalSyncInFlight) {
      this.incrementalSyncQueued = true;
      return;
    }

    if (this.incrementalTimer !== null) return;
    this.incrementalTimer = setTimeout(() => {
      this.incrementalTimer = null;
      void this.runIncrementalSync();
    }, 220);
  }

  getStats(): SearchStats {
    return {
      indexedCount: this.indexedCount,
      lastBuiltAt: this.lastBuiltAt,
      usingWorker: this.usingWorker,
    };
  }

  private createIndex(worker: boolean): Document<IndexedSearchDoc, any> {
    return new Document<IndexedSearchDoc, any>({
      tokenize: "forward",
      encoder: Charset.LatinAdvanced,
      resolution: 6,
      // Cache recent query plans, not an unbounded browsing session. A few
      // hundred covers normal type-ahead while keeping long-lived memory flat.
      cache: 256,
      worker,
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: "forward", resolution: 9 },
          { field: "textContent", tokenize: "forward", resolution: 4 },
          { field: "ocrText", tokenize: "forward", resolution: 5 },
          { field: "url", tokenize: "forward", resolution: 5 },
          { field: "author", tokenize: "forward", resolution: 6 },
          { field: "tagsText", tokenize: "forward", resolution: 7 },
          { field: "source", tokenize: "strict", resolution: 3 },
          { field: "phoneticTitle", tokenize: "strict", resolution: 4 },
          { field: "phoneticAuthor", tokenize: "strict", resolution: 4 },
        ],
      },
    });
  }

  private async addBatch(index: Document<IndexedSearchDoc, any>, docs: IndexedSearchDoc[]): Promise<void> {
    await Promise.all(docs.map((doc) => Promise.resolve((index as any).add(doc))));
  }

  private async buildIndexWithMode(worker: boolean): Promise<void> {
    const db = await getDb();
    const [itemDocs, tagDocs, joinDocs] = await Promise.all([
      db.items.find({ selector: { deletedAt: { $eq: 0 } } }).exec(),
      db.tags.find().exec(),
      db.item_tags.find().exec(),
    ]);

    const tagsById = new Map<string, string>();
    for (const doc of tagDocs) {
      tagsById.set(doc.get("id") as string, (doc.get("name") as string) || "");
    }

    const tagsByItemId = new Map<string, string[]>();
    for (const join of joinDocs) {
      const itemId = join.get("itemId") as string;
      const tagId = join.get("tagId") as string;
      const tagName = tagsById.get(tagId);
      if (!tagName) continue;
      const current = tagsByItemId.get(itemId) || [];
      current.push(tagName);
      tagsByItemId.set(itemId, current);
    }

    const index = this.createIndex(worker);
    const docs = itemDocs.map((doc) => doc.toMutableJSON() as ItemDocType);
    const chunkSize = 800;

    for (let start = 0; start < docs.length; start += chunkSize) {
      const chunk = docs.slice(start, start + chunkSize);
      const indexDocs = chunk.map((item) => toIndexDoc(item, (tagsByItemId.get(item.id) || []).join(" ")));
      await this.addBatch(index, indexDocs);
    }

    this.index = index;
    this.usingWorker = worker;
    this.indexedCount = docs.length;
    this.lastBuiltAt = Date.now();
    this.lastItemSyncAt = Date.now();
    this.pendingItemIds.clear();
    this.dirty = false;
  }

  private async rebuild(): Promise<void> {
    this.emitProcessStatus("processing", "Rebuilding local search index...");
    if (ENABLE_FLEXSEARCH_WORKER) {
      try {
        await this.buildIndexWithMode(true);
      } catch (error) {
        console.warn("[LocalSearchIndex] Worker mode unavailable, falling back to in-thread mode.", error);
        await this.buildIndexWithMode(false);
      }
    } else {
      await this.buildIndexWithMode(false);
    }
    this.emitProcessStatus("success", `Index ready (${this.indexedCount} records).`);
  }

  async ensureReady(): Promise<void> {
    if (!this.dirty && this.index) return;
    if (this.buildPromise) {
      await this.buildPromise;
      return;
    }

    this.buildPromise = this.rebuild()
      .catch((error) => {
        console.error("[LocalSearchIndex] Failed to rebuild index:", error);
        this.emitProcessStatus(
          "error",
          "Search index rebuild failed. Retry to restore fast search.",
          "REBUILD_INDEX"
        );
        throw error;
      })
      .finally(() => {
        this.buildPromise = null;
      });

    await this.buildPromise;
  }

  private async getTagsByItemIds(itemIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (itemIds.length === 0) return map;

    const db = await getDb();
    const joins = await db.item_tags.find({ selector: { itemId: { $in: itemIds } } }).exec();
    if (joins.length === 0) return map;

    const tagIds = Array.from(new Set(joins.map((join) => join.get("tagId") as string).filter(Boolean)));
    const tagDocs =
      tagIds.length > 0 ? await db.tags.find({ selector: { id: { $in: tagIds } } }).exec() : [];
    const tagNameById = new Map<string, string>();
    for (const tag of tagDocs) {
      tagNameById.set(tag.get("id") as string, (tag.get("name") as string) || "");
    }

    for (const join of joins) {
      const itemId = join.get("itemId") as string;
      const tagId = join.get("tagId") as string;
      const tagName = tagNameById.get(tagId);
      if (!tagName) continue;
      const list = map.get(itemId) || [];
      list.push(tagName);
      map.set(itemId, list);
    }

    return map;
  }

  private async syncItemsIncremental(changedItemIds?: string[]): Promise<number> {
    if (this.dirty || !this.index) return 0;

    const db = await getDb();
    const explicitIds = Array.from(new Set((changedItemIds || []).filter(Boolean)));
    let changedItems: ItemDocType[] = [];
    const removedIds = new Set<string>();

    if (explicitIds.length > 0) {
      const changedById = await db.items.findByIds(explicitIds).exec();
      changedItems = explicitIds
        .map((itemId) => {
          const doc = changedById.get(itemId);
          if (!doc) {
            removedIds.add(itemId);
            return null;
          }
          return doc.toMutableJSON() as ItemDocType;
        })
        .filter((item): item is ItemDocType => !!item);
    } else {
      const now = Date.now();
      const since = Math.max(0, this.lastItemSyncAt - 2000);
      const changedDocs = await db.items
        .find({
          selector: {
            $or: [{ updatedAt: { $gte: since } }, { deletedAt: { $gte: since } }],
          },
        })
        .exec();
      if (changedDocs.length === 0) {
        this.lastItemSyncAt = now;
        return 0;
      }

      changedItems = changedDocs.map((doc) => doc.toMutableJSON() as ItemDocType);
    }

    const activeIds = changedItems
      .filter((item) => (item.deletedAt || 0) === 0)
      .map((item) => item.id)
      .filter(Boolean);
    const tagsByItemId = await this.getTagsByItemIds(activeIds);

    for (const removedId of removedIds) {
      await Promise.resolve((this.index as any).remove(removedId));
    }

    for (const item of changedItems) {
      await Promise.resolve((this.index as any).remove(item.id));
      if ((item.deletedAt || 0) !== 0) {
        continue;
      }
      const indexDoc = toIndexDoc(item, (tagsByItemId.get(item.id) || []).join(" "));
      await Promise.resolve((this.index as any).add(indexDoc));
    }

    this.lastItemSyncAt = Date.now();
    return changedItems.length + removedIds.size;
  }

  private async runIncrementalSync(): Promise<void> {
    if (this.incrementalSyncInFlight) {
      this.incrementalSyncQueued = true;
      return;
    }

    this.incrementalSyncInFlight = true;
    try {
      this.emitProcessStatus("processing", "Applying index updates...");
      let totalSynced = 0;
      do {
        this.incrementalSyncQueued = false;
        const batchIds = Array.from(this.pendingItemIds);
        this.pendingItemIds.clear();
        totalSynced += await this.syncItemsIncremental(batchIds.length > 0 ? batchIds : undefined);
      } while (this.incrementalSyncQueued || this.pendingItemIds.size > 0);

      if (totalSynced > 0) {
        this.emitProcessStatus("success", `Indexed ${totalSynced} updated records.`);
      } else {
        this.emitProcessStatus("success", "Index already up to date.");
      }
    } catch (error) {
      console.error("[LocalSearchIndex] Incremental sync failed. Falling back to full rebuild.", error);
      this.markDirty();
      this.emitProcessStatus(
        "error",
        "Index updates failed. Retry to rebuild the index.",
        "REBUILD_INDEX"
      );
    } finally {
      this.incrementalSyncInFlight = false;
    }
  }

  private buildVariants(
    query: string,
    keyword: boolean,
    fuzzy: boolean
  ): SearchVariant[] {
    const normalized = normalizeForIndex(query);
    if (!normalized) return [];

    const byQuery = new Map<string, { boost: number; suggest: boolean }>();
    const addVariant = (variantQuery: string, boost: number, suggest: boolean) => {
      const clean = normalizeForIndex(variantQuery);
      if (!clean) return;
      const current = byQuery.get(clean);
      if (!current || boost > current.boost) {
        byQuery.set(clean, { boost, suggest });
        return;
      }
      current.suggest = current.suggest && suggest;
    };

    if (keyword) {
      // Keyword mode must not quietly turn into fuzzy OR matching.
      addVariant(normalized, 1, false);
    }

    if (fuzzy) {
      addVariant(normalized, keyword ? 0.9 : 1, true);

      const tokens = normalized.split(/\s+/).filter(Boolean);
      const prefix = tokens
        .map((token) => {
          if (token.length <= 3) return token;
          return token.slice(0, token.length - 1);
        })
        .join(" ")
        .trim();
      if (prefix && prefix !== normalized) {
        addVariant(prefix, keyword ? 0.42 : 0.92, true);
      }

      const phonetic = toPhoneticQuery(normalized);
      if (phonetic && phonetic !== normalized) {
        addVariant(phonetic, keyword ? 0.36 : 0.78, true);
      }
    }

    return Array.from(byQuery.entries())
      .map(([variantQuery, options]) => ({ query: variantQuery, ...options }))
      .sort((a, b) => b.boost - a.boost);
  }

  private accumulateScores(
    rawResults: unknown,
    scoreMap: Map<string, number>,
    variantBoost: number,
    includeOcrText: boolean
  ) {
    if (!Array.isArray(rawResults)) return;

    for (const row of rawResults as Array<{ field?: string; result?: unknown[] } | unknown>) {
      if (!row || typeof row !== "object" || !("result" in row)) {
        continue;
      }
      const typed = row as { field?: string; result?: unknown[] };
      // OCR text is a keyword-only signal: only exact keyword variants may match
      // it. Fuzzy variants (prefix + phonetic expansion) skip it, otherwise
      // noisy image-extracted text pollutes fuzzy results.
      if (!includeOcrText && typed.field === "ocrText") continue;
      const results = Array.isArray(typed.result) ? typed.result : [];
      const weight = FIELD_WEIGHTS[typed.field || ""] || 1;
      for (let index = 0; index < results.length; index += 1) {
        const id = toIdString(results[index]);
        if (!id) continue;
        const score = (weight * variantBoost) / (index + 1);
        scoreMap.set(id, (scoreMap.get(id) || 0) + score);
      }
    }
  }

  async search({ query, queries, limit, keyword, fuzzy }: SearchRequest): Promise<Map<string, number>> {
    await this.ensureReady();
    if (!this.index) return new Map();

    const safeLimit = clamp(limit, 20, 2500);
    const includeKeyword = keyword !== false;
    const includeFuzzy = fuzzy === true;
    const queryInputs = Array.from(
      new Set(
        (queries?.length ? queries : [query])
          .map((value) => normalizeForIndex(value))
          .filter(Boolean)
      )
    ).slice(0, 12);
    if (queryInputs.length === 0) return new Map();
    const scoreMap = new Map<string, number>();

    for (const queryInput of queryInputs) {
      const variants = this.buildVariants(queryInput, includeKeyword, includeFuzzy);
      for (const variant of variants) {
        const results = await Promise.resolve(
          (this.index as any).search(variant.query, {
            limit: safeLimit * 3,
            suggest: variant.suggest,
          })
        );
        this.accumulateScores(results, scoreMap, variant.boost, !variant.suggest);
      }
    }

    return scoreMap;
  }
}

export const localSearchIndexService = new LocalSearchIndexService();
