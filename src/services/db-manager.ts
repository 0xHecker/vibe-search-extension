import { getDb, addDummyData } from "@src/services/DatabaseService";
import { ItemDocType } from "@src/schemas/item_schema";
import { FolderDocType } from "@src/schemas/folder_schema";

class DatabaseManager {
  [key: string]: any;
  async getAllItems(): Promise<ItemDocType[]> {
    const db = await getDb();
    const allItems = await db.items.find({ selector: { deletedAt: { $eq: 0 } } }).exec();
    return allItems.map((item) => item.toMutableJSON());
  }

  async getAllFolders(): Promise<FolderDocType[]> {
    const db = await getDb();
    const allFolders = await db.folders.find().exec();
    return allFolders.map((folder) => folder.toMutableJSON());
  }

  /**
   * Retrieves all items that have not yet been embedded.
   * This is used to process new items that need to be added to the vector store.
   */
  async getItemsToEmbed(): Promise<ItemDocType[]> {
    const db = await getDb();
    const itemsToEmbed = await db.items
      .find({ selector: { isEmbedded: false, deletedAt: { $eq: 0 } } })
      .exec();
    return itemsToEmbed.map((item) => item.toMutableJSON());
  }

  /**
   * Retrieves all items that have not been soft-deleted.
   * This is the source of truth for the periodic `rebuildAndCompact` sync process.
   */
  async getAllActiveItems(): Promise<ItemDocType[]> {
    const db = await getDb();
    const activeItems = await db.items.find({ selector: { deletedAt: { $eq: 0 } } }).exec();
    return activeItems.map((item) => item.toMutableJSON());
  }

  /**
   * Retrieves all active items that have been marked as dirty (i.e., their content has changed).
   * These items need to be re-embedded.
   */
  async getDirtyItems(): Promise<ItemDocType[]> {
    const db = await getDb();
    const dirtyItems = await db.items
      .find({ selector: { isDirty: true, deletedAt: { $eq: 0 } } })
      .exec();
    return dirtyItems.map((item) => item.toMutableJSON());
  }

  /**
   * Soft-deletes an item by setting its `deletedAt` timestamp.
   * It also creates a "tombstone" record in the `deleted_items` collection,
   * which signals to the sync service that the corresponding vector needs to be removed.
   */
  async deleteItem(payload: { id: string }): Promise<void> {
    const db = await getDb();
    const item = await db.items.findOne(payload.id).exec();
    if (item) {
      const now = Date.now();
      await item.patch({ deletedAt: now });
      if (item.vector_index !== undefined && item.vector_index > -1) {
        await db.deleted_items.upsert({
          id: item.primary,
          vector_index: item.vector_index,
          deletedAt: now,
        });
      }
    }
  }

  /**
   * Purges the tombstone collection after a successful sync.
   */
  async clearDeletedItems(): Promise<void> {
    const db = await getDb();
    const allDeleted = await db.deleted_items.find().exec();
    const ids = allDeleted.map((doc) => doc.primary);
    await db.deleted_items.bulkRemove(ids);
  }

  /**
   * Performs a bulk update/insert operation on the items collection.
   * This is used to efficiently update multiple items at once, for example,
   * when updating vector indexes after an embedding or sync operation.
   */
  async bulkUpdateItems(updates: Partial<ItemDocType>[]): Promise<void> {
    const db = await getDb();
    const ids = updates.map((u) => u.id).filter((id): id is string => !!id);
    const docsMap = await db.items.findByIds(ids).exec();
    const docsToUpdate = [];

    for (const doc of docsMap.values()) {
      const update = updates.find((u) => u.id === doc.primary);
      if (update) {
        const mutableDoc = doc.toMutableJSON();
        docsToUpdate.push({
          ...mutableDoc,
          ...update,
        });
      }
    }

    if (docsToUpdate.length > 0) {
      await db.items.bulkUpsert(docsToUpdate);
    }
  }

  /**
   * Marks an item as dirty, signaling that its content has changed and
   * it needs to be re-embedded during the next sync cycle.
   */
  async markItemAsDirty(payload: { id: string }): Promise<void> {
    const db = await getDb();
    const item = await db.items.findOne(payload.id).exec();
    if (item) {
      await item.patch({ isDirty: true });
    }
  }

  /**
   * Inserts a batch of new items into the database.
   */
  async addItems(payload: { items: ItemDocType[] }): Promise<void> {
    const db = await getDb();
    if (payload.items.length > 0) {
      const result = await db.items.bulkInsert(payload.items);
      if (result.error.length > 0) {
        console.error("DB: Failed to insert items:", result.error);
        throw new Error(`Failed to insert ${result.error.length} items.`);
      }
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
      } catch {}
    }
  }

  async addItemToFolder(payload: {
    item: Omit<ItemDocType, "id" | "createdAt" | "updatedAt" | "vector_index" | "deletedAt"> & {
      id?: string;
    };
  }): Promise<ItemDocType> {
    const db = await getDb();
    const now = Date.now();
    const item: ItemDocType = {
      id: payload.item.id ?? crypto.randomUUID?.() ?? `${now}`,
      userId: payload.item.userId ?? null,
      title: payload.item.title ?? "Untitled",
      textContent: payload.item.textContent ?? "",
      url: payload.item.url,
      source: payload.item.source,
      folderId: payload.item.folderId,
      isFavorite: payload.item.isFavorite ?? false,
      authorUsername: payload.item.authorUsername,
      likes: payload.item.likes,
      upvotes: payload.item.upvotes,
      media: payload.item.media,
      iconUrl: (payload.item as any).iconUrl,
      displayImageUrl: (payload.item as any).displayImageUrl,
      parentId: payload.item.parentId ?? null,
      chunkOrder: payload.item.chunkOrder,
      vector_index: -1,
      isEmbedded: false,
      isDirty: true,
      serverVersion: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: 0,
    };
    await db.items.insert(item);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    return item;
  }

  /**
   * Creates a new folder and returns it.
   */
  async createFolder(payload: {
    id: string;
    name: string;
    userId: string | null;
    parentId?: string | null;
    type?: FolderDocType["type"];
    isLocked?: boolean;
    isPinned?: boolean;
  }): Promise<FolderDocType> {
    const db = await getDb();
    const now = Date.now();
    const folder: FolderDocType = {
      id: payload.id,
      name: payload.name,
      userId: payload.userId ?? null,
      parentId: payload.parentId ?? null,
      type: payload.type ?? "folder",
      isLocked: payload.isLocked ?? false,
      isPinned: payload.isPinned ?? false,
      isDirty: false,
      serverVersion: 0,
      createdAt: now,
      updatedAt: now,
    };

    await db.folders.insert(folder);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return folder;
  }

  async toggleFolderPinned(payload: { id: string; value?: boolean }): Promise<void> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return;
    const current = doc.toMutableJSON();
    const nextPinned = payload.value ?? !current.isPinned;
    await doc.patch({ isPinned: nextPinned, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
  }

  async toggleFolderLocked(payload: { id: string; value?: boolean }): Promise<void> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return;
    const current = doc.toMutableJSON();
    const nextLocked = payload.value ?? !current.isLocked;
    await doc.patch({ isLocked: nextLocked, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
  }

  async updateFolderName(payload: { id: string; name: string }): Promise<void> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return;
    const safeName = (payload.name || "").slice(0, 80);
    await doc.patch({ name: safeName, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
  }
}

export const databaseManager = new DatabaseManager();
