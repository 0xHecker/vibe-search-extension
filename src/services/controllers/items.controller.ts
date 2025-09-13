import { getDb } from "@src/services/DatabaseService";
import { ItemDocType } from "@src/schemas/item_schema";
import { v4 as uuidv4 } from "uuid";

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
    // add https scheme and retry
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
      title: (payload.title ?? normalizedUrl).slice(0, 80),
      textContent: payload.textContent ?? "",
      url: normalizedUrl,
      source: payload.source ?? "web",
      folderId: payload.folderId,
      isFavorite: false,
      parentId: null,
      vector_index: -1,
      isEmbedded: false,
      isDirty: true,
      serverVersion: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: 0,
    };
    const item = this.sanitize({ ...base, iconUrl: payload.iconUrl });
    await db.items.insert(item as any);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    return item as ItemDocType;
  }

  async addMany(payload: { items: ItemDocType[] }): Promise<{ inserted: number }> {
    const db = await getDb();
    if (!payload.items?.length) return { inserted: 0 };
    const sanitized = payload.items.map((i) => this.sanitize(i));
    const result = await db.items.bulkInsert(sanitized);
    if (result.error.length > 0) {
      throw new Error(`Failed to insert ${result.error.length} items.`);
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    return { inserted: sanitized.length };
  }
}

export const itemsController = new ItemsController();
