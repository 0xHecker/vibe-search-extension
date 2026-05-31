import { getDb } from "@src/services/DatabaseService";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";
import { v4 as uuidv4 } from "uuid";
import { databaseManager } from "@src/services/db-manager";
import { PRIVATE_SPACE_ID, PUBLIC_SPACE_ID } from "@src/common/spaces";
import { spaceSessionService } from "@src/services/space-session.service";

export class FoldersController {
  [key: string]: any;

  private normalizeUserId(userId: string | null | undefined): string {
    return typeof userId === "string" ? userId : "";
  }

  private assertSpaceUnlocked(spaceId: string): void {
    if (spaceId === PRIVATE_SPACE_ID && !spaceSessionService.isUnlocked(PRIVATE_SPACE_ID)) {
      throw new Error("PRIVATE_SPACE_LOCKED");
    }
  }

  private resolveSpaceId(value: string | undefined): string {
    return (value || PUBLIC_SPACE_ID).trim() || PUBLIC_SPACE_ID;
  }

  private async getFolderWithAccess(db: any, folderId: string): Promise<any | null> {
    const doc = await db.folders.findOne(folderId).exec();
    if (!doc) return null;
    const spaceId = this.resolveSpaceId(doc.get("spaceId") as string | undefined);
    this.assertSpaceUnlocked(spaceId);
    return doc;
  }

