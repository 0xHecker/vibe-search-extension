import { SPACE_NOT_BINNED, computeBinPurgeAt } from "@src/common/spaces";
import type { FolderDocType } from "@src/schemas/folder_schema";
import type { ItemDocType } from "@src/schemas/item_schema";
import type { SpaceDocType } from "@src/schemas/space_schema";
import { getDb } from "@src/services/DatabaseService";

export type BinEntryKind = "space" | "folder" | "item";

export type BinEntry = {
  kind: BinEntryKind;
  id: string;
  name: string;
  subtitle: string;
  deletedAt: number;
  purgeAt: number;
  spaceId?: string;
  folderId?: string | null;
  itemCount?: number;
};

const isBinned = (value: number | undefined | null): boolean =>
  typeof value === "number" && value > SPACE_NOT_BINNED;

const sortEntries = (left: BinEntry, right: BinEntry): number =>
  (left.purgeAt || Number.MAX_SAFE_INTEGER) - (right.purgeAt || Number.MAX_SAFE_INTEGER) ||
  left.name.localeCompare(right.name);

const collectFolderTreeIds = (folders: FolderDocType[], rootId: string): Set<string> => {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      const parentId = folder.parentId || null;
      if (parentId && ids.has(parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
};

const itemName = (item: ItemDocType): string => {
  const title = (item.title || "").trim();
  if (title) return title;
  const url = (item.url || "").trim();
  return url || "Untitled tab";
};

export class BinController {
  [key: string]: any;

  async listContents(): Promise<BinEntry[]> {
    const db = await getDb();
    const [spaceDocs, folderDocs, itemDocs] = await Promise.all([
      db.spaces.find({ selector: { deletedAt: { $gt: SPACE_NOT_BINNED } } }).exec(),
      db.folders.find({ selector: { deletedAt: { $gt: SPACE_NOT_BINNED } } }).exec(),
      db.items.find({ selector: { deletedAt: { $gt: SPACE_NOT_BINNED } } }).exec(),
    ]);

    const spaces = spaceDocs.map((doc: any) => doc.toMutableJSON() as SpaceDocType);
    const folders = folderDocs.map((doc: any) => doc.toMutableJSON() as FolderDocType);
    const items = itemDocs.map((doc: any) => doc.toMutableJSON() as ItemDocType);
    const binnedSpaceIds = new Set(spaces.map((space) => space.id));
    const binnedFolderIds = new Set(folders.map((folder) => folder.id));

    const folderEntries: BinEntry[] = [];
    const itemFolderIdsCoveredByFolderEntries = new Set<string>();
    for (const folder of folders) {
      if (binnedSpaceIds.has(folder.spaceId)) continue;
      const parentId = folder.parentId || null;
      if (parentId && binnedFolderIds.has(parentId)) continue;

      const treeIds = collectFolderTreeIds(folders, folder.id);
      for (const folderId of treeIds) itemFolderIdsCoveredByFolderEntries.add(folderId);
      const itemCount = items.filter((item) => treeIds.has(item.folderId)).length;
      const label = folder.type === "tab_group" ? "Tab group" : "Folder";
      const savedTabs = `${itemCount} saved tab${itemCount === 1 ? "" : "s"}`;
      folderEntries.push({
        kind: "folder",
        id: folder.id,
        name: (folder.name || "").trim() || "Untitled folder",
        subtitle: itemCount > 0 ? `${label} · ${savedTabs}` : label,
        deletedAt: folder.deletedAt || 0,
        purgeAt: folder.purgeAt || computeBinPurgeAt(folder.deletedAt || 0),
        spaceId: folder.spaceId,
        folderId: folder.parentId || null,
        itemCount,
      });
    }

    const entries: BinEntry[] = [
      ...spaces.map((space) => ({
        kind: "space" as const,
        id: space.id,
        name: (space.name || "").trim() || "Untitled space",
        subtitle: space.isPrivate ? "Private space" : "Space",
        deletedAt: space.deletedAt || 0,
        purgeAt: space.purgeAt || computeBinPurgeAt(space.deletedAt || 0),
        spaceId: space.id,
      })),
      ...folderEntries,
      ...items
        .filter((item) => !binnedSpaceIds.has(item.spaceId))
        .filter((item) => !itemFolderIdsCoveredByFolderEntries.has(item.folderId))
        .map((item) => ({
          kind: "item" as const,
          id: item.id,
          name: itemName(item),
          subtitle: "Saved tab",
          deletedAt: item.deletedAt || 0,
          purgeAt: computeBinPurgeAt(item.deletedAt || 0),
          spaceId: item.spaceId,
          folderId: item.folderId || null,
        })),
    ];

    return entries.filter((entry) => isBinned(entry.deletedAt)).sort(sortEntries);
  }
}

export const binController = new BinController();
