import { getDb } from "@src/services/DatabaseService";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";
import { v4 as uuidv4 } from "uuid";
import { databaseManager } from "@src/services/db-manager";
import { appendUnorderedIds } from "@src/utils/ordered-ids";
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

  async getById(payload: { id: string; skipLockCheck?: boolean }): Promise<FolderDocType | null> {
    const db = await getDb();
    const doc = payload.skipLockCheck
      ? await db.folders.findOne(payload.id).exec()
      : await this.getFolderWithAccess(db, payload.id);
    if (!doc) return null;
    return doc.toMutableJSON() as FolderDocType;
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
    await doc.incrementalPatch({ isPinned: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async setLocked(payload: { id: string; value: boolean }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false };
    await doc.incrementalPatch({ isLocked: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async setCollapsed(payload: { id: string; value: boolean }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false };
    await doc.incrementalPatch({ isCollapsed: payload.value, updatedAt: Date.now() });
    return { success: true };
  }

  async rename(payload: { id: string; name: string }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await this.getFolderWithAccess(db, payload.id);
    if (!doc) return { success: false };
    const name = payload.name.trim().slice(0, 80);
    await doc.incrementalPatch({ name, updatedAt: Date.now() });
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

  async reorder(payload: {
    orderedIds: string[];
    spaceId?: string;
    parentId?: string | null;
  }): Promise<{ success: boolean }> {
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
    const isSibling = (doc: any): boolean => {
      if (payload.parentId === undefined) return true;
      const docParent = doc.get("parentId") || null;
      const filterParent = (payload.parentId ?? null) || null;
      return docParent === filterParent;
    };
    const siblings = accessibleDocs.filter(isSibling);
    if (siblings.length === 0) return { success: true };
    const allIds = siblings.map((d) => d.primary);
    const provided = (payload.orderedIds || []).filter((id) => id && allIds.includes(id));
    const finalOrder = appendUnorderedIds(provided, allIds);
    const now = Date.now();

    const lookup = new Map(siblings.map((doc) => [doc.primary as string, doc]));
    for (let i = 0; i < finalOrder.length; i++) {
      const id = finalOrder[i];
      const doc = lookup.get(id);
      if (!doc) continue;
      const currentOrder = (doc.get("sortOrder") as number | undefined) ?? 0;
      if (currentOrder !== i) {
        await doc.incrementalPatch({ sortOrder: i, updatedAt: now });
      }
    }
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async moveToParent(payload: {
    folderId: string;
    parentId: string | null;
  }): Promise<{ success: boolean; error?: string }> {
    const db = await getDb();
    const folderId = (payload.folderId || "").trim();
    const parentId = payload.parentId ?? null;
    if (!folderId) return { success: false, error: "FOLDER_ID_REQUIRED" };
    if (folderId === parentId) {
      return { success: false, error: "FOLDER_CANNOT_BE_OWN_DESCENDANT" };
    }

    const folderDoc = await this.getFolderWithAccess(db, folderId);
    if (!folderDoc) return { success: false, error: "NOT_FOUND" };
    const folder = folderDoc.toMutableJSON() as FolderDocType;
    const spaceId = this.resolveSpaceId(folder.spaceId);

    let parentSpaceId = spaceId;
    let parentDoc: any | null = null;
    if (parentId) {
      parentDoc = await this.getFolderWithAccess(db, parentId);
      if (!parentDoc) return { success: false, error: "PARENT_NOT_FOUND" };
      const parentFolder = parentDoc.toMutableJSON() as FolderDocType;
      parentSpaceId = this.resolveSpaceId(parentFolder.spaceId);
      if (parentSpaceId !== spaceId) {
        return { success: false, error: "CROSS_SPACE_NESTING_NOT_ALLOWED" };
      }
      const descendantIds = await this.collectDescendantIds(folderId, spaceId);
      if (descendantIds.has(parentId)) {
        return { success: false, error: "FOLDER_CANNOT_BE_OWN_DESCENDANT" };
      }
    }

    if (folder.parentId === parentId) return { success: true };

    const now = Date.now();
    const patch: Partial<FolderDocType> = { updatedAt: now };
    if (parentId) {
      patch.parentId = parentId;
      const siblings = await db.folders
        .find({ selector: { parentId: { $eq: parentId }, spaceId: { $eq: spaceId } } })
        .exec();
      const maxOrder = siblings.reduce((max, doc) => {
        const order = (doc.get("sortOrder") as number | undefined) ?? 0;
        return Math.max(max, order);
      }, 0);
      patch.sortOrder = maxOrder + 1;
    } else {
      patch.parentId = null;
      const topLevel = await db.folders
        .find({ selector: { parentId: { $eq: null }, spaceId: { $eq: spaceId } } })
        .exec();
      const maxOrder = topLevel.reduce((max, doc) => {
        const order = (doc.get("sortOrder") as number | undefined) ?? 0;
        return Math.max(max, order);
      }, 0);
      patch.sortOrder = maxOrder + 1;
    }

    await folderDoc.incrementalPatch(patch);
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  /**
   * Merge one tab group into another — the canonical "drop a tab group onto
   * another tab group" behaviour (see docs/drag-and-drop.md):
   *   - every tab in the source group moves into the target group (folderId +
   *     spaceId updated, appended after the target's existing tabs),
   *   - any sub-groups of the source are re-parented to the target so nothing
   *     is orphaned,
   *   - the now-empty source group is deleted.
   * Merging is destructive (the source group disappears) so callers confirm
   * first. Locked source groups are refused.
   */
  async mergeInto(payload: {
    sourceFolderId: string;
    targetFolderId: string;
  }): Promise<{ success: boolean; movedItems: number; error?: string }> {
    const db = await getDb();
    const sourceId = (payload.sourceFolderId || "").trim();
    const targetId = (payload.targetFolderId || "").trim();
    if (!sourceId || !targetId || sourceId === targetId) {
      return { success: false, movedItems: 0, error: "INVALID_MERGE" };
    }
    const sourceDoc = await this.getFolderWithAccess(db, sourceId);
    const targetDoc = await this.getFolderWithAccess(db, targetId);
    if (!sourceDoc || !targetDoc) return { success: false, movedItems: 0, error: "NOT_FOUND" };
    if (sourceDoc.get("isLocked") === true) {
      return { success: false, movedItems: 0, error: "LOCKED" };
    }

    const targetSpaceId = this.resolveSpaceId(targetDoc.get("spaceId") as string | undefined);
    const now = Date.now();

    const targetItems = await db.items
      .find({ selector: { folderId: { $eq: targetId }, deletedAt: { $eq: 0 } } })
      .exec();
    let nextOrder =
      targetItems.reduce(
        (max, doc) => Math.max(max, (doc.get("chunkOrder") as number | undefined) ?? -1),
        -1
      ) + 1;

    const sourceItems = await db.items
      .find({ selector: { folderId: { $eq: sourceId }, deletedAt: { $eq: 0 } } })
      .exec();
    for (const doc of sourceItems) {
      await doc.incrementalPatch({
        folderId: targetId,
        spaceId: targetSpaceId,
        chunkOrder: nextOrder++,
        updatedAt: now,
      });
    }
    const movedItems = sourceItems.length;

    // Re-parent any sub-groups of the source so they aren't orphaned.
    const childFolders = await db.folders
      .find({ selector: { parentId: { $eq: sourceId } } })
      .exec();
    for (const child of childFolders) {
      await child.incrementalPatch({ parentId: targetId, updatedAt: now });
    }

    await sourceDoc.remove();

    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
    } catch {}
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}

    return { success: true, movedItems };
  }

  private async collectDescendantIds(folderId: string, spaceId: string): Promise<Set<string>> {
    const db = await getDb();
    const all = await db.folders
      .find({ selector: { spaceId: { $eq: spaceId } } })
      .exec();
    const childrenByParent = new Map<string, string[]>();
    for (const doc of all) {
      const parentId = (doc.get("parentId") as string | null | undefined) || null;
      if (!parentId) continue;
      const list = childrenByParent.get(parentId) || [];
      list.push(doc.primary as string);
      childrenByParent.set(parentId, list);
    }
    const visited = new Set<string>();
    const stack = [folderId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const childId of childrenByParent.get(id) || []) {
        if (!visited.has(childId)) stack.push(childId);
      }
    }
    return visited;
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

    if ((folder.spaceId || PUBLIC_SPACE_ID) === targetSpaceId) {
      return { success: true, movedItems: 0 };
    }

    const now = Date.now();
    const targetFolders = await db.folders.find({ selector: { spaceId: { $eq: targetSpaceId } } }).exec();
    const maxSortOrder = targetFolders.reduce((max, doc) => {
      const sortOrder = (doc.get("sortOrder") as number | undefined) ?? 0;
      return Math.max(max, sortOrder);
    }, 0);

    await folderDoc.incrementalPatch({
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
        vector_indexes: [],
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