  async create(payload: {
    name: string;
    userId?: string | null;
    parentId?: string | null;
    spaceId?: string;
    allowLockedPrivateWrite?: boolean;
  }): Promise<FolderDocType> {
    const db = await getDb();
    const now = Date.now();
    const requestedSpaceId = (payload.spaceId || "").trim();
    const spaceDoc = requestedSpaceId ? await db.spaces.findOne(requestedSpaceId).exec() : null;
    const spaceId = (spaceDoc?.get("id") as string | undefined) || PUBLIC_SPACE_ID;
    const bypassLockCheck =
      payload.allowLockedPrivateWrite === true && spaceId === PRIVATE_SPACE_ID;
    if (!bypassLockCheck) {
      this.assertSpaceUnlocked(spaceId);
    }
    const folder: FolderDocType = {
      id: uuidv4(),
      name: payload.name,
      userId: this.normalizeUserId(payload.userId),
      spaceId,
      parentId: payload.parentId ?? null,
      type: "folder",
      sortOrder: now,
      isLocked: false,
      isPinned: false,
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

  async setPinned(payload: { id: string; value: boolean }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false };
    await doc.patch({ isPinned: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async setLocked(payload: { id: string; value: boolean }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false };
    await doc.patch({ isLocked: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async setCollapsed(payload: { id: string; value: boolean }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false };
    await doc.patch({ isCollapsed: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async rename(payload: { id: string; name: string }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false };
    const name = payload.name.trim().slice(0, 80);
    await doc.patch({ name, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  /**
   * Deletes a folder and optionally soft-deletes all items inside it.
   * Respects the folder's locked state; locked folders will not be deleted.
   */
  async delete(payload: {
    id: string;
    alsoDeleteItems?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false, error: "NOT_FOUND" };
    const current = doc.toMutableJSON();
    if (current.isLocked) return { success: false, error: "LOCKED" };

    const alsoDeleteItems = payload.alsoDeleteItems !== false;
    if (alsoDeleteItems) {
      const items = await db.items
        .find({ selector: { folderId: { $eq: payload.id }, deletedAt: { $eq: 0 } } })
        .exec();
      for (const item of items) {
        await databaseManager.deleteItem({ id: item.primary });
      }
    }

    await doc.remove();
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async reorder(payload: { orderedIds: string[]; spaceId?: string }): Promise<{ success: boolean }> {
    const db = await getDb();
    if (payload.spaceId) {
      this.assertSpaceUnlocked(this.resolveSpaceId(payload.spaceId));
    }
    const docs = payload.spaceId
      ? await db.folders.find({ selector: { spaceId: { $eq: payload.spaceId } } }).exec()
      : await db.folders.find().exec();
    const accessibleDocs = docs.filter((doc) => {
      const spaceId = this.resolveSpaceId(doc.get("spaceId") as string | undefined);
      return spaceId !== PRIVATE_SPACE_ID || spaceSessionService.isUnlocked(PRIVATE_SPACE_ID);
    });
    if (accessibleDocs.length === 0) return { success: true };
    const allIds = accessibleDocs.map((d) => d.primary);
    const provided = payload.orderedIds || [];
    const remainder = allIds.filter((id) => !provided.includes(id));
    const finalOrder = [...provided, ...remainder];
    const now = Date.now();

    for (let i = 0; i < finalOrder.length; i++) {
      const id = finalOrder[i];
      const doc = await db.folders.findOne(id).exec();
      if (!doc) continue;
      const current = doc.toMutableJSON() as FolderDocType;
      const nextOrder = i;
      if (current.sortOrder !== nextOrder) {
        await doc.patch({ sortOrder: nextOrder, updatedAt: now });
      }
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async moveToSpace(payload: {
    folderId: string;
    targetSpaceId: string;
  }): Promise<{ success: boolean; movedItems: number }> {
    const db = await getDb();
    const folderId = (payload.folderId || "").trim();
    const targetSpaceId = (payload.targetSpaceId || "").trim();
    if (!folderId || !targetSpaceId) {
      return { success: false, movedItems: 0 };
    }

    const folderDoc = await this.getFolderWithAccess(db, folderId);
    if (!folderDoc) return { success: false, movedItems: 0 };
    const folder = folderDoc.toMutableJSON() as FolderDocType;

    const targetSpaceDoc = await db.spaces.findOne(targetSpaceId).exec();
    if (!targetSpaceDoc) {
      throw new Error("TARGET_SPACE_NOT_FOUND");
    }
    if (targetSpaceDoc.get("isArchived") === true) {
      throw new Error("TARGET_SPACE_ARCHIVED");
    }
    this.assertSpaceUnlocked(targetSpaceId);

    if ((folder.spaceId || PUBLIC_SPACE_ID) === targetSpaceId) {
      return { success: true, movedItems: 0 };
    }

    const now = Date.now();
    const targetFolders = await db.folders.find({ selector: { spaceId: { $eq: targetSpaceId } } }).exec();
    const maxSortOrder = targetFolders.reduce((max, doc) => {
      const sortOrder = (doc.get("sortOrder") as number | undefined) ?? 0;
      return Math.max(max, sortOrder);
    }, 0);

    await folderDoc.patch({
      spaceId: targetSpaceId,
      sortOrder: maxSortOrder + 1,
      updatedAt: now,
    });

    const itemDocs = await db.items
      .find({
        selector: {
          folderId: { $eq: folderId },
          deletedAt: { $eq: 0 },
        },
      })
      .exec();
    if (itemDocs.length > 0) {
      const updates = itemDocs.map((doc) => {
        const item = doc.toMutableJSON() as ItemDocType;
        return {
          ...item,
          spaceId: targetSpaceId,
          updatedAt: now,
        };
      });
      await db.items.bulkUpsert(updates);
    }

    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}

    return { success: true, movedItems: itemDocs.length };
  }

  async copyToSpace(payload: {
    folderId: string;
    targetSpaceId: string;
    name?: string;
  }): Promise<{ success: boolean; folderId?: string; copiedItems: number }> {
    const db = await getDb();
    const folderId = (payload.folderId || "").trim();
    const targetSpaceId = (payload.targetSpaceId || "").trim();
    if (!folderId || !targetSpaceId) {
      return { success: false, copiedItems: 0 };
    }

    const sourceFolderDoc = await this.getFolderWithAccess(db, folderId);
    if (!sourceFolderDoc) return { success: false, copiedItems: 0 };
    const sourceFolder = sourceFolderDoc.toMutableJSON() as FolderDocType;

    const targetSpaceDoc = await db.spaces.findOne(targetSpaceId).exec();
    if (!targetSpaceDoc) {
      throw new Error("TARGET_SPACE_NOT_FOUND");
    }
    if (targetSpaceDoc.get("isArchived") === true) {
      throw new Error("TARGET_SPACE_ARCHIVED");
    }
    this.assertSpaceUnlocked(targetSpaceId);

    const now = Date.now();
    const targetFolders = await db.folders.find({ selector: { spaceId: { $eq: targetSpaceId } } }).exec();
    const existingNames = new Set(
      targetFolders.map((doc) => ((doc.get("name") as string | undefined) || "").toLowerCase())
    );
    const baseName = (payload.name || sourceFolder.name || "Untitled").trim().slice(0, 80) || "Untitled";
    let nextName = baseName;
    if (existingNames.has(nextName.toLowerCase())) {
      let index = 2;
      while (existingNames.has(`${baseName} (copy ${index})`.toLowerCase())) {
        index += 1;
      }
      nextName = `${baseName} (copy ${index})`;
    }

    const maxSortOrder = targetFolders.reduce((max, doc) => {
      const sortOrder = (doc.get("sortOrder") as number | undefined) ?? 0;
      return Math.max(max, sortOrder);
    }, 0);

    const clonedFolder: FolderDocType = {
      id: uuidv4(),
      name: nextName,
      userId: this.normalizeUserId(sourceFolder.userId),
      spaceId: targetSpaceId,
      parentId: null,
      type: sourceFolder.type || "folder",
      sortOrder: maxSortOrder + 1,
      isLocked: !!sourceFolder.isLocked,
      isPinned: !!sourceFolder.isPinned,
      isCollapsed: !!sourceFolder.isCollapsed,
      isDirty: false,
      serverVersion: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.folders.insert(clonedFolder);

    const sourceItemDocs = await db.items
      .find({
        selector: {
          folderId: { $eq: folderId },
          deletedAt: { $eq: 0 },
        },
      })
      .exec();
    const sourceItems = sourceItemDocs
      .map((doc) => doc.toMutableJSON() as ItemDocType)
      .sort((a, b) => {
        const ao = a.chunkOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.chunkOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.createdAt - b.createdAt;
      });

    const idMap = new Map<string, string>();
    for (const item of sourceItems) {
      idMap.set(item.id, uuidv4());
    }

    const clonedItems: ItemDocType[] = sourceItems.map((item, index) => {
      const clonedId = idMap.get(item.id) as string;
      const mappedParentId =
        item.parentId && idMap.has(item.parentId) ? (idMap.get(item.parentId) as string) : null;
      return {
        ...item,
        userId: this.normalizeUserId(item.userId),
        id: clonedId,
        folderId: clonedFolder.id,
        spaceId: targetSpaceId,
        parentId: mappedParentId,
        vector_index: -1,
        isEmbedded: false,
        isDirty: true,
        createdAt: now + index,
        updatedAt: now + index,
        deletedAt: 0,
      };
    });

    if (clonedItems.length > 0) {
      const insertResult = await db.items.bulkInsert(clonedItems);
      if (insertResult.error.length > 0) {
        throw new Error(`Failed to copy ${insertResult.error.length} items.`);
      }
    }

    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}

    return { success: true, folderId: clonedFolder.id, copiedItems: clonedItems.length };
  }
}

export const foldersController = new FoldersController();
