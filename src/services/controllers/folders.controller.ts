import { getDb } from "@src/services/DatabaseService";
import { FolderDocType } from "@src/schemas/folder_schema";
import { v4 as uuidv4 } from "uuid";
import { databaseManager } from "@src/services/db-manager";

export class FoldersController {
  [key: string]: any;

  async create(payload: {
    name: string;
    userId?: string | null;
    parentId?: string | null;
  }): Promise<FolderDocType> {
    const db = await getDb();
    const now = Date.now();
    const folder: FolderDocType = {
      id: uuidv4(),
      name: payload.name,
      userId: payload.userId ?? null,
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
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return { success: false };
    await doc.patch({ isPinned: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async setLocked(payload: { id: string; value: boolean }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return { success: false };
    await doc.patch({ isLocked: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async setCollapsed(payload: { id: string; value: boolean }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return { success: false };
    await doc.patch({ isCollapsed: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
    return { success: true };
  }

  async rename(payload: { id: string; name: string }): Promise<{ success: boolean }> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
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
    const doc = await db.folders.findOne(payload.id).exec();
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

  async reorder(payload: { orderedIds: string[] }): Promise<{ success: boolean }> {
    const db = await getDb();
    const docs = await db.folders.find().exec();
    if (docs.length === 0) return { success: true };
    const allIds = docs.map((d) => d.primary);
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
}

export const foldersController = new FoldersController();
