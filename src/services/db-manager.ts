import { getDb } from "@src/services/DatabaseService";
import { ItemDocType } from "@src/schemas/item_schema";
import { FolderDocType } from "@src/schemas/folder_schema";
import { PRIVATE_SPACE_ID, PUBLIC_SPACE_ID } from "@src/common/spaces";
import { spaceSessionService } from "@src/services/space-session.service";

type SearchScope = "current" | "global" | "private" | "public";
type AccessContext = {
  activeSpaceId?: string;
  searchScope?: SearchScope;
};

export type ImportTargetItemPreview = {
  id: string;
  title: string;
  updatedAt: number;
};

export type ImportTargetFolder = {
  id: string;
  name: string;
  sortOrder: number;
  isPinned: boolean;
  updatedAt: number;
  recentItems: ImportTargetItemPreview[];
};

export type ImportTargetSpace = {
  id: string;
  name: string;
  slug: string;
  isPrivate: boolean;
  isUnlocked: boolean;
  sortOrder: number;
  folders: ImportTargetFolder[];
};

class DatabaseManager {
  [key: string]: any;

  private normalizeUserId(userId: string | null | undefined): string {
    return typeof userId === "string" ? userId : "";
  }

  private async resolveAllowedSpaceIds(
    db: any,
    accessContext?: AccessContext
  ): Promise<string[]> {
    const activeSpaceId = accessContext?.activeSpaceId || PUBLIC_SPACE_ID;
    const requestedScope = accessContext?.searchScope || "current";
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

  async getAllItems(payload?: { accessContext?: AccessContext }): Promise<ItemDocType[]> {
    const db = await getDb();
    const allowedSpaceIds = await this.resolveAllowedSpaceIds(db, payload?.accessContext);
    if (allowedSpaceIds.length === 0) return [];
    const allItems = await db.items
      .find({ selector: { deletedAt: { $eq: 0 }, spaceId: { $in: allowedSpaceIds } } })
      .exec();
    return allItems.map((item) => item.toMutableJSON());
  }

  async getAllFolders(payload?: { accessContext?: AccessContext }): Promise<FolderDocType[]> {
    const db = await getDb();
    const allowedSpaceIds = await this.resolveAllowedSpaceIds(db, payload?.accessContext);
    if (allowedSpaceIds.length === 0) return [];
    const allFolders = await db.folders
      .find({ selector: { spaceId: { $in: allowedSpaceIds } } })
      .exec();
    return allFolders.map((folder) => folder.toMutableJSON());
  }

  async getImportTargets(payload?: {
    maxSpaces?: number;
    maxFoldersPerSpace?: number;
    maxItemsPerFolder?: number;
  }): Promise<ImportTargetSpace[]> {
    const db = await getDb();
    const maxSpaces = Math.max(1, Math.min(20, payload?.maxSpaces ?? 8));
    const maxFoldersPerSpace = Math.max(1, Math.min(40, payload?.maxFoldersPerSpace ?? 14));
    const maxItemsPerFolder = Math.max(1, Math.min(6, payload?.maxItemsPerFolder ?? 3));

    const spaceDocs = await db.spaces.find({ selector: { isArchived: { $eq: false } } }).exec();
    const spaces = spaceDocs
      .map((doc) => doc.toMutableJSON() as any)
      .sort((a, b) => {
        if (!!a.isPrivate !== !!b.isPrivate) return a.isPrivate ? 1 : -1;
        const ao = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return (a.createdAt || 0) - (b.createdAt || 0);
      })
      .slice(0, maxSpaces);

    const results: ImportTargetSpace[] = [];
    for (const space of spaces) {
      const spaceId = (space.id as string) || PUBLIC_SPACE_ID;
      const isPrivate = !!space.isPrivate;
      const isUnlocked = !isPrivate || spaceSessionService.isUnlocked(spaceId);

      const spaceEntry: ImportTargetSpace = {
        id: spaceId,
        name: (space.name as string) || "Untitled",
        slug: (space.slug as string) || "",
        isPrivate,
        isUnlocked,
        sortOrder: typeof space.sortOrder === "number" ? space.sortOrder : 0,
        folders: [],
      };

      if (!isUnlocked) {
        results.push(spaceEntry);
        continue;
      }

      const folderDocs = await db.folders.find({ selector: { spaceId: { $eq: spaceId } } }).exec();
      const folders = folderDocs
        .map((doc) => doc.toMutableJSON() as FolderDocType)
        .sort((a, b) => {
          if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
          const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
          const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return a.createdAt - b.createdAt;
        })
        .slice(0, maxFoldersPerSpace);

      for (const folder of folders) {
        const itemDocs = await db.items
          .find({
            selector: {
              folderId: { $eq: folder.id },
              deletedAt: { $eq: 0 },
            },
            sort: [{ updatedAt: "desc" }],
            limit: maxItemsPerFolder,
          })
          .exec();
        const recentItems = itemDocs.map((doc) => {
          const item = doc.toMutableJSON() as ItemDocType;
          return {
            id: item.id,
            title: item.title || item.url || "Untitled",
            updatedAt: item.updatedAt || item.createdAt || 0,
          };
        });

        spaceEntry.folders.push({
          id: folder.id,
          name: folder.name || "Untitled",
          sortOrder: folder.sortOrder ?? 0,
          isPinned: !!folder.isPinned,
          updatedAt: folder.updatedAt || folder.createdAt || 0,
          recentItems,
        });
      }

      results.push(spaceEntry);
    }

    return results;
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

  async markAllActiveItemsForReembedding(options?: { touchUpdatedAt?: boolean }): Promise<number> {
    const db = await getDb();
    const now = Date.now();
    const touchUpdatedAt = options?.touchUpdatedAt === true;
    const activeItems = await db.items.find({ selector: { deletedAt: { $eq: 0 } } }).exec();
    if (activeItems.length === 0) {
      return 0;
    }

    const updates = activeItems.map((doc) => {
      const current = doc.toMutableJSON() as ItemDocType;
      return {
        ...current,
        userId: this.normalizeUserId(doc.get("userId") as string | null | undefined),
        vector_index: -1,
        isEmbedded: false,
        isDirty: true,
        updatedAt: touchUpdatedAt ? now : current.updatedAt,
      };
    });
    await db.items.bulkUpsert(updates);
    return updates.length;
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
    const updateMap = new Map<string, Partial<ItemDocType>>();
    for (const update of updates) {
      if (!update.id) continue;
      updateMap.set(update.id, update);
    }
    const docsMap = await db.items.findByIds(ids).exec();
    const docsToUpdate = [];

    for (const doc of docsMap.values()) {
      const update = updateMap.get(doc.primary);
      if (update) {
        const mutableDoc = doc.toMutableJSON();
        docsToUpdate.push({
          ...mutableDoc,
          ...update,
          userId: this.normalizeUserId((update.userId as string | null | undefined) ?? mutableDoc.userId),
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
      const folderIds = Array.from(new Set(payload.items.map((item) => item.folderId).filter(Boolean)));
      const folderDocs =
        folderIds.length > 0
          ? await db.folders.find({ selector: { id: { $in: folderIds } } }).exec()
          : [];
      const folderSpaceById = new Map<string, string>();
      for (const folder of folderDocs) {
        folderSpaceById.set(folder.get("id") as string, (folder.get("spaceId") as string) || PUBLIC_SPACE_ID);
      }

      const normalized = payload.items.map((item) => ({
        ...item,
        userId: this.normalizeUserId(item.userId),
        spaceId: folderSpaceById.get(item.folderId) || item.spaceId || PUBLIC_SPACE_ID,
      }));
      const result = await db.items.bulkInsert(normalized);
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
    item: Omit<
      ItemDocType,
      "id" | "createdAt" | "updatedAt" | "vector_index" | "deletedAt" | "spaceId"
    > & {
      id?: string;
      spaceId?: string;
    };
  }): Promise<ItemDocType> {
    const db = await getDb();
    const now = Date.now();
    const folder = await db.folders.findOne(payload.item.folderId).exec();
    const folderSpaceId =
      ((folder?.get("spaceId") as string | undefined) || payload.item.spaceId || PUBLIC_SPACE_ID).trim() ||
      PUBLIC_SPACE_ID;
    const item: ItemDocType = {
      id: payload.item.id ?? crypto.randomUUID?.() ?? `${now}`,
      userId: this.normalizeUserId(payload.item.userId),
      title: payload.item.title ?? "Untitled",
      textContent: payload.item.textContent ?? "",
      url: payload.item.url,
      source: payload.item.source,
      folderId: payload.item.folderId,
      spaceId: folderSpaceId,
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
      isMetaFetched: false,
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
    userId?: string | null;
    parentId?: string | null;
    type?: FolderDocType["type"];
    isLocked?: boolean;
    isPinned?: boolean;
    spaceId?: string;
  }): Promise<FolderDocType> {
    const db = await getDb();
    const now = Date.now();
    const folder: FolderDocType = {
      id: payload.id,
      name: payload.name,
      userId: this.normalizeUserId(payload.userId),
      spaceId: payload.spaceId || PUBLIC_SPACE_ID,
      parentId: payload.parentId ?? null,
      type: payload.type ?? "folder",
      sortOrder: now,
      isLocked: payload.isLocked ?? false,
      isPinned: payload.isPinned ?? false,
      isCollapsed: false,
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

  async repairItemSpaceIdsFromFolders(): Promise<number> {
    const db = await getDb();
    const [folders, items] = await Promise.all([db.folders.find().exec(), db.items.find().exec()]);
    if (items.length === 0) return 0;

    const folderSpaceById = new Map<string, string>();
    for (const folder of folders) {
      const json = folder.toMutableJSON() as FolderDocType;
      folderSpaceById.set(json.id, json.spaceId || PUBLIC_SPACE_ID);
    }

    const updates: ItemDocType[] = [];
    for (const itemDoc of items) {
      const item = itemDoc.toMutableJSON() as ItemDocType;
      const nextSpaceId = folderSpaceById.get(item.folderId) || item.spaceId || PUBLIC_SPACE_ID;
      if (item.spaceId !== nextSpaceId) {
        updates.push({
          ...item,
          userId: this.normalizeUserId(item.userId),
          spaceId: nextSpaceId,
          updatedAt: Date.now(),
        });
      }
    }

    if (updates.length > 0) {
      await db.items.bulkUpsert(updates);
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
      } catch {}
    }

    return updates.length;
  }
}

export const databaseManager = new DatabaseManager();
