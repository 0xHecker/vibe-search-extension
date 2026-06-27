import type { FolderDocType } from "@src/schemas/folder_schema";
import type { SpaceGroupDocType } from "@src/schemas/space_group_schema";

export type SidebarSpace = {
  id: string;
  name: string;
  slug: string;
  spaceGroupId: string | null;
  isPrivate: boolean;
  sortOrder: number;
  isArchived: boolean;
  deletedAt: number;
  purgeAt: number;
  createdAt: number;
  updatedAt: number;
  access: {
    isUnlocked: boolean;
    requiresPassword: boolean;
    hasRecovery: boolean;
    recoveryQuestions: string[];
    autoLockMs: number;
    remainingMs?: number;
    lastActivityAt?: number;
  };
};

/**
 * Sidebar sort rules:
 * - Pinned folders float to the top of their siblings.
 * - Otherwise: explicit sortOrder, then createdAt as tiebreaker.
 *
 * These helpers are presentation-only: they never mutate input arrays and
 * never trigger a re-query. Controllers own persistence; the sidebar owns the
 * optimistic copy.
 */
export const sortSidebarFolders = (list: FolderDocType[]): FolderDocType[] =>
  [...list].sort((a, b) => {
    if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.createdAt - b.createdAt;
  });

export const sortSidebarSpaces = (list: SidebarSpace[]): SidebarSpace[] =>
  [...list].sort((a, b) => {
    if (!!a.isPrivate !== !!b.isPrivate) return a.isPrivate ? 1 : -1;
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.createdAt - b.createdAt;
  });

export const sortSidebarSpaceGroups = (list: SpaceGroupDocType[]): SpaceGroupDocType[] =>
  [...list].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt - b.createdAt;
  });

export const NESTED_FOLDER_INDENT_PX = 18;

/**
 * Returns a Map keyed by parent folder id (null = root) containing that
 * parent's direct children. Used by the recursive tab-group renderer so we
 * never filter the whole folder list inside render.
 */
export const buildFolderChildren = (
  folders: FolderDocType[]
): Map<string | null, FolderDocType[]> => {
  const map = new Map<string | null, FolderDocType[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? null;
    const list = map.get(key) || [];
    list.push(folder);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.createdAt - b.createdAt;
    });
  }
  return map;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const formatBinRemainingLabel = (purgeAt: number, now: number): string => {
  if (!purgeAt || purgeAt <= now) return "purging";
  const days = Math.max(0, Math.ceil((purgeAt - now) / MS_PER_DAY));
  if (days <= 0) return "<1d left";
  if (days === 1) return "1d left";
  return `${days}d left`;
};