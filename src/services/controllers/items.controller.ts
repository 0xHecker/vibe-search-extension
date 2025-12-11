import { getDb } from "@src/services/DatabaseService";
import { ItemDocType } from "@src/schemas/item_schema";
import { v4 as uuidv4 } from "uuid";
import { databaseManager } from "@src/services/db-manager";

export class ItemsController {
  [key: string]: any;

  private sanitize<T extends Record<string, any>>(obj: T): T {
    const copy: Record<string, any> = {};
    Object.keys(obj).forEach((k) => {
      const v = (obj as any)[k];
      if (v !== undefined) copy[k] = v;
    });
    return copy as T;
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

        const patchData: Partial<ItemDocType> = {};
        if (!meta) {
          patchData.isMetaFetched = true;
        } else {
          const m = this.sanitize(meta);
          if (m.title !== undefined) patchData.title = m.title as ItemDocType["title"];
          if (m.textContent !== undefined) {
            patchData.textContent = m.textContent as ItemDocType["textContent"];
          }
          if (m.iconUrl !== undefined) patchData.iconUrl = m.iconUrl as ItemDocType["iconUrl"];
          if (m.displayImageUrl !== undefined) {
            patchData.displayImageUrl = m.displayImageUrl as ItemDocType["displayImageUrl"];
          }
          if (m.source) patchData.source = m.source as ItemDocType["source"];
          if (m.authorUsername !== undefined) {
            patchData.authorUsername = m.authorUsername as ItemDocType["authorUsername"];
          }
          if (typeof m.updatedAt === "number" && m.updatedAt > 0) {
            patchData.updatedAt = m.updatedAt;
          }
          if (m.media !== undefined) patchData.media = m.media as ItemDocType["media"];
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

  async addToFolder(payload: {
    folderId: string;
    url: string;
    title?: string;
    userId?: string | null;
    iconUrl?: string;
    textContent?: string;
    source?: ItemDocType["source"];
  }): Promise<ItemDocType> {
    const db = await getDb();
    const now = Date.now();
    const normalizedUrl = this.normalizeUrl(payload.url);
    if (!normalizedUrl) {
      throw new Error("INVALID_URL");
    }

    const base: ItemDocType = {
      id: uuidv4(),
      userId: payload.userId ?? null,
      title: (payload.title || normalizedUrl).slice(0, 80),
      textContent: payload.textContent ?? "",
      url: normalizedUrl,
      source: payload.source ?? "web",
      folderId: payload.folderId,
      isFavorite: false,
      parentId: null,
      chunkOrder: now,
      vector_index: -1,
      isEmbedded: false,
      isMetaFetched: false,
      isDirty: true,
      serverVersion: 0,
      createdAt: now,
      updatedAt: now,
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
      chrome.runtime.sendMessage({
        type: "FETCH_METADATA",
        payload: { urls: [normalizedUrl], revalidate: false },
        target: "background",
      });
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

    const toInsert = payload.items.map((item) => {
      return {
        ...item,
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
    const items = Array.from(itemsToRefetch.values());
    if (items.length === 0) return;

    const urls = items.map((i) => i.url);
    chrome.runtime.sendMessage({
      type: "FETCH_METADATA",
      payload: { urls, revalidate: true },
      target: "background",
    });
  }

  async reorder(payload: {
    folders: { folderId: string; orderedIds: string[] }[];
  }): Promise<{ updated: number }> {
    const db = await getDb();
    let updated = 0;

    for (const entry of payload.folders || []) {
      const { folderId, orderedIds } = entry;
      if (!folderId) continue;
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
        const needsPatch = current.folderId !== folderId || current.chunkOrder !== i;
        if (needsPatch) {
          await doc.patch({ folderId, chunkOrder: i, updatedAt: Date.now() });
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
    const idsToDelete = new Set<string>([payload.id]);

    if (payload.scope === "all") {
      const siblings = await db.items
        .find({ selector: { url: { $eq: item.url }, deletedAt: { $eq: 0 } } })
        .exec();
      for (const sibling of siblings) {
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
