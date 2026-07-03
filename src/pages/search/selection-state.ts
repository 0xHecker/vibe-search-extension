import { PUBLIC_SPACE_ID } from "@src/common/spaces";
import type { FolderDocType } from "@src/schemas/folder_schema";

type SpaceLike = {
  id: string;
  spaceGroupId?: string | null;
};

export type FolderSelectionContext = {
  activeSpaceId: string;
  activeSpaceGroupId: string | null;
  selectedFolderId: string;
};

export const buildFolderLoadKey = (input: {
  activeSpaceId: string;
  searchScope: string;
  spaceIds?: string[];
}): string => {
  const spaceIds = [...(input.spaceIds || [])].filter(Boolean).sort().join(",");
  return `${input.activeSpaceId || PUBLIC_SPACE_ID}|${input.searchScope || "current"}|${spaceIds}`;
};

export const resolveFolderSelectionContext = (
  folderId: string,
  folders: Pick<FolderDocType, "id" | "spaceId">[],
  spaces: SpaceLike[]
): FolderSelectionContext | null => {
  if (!folderId || folderId === "all") {
    return {
      activeSpaceId: PUBLIC_SPACE_ID,
      activeSpaceGroupId: null,
      selectedFolderId: "all",
    };
  }

  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) return null;

  const activeSpaceId = folder.spaceId || PUBLIC_SPACE_ID;
  const space = spaces.find((entry) => entry.id === activeSpaceId) || null;
  return {
    activeSpaceId,
    activeSpaceGroupId: space?.spaceGroupId || null,
    selectedFolderId: folderId,
  };
};

export const buildSearchSelectionSearch = (input: {
  currentSearch: string;
  activeSpaceId: string;
  activeSpaceGroupId: string | null;
  selectedFolderId: string;
}): string => {
  const params = new URLSearchParams(input.currentSearch);
  if (input.activeSpaceId && input.activeSpaceId !== PUBLIC_SPACE_ID) {
    params.set("space", input.activeSpaceId);
  } else {
    params.delete("space");
  }
  if (input.activeSpaceGroupId) params.set("group", input.activeSpaceGroupId);
  else params.delete("group");
  if (input.selectedFolderId && input.selectedFolderId !== "all") {
    params.set("folder", input.selectedFolderId);
  } else {
    params.delete("folder");
  }
  return params.toString();
};
