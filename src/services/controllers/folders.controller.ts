import { getDb } from "@src/services/DatabaseService";
import { FolderDocType } from "@src/schemas/folder_schema";
import { v4 as uuidv4 } from "uuid";

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
      isLocked: false,
      isPinned: false,
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

  async setPinned(payload: { id: string; value: boolean }): Promise<void> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return;
    await doc.patch({ isPinned: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
  }

  async setLocked(payload: { id: string; value: boolean }): Promise<void> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return;
    await doc.patch({ isLocked: payload.value, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
  }

  async rename(payload: { id: string; name: string }): Promise<void> {
    const db = await getDb();
    const doc = await db.folders.findOne(payload.id).exec();
    if (!doc) return;
    const name = payload.name.trim().slice(0, 80);
    await doc.patch({ name, updatedAt: Date.now() });
    try {
      chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
    } catch {}
  }
}

export const foldersController = new FoldersController();
