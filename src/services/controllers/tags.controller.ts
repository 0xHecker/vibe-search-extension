import { getDb } from "@src/services/DatabaseService";
import { v4 as uuidv4 } from "uuid";
import type { TagDocType } from "@src/schemas/tag_schema";

export class TagsController {
  [key: string]: any;

  private normalizeName(name: string): string {
    return name.trim().slice(0, 100);
  }

  async getTagsForItem(payload: { itemId: string }): Promise<TagDocType[]> {
    const db = await getDb();
    const joins = await db.item_tags.find({ selector: { itemId: { $eq: payload.itemId } } }).exec();
    if (joins.length === 0) return [];
    const tagIds = joins.map((j) => j.get("tagId") as string);
    const tags = await db.tags.find({ selector: { id: { $in: tagIds } } }).exec();
    return tags.map((t) => t.toMutableJSON());
  }

  async searchTags(payload: { query: string; limit?: number }): Promise<TagDocType[]> {
    const db = await getDb();
    const q = (payload.query ?? "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(payload.limit ?? 50, 100));

    // Get all tags sorted by updatedAt (most recently used first - LRU style)
    const allTags = await db.tags.find({ selector: {} }).exec();
    let results = allTags
      .map((t) => t.toMutableJSON())
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // Filter by query if provided
    if (q) {
      results = results.filter((t) => t.name.toLowerCase().includes(q));
    }

    return results.slice(0, limit);
  }

  async addTagToItem(payload: {
    itemId: string;
    tagName: string;
    userId?: string;
  }): Promise<{ tags: TagDocType[] }> {
    const db = await getDb();
    const name = this.normalizeName(payload.tagName);
    if (!name) return { tags: [] };
    const userId = payload.userId || "user1"; // Use default user ID instead of null

    // find or create tag by name + userId
    let tag = await db.tags
      .findOne({ selector: { name: { $eq: name }, userId: { $eq: userId } } })
      .exec();
    if (!tag) {
      const now = Date.now();
      const newTag: TagDocType = {
        id: uuidv4(),
        name,
        userId,
        isDirty: true,
        serverVersion: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.tags.insert(newTag as any);
      tag = await db.tags.findOne(newTag.id).exec();
    }
    if (!tag) return { tags: [] };

    const tagId = tag.get("id") as string;
    const joinId = `${payload.itemId}|${tagId}`;
    const existingJoin = await db.item_tags.findOne(joinId).exec();
    if (!existingJoin) {
      await db.item_tags.insert({ id: joinId, itemId: payload.itemId, tagId, userId } as any);
    }

    // Update the tag's updatedAt to track recent usage (LRU)
    try {
      await tag.patch({ updatedAt: Date.now() });
    } catch {}

    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}

    const tags = await this.getTagsForItem({ itemId: payload.itemId });
    return { tags };
  }

  async removeTagFromItem(payload: {
    itemId: string;
    tagId: string;
  }): Promise<{ tags: TagDocType[] }> {
    const db = await getDb();
    const joinId = `${payload.itemId}|${payload.tagId}`;
    const joinDoc = await db.item_tags.findOne(joinId).exec();
    if (joinDoc) {
      await joinDoc.remove();
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    const tags = await this.getTagsForItem({ itemId: payload.itemId });
    return { tags };
  }
}

export const tagsController = new TagsController();
