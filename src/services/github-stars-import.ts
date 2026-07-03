import { getDb } from "@src/services/DatabaseService";
import { localSearchIndexService } from "@src/services/local-search-index.service";
import type { FolderDocType } from "@src/schemas/folder_schema";
import type { ItemDocType } from "@src/schemas/item_schema";
import type { SpaceDocType } from "@src/schemas/space_schema";
import type { SpaceGroupDocType } from "@src/schemas/space_group_schema";
import { MAX_BOOKMARKS_PER_SPACE } from "@src/services/browser-bookmark-import";

export const GITHUB_STARS_SPACE_GROUP_ID = "space_group_github_stars";
export const GITHUB_STARS_SPACE_GROUP_NAME = "GitHub Stars";

const IMPORT_BATCH_SIZE = 200;

export type GitHubStar = {
  id: string;
  fullName: string;
  url: string;
  description?: string;
  language?: string;
  topics?: string[];
  ownerLogin?: string;
  ownerAvatarUrl?: string;
  stargazerCount?: number;
  starredAt?: number;
  folderName?: string;
};

export type GitHubStarsImportPlan = {
  spaceGroup: SpaceGroupDocType;
  spaces: SpaceDocType[];
  folders: FolderDocType[];
  items: ItemDocType[];
};

export type GitHubStarsImportResult = {
  spaceGroupId: string;
  spaceIds: string[];
  importedCount: number;
  updatedCount: number;
  removedCount: number;
  metadataUrls: string[];
};

const chunk = <T,>(values: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) result.push(values.slice(start, start + size));
  return result;
};

const stableHash = (value: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
};

const stableId = (kind: "space" | "folder" | "item", sourceId: string) =>
  `github-star-${kind}-${stableHash(sourceId)}`;

const cleanName = (value: string | undefined, fallback: string) =>
  (value || "").trim().replace(/\s+/g, " ").slice(0, 80) || fallback;

const slugify = (value: string, fallback: string) => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
};

const normalizeTimestamp = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : fallback;

export const buildGitHubStarsImportPlan = (
  stars: GitHubStar[],
  options?: { now?: number }
): GitHubStarsImportPlan => {
  const now = options?.now ?? Date.now();
  const validStars = stars.filter((star) => star.id && star.url && star.fullName);
  const grouped = new Map<string, GitHubStar[]>();
  for (const star of validStars) {
    const folderName = cleanName(star.folderName, "Starred repositories");
    const current = grouped.get(folderName) || [];
    current.push(star);
    grouped.set(folderName, current);
  }

  const spaceGroup: SpaceGroupDocType = {
    id: GITHUB_STARS_SPACE_GROUP_ID,
    name: GITHUB_STARS_SPACE_GROUP_NAME,
    sortOrder: now,
    isCollapsed: false,
    createdAt: now,
    updatedAt: now,
  };
  const spaces: SpaceDocType[] = [];
  const folders: FolderDocType[] = [];
  const items: ItemDocType[] = [];

  for (const [folderName, entries] of grouped) {
    const parts = chunk(entries, MAX_BOOKMARKS_PER_SPACE);
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      const suffix = parts.length > 1 ? ` (${partIndex + 1})` : "";
      const spaceName = `${folderName}${suffix}`.slice(0, 80);
      const spaceId = stableId("space", `${folderName}:${partIndex}`);
      const folderId = stableId("folder", `${folderName}:${partIndex}`);
      spaces.push({
        id: spaceId,
        name: spaceName,
        slug: slugify(spaceName, `github-stars-${partIndex + 1}`),
        spaceGroupId: GITHUB_STARS_SPACE_GROUP_ID,
        isPrivate: false,
        autoLockMs: 5 * 60 * 1000,
        sortOrder: spaces.length,
        isArchived: false,
        deletedAt: 0,
        purgeAt: 0,
        createdAt: now,
        updatedAt: now,
      });
      folders.push({
        id: folderId,
        name: spaceName,
        userId: "",
        spaceId,
        parentId: null,
        type: "folder",
        sortOrder: 0,
        isLocked: false,
        isPinned: false,
        isCollapsed: part.length > 300,
        deletedAt: 0,
        purgeAt: 0,
        isDirty: false,
        serverVersion: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (let index = 0; index < part.length; index += 1) {
        const star = part[index];
        const starredAt = normalizeTimestamp(star.starredAt, now);
        const textContent = [star.description, star.language, ...(star.topics || [])]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join("\n")
          .slice(0, 20_000);
        items.push({
          id: stableId("item", star.id),
          userId: "",
          title: star.fullName.slice(0, 500),
          textContent,
          ocrText: "",
          ocrStatus: "skipped",
          ocrModelVersion: "",
          ocrUpdatedAt: 0,
          url: star.url,
          source: "github",
          folderId,
          spaceId,
          isFavorite: false,
          authorUsername: star.ownerLogin,
          likes: Number.isFinite(star.stargazerCount) ? star.stargazerCount : undefined,
          iconUrl: star.ownerAvatarUrl,
          media: [],
          parentId: null,
          chunkOrder: index,
          vector_index: -1,
          vector_indexes: [],
          isEmbedded: false,
          isMetaFetched: false,
          isDirty: false,
          serverVersion: 0,
          createdAt: starredAt,
          updatedAt: starredAt,
          deletedAt: 0,
        });
      }
    }
  }
  return { spaceGroup, spaces, folders, items };
};

const notifyDbChange = (scope: "spaces" | "space_groups" | "folders" | "items") => {
  try {
    chrome.runtime.sendMessage({ type: "DB_CHANGE", scope });
  } catch {}
};

const updateItem = (existing: ItemDocType | undefined, candidate: ItemDocType, now: number) => {
  if (!existing) return candidate;
  const contentChanged =
    existing.title !== candidate.title ||
    existing.textContent !== candidate.textContent ||
    existing.url !== candidate.url ||
    existing.folderId !== candidate.folderId ||
    existing.spaceId !== candidate.spaceId ||
    existing.chunkOrder !== candidate.chunkOrder ||
    existing.authorUsername !== candidate.authorUsername ||
    existing.likes !== candidate.likes ||
    existing.iconUrl !== candidate.iconUrl ||
    existing.deletedAt !== 0;
  const needsMetadata = existing.isMetaFetched;
  if (!contentChanged && !needsMetadata) return null;
  return {
    ...existing,
    title: candidate.title,
    textContent: candidate.textContent,
    url: candidate.url,
    source: "github" as const,
    folderId: candidate.folderId,
    spaceId: candidate.spaceId,
    chunkOrder: candidate.chunkOrder,
    authorUsername: candidate.authorUsername,
    likes: candidate.likes,
    iconUrl: candidate.iconUrl,
    isEmbedded: contentChanged ? false : existing.isEmbedded,
    vector_index: contentChanged ? -1 : existing.vector_index,
    vector_indexes: contentChanged ? [] : existing.vector_indexes,
    isMetaFetched: false,
    isDirty: contentChanged ? false : existing.isDirty,
    deletedAt: 0,
    updatedAt: now,
  } satisfies ItemDocType;
};

export class GitHubStarsImportService {
  async importStars(payload: { stars?: GitHubStar[] }): Promise<GitHubStarsImportResult> {
    const db = await getDb();
    const now = Date.now();
    const plan = buildGitHubStarsImportPlan(Array.isArray(payload.stars) ? payload.stars : [], { now });
    localSearchIndexService.markDirty();

    const previousGroup = await db.space_groups.findOne(GITHUB_STARS_SPACE_GROUP_ID).exec();
    const existingGroup = previousGroup?.toMutableJSON() as SpaceGroupDocType | undefined;
    await db.space_groups.bulkUpsert([
      existingGroup
        ? { ...existingGroup, name: GITHUB_STARS_SPACE_GROUP_NAME, updatedAt: now }
        : plan.spaceGroup,
    ]);

    const existingSpaceDocs = await db.spaces
      .find({ selector: { spaceGroupId: { $eq: GITHUB_STARS_SPACE_GROUP_ID } } })
      .exec();
    const existingSpaces = new Map(
      existingSpaceDocs.map((doc) => [doc.get("id") as string, doc.toMutableJSON() as SpaceDocType])
    );
    const plannedSpaceIds = new Set(plan.spaces.map((space) => space.id));
    const spaceUpdates = plan.spaces.map((space) => {
      const existing = existingSpaces.get(space.id);
      return existing
        ? { ...existing, ...space, isArchived: false, updatedAt: now }
        : space;
    });
    const archivedSpaces = Array.from(existingSpaces.values())
      .filter((space) => !plannedSpaceIds.has(space.id) && !space.isArchived)
      .map((space) => ({ ...space, isArchived: true, updatedAt: now }));
    if (spaceUpdates.length > 0 || archivedSpaces.length > 0) {
      await db.spaces.bulkUpsert([...spaceUpdates, ...archivedSpaces]);
    }

    const relevantSpaceIds = Array.from(new Set([...existingSpaces.keys(), ...plannedSpaceIds]));
    const [folderDocs, itemDocs] = relevantSpaceIds.length
      ? await Promise.all([
          db.folders.find({ selector: { spaceId: { $in: relevantSpaceIds } } }).exec(),
          db.items.find({ selector: { spaceId: { $in: relevantSpaceIds } } }).exec(),
        ])
      : [[], []];
    const existingItems = new Map(
      itemDocs.map((doc) => [doc.get("id") as string, doc.toMutableJSON() as ItemDocType])
    );
    const existingFolders = new Map(
      folderDocs.map((doc) => [doc.get("id") as string, doc.toMutableJSON() as FolderDocType])
    );

    const folderUpdates = plan.folders.map((folder) => {
      const existing = existingFolders.get(folder.id);
      if (!existing) return folder;
      return {
        ...existing,
        name: folder.name,
        spaceId: folder.spaceId,
        parentId: null,
        sortOrder: folder.sortOrder,
        isDirty: false,
        updatedAt: now,
      } satisfies FolderDocType;
    });
    if (folderUpdates.length > 0) await db.folders.bulkUpsert(folderUpdates);
    let updatedCount = 0;
    for (const batch of chunk(plan.items, IMPORT_BATCH_SIZE)) {
      const updates = batch
        .map((item) => updateItem(existingItems.get(item.id), item, now))
        .filter((item): item is ItemDocType => item !== null);
      if (updates.length > 0) {
        await db.items.bulkUpsert(updates);
        updatedCount += updates.length;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const plannedItemIds = new Set(plan.items.map((item) => item.id));
    const removedItems = Array.from(existingItems.values())
      .filter((item) => !plannedItemIds.has(item.id) && item.deletedAt === 0)
      .map((item) => ({ ...item, deletedAt: now, updatedAt: now, isDirty: false }));
    if (removedItems.length > 0) await db.items.bulkUpsert(removedItems);

    const plannedFolderIds = new Set(plan.folders.map((folder) => folder.id));
    const removedFolderIds = folderDocs
      .map((doc) => doc.get("id") as string)
      .filter((id) => !plannedFolderIds.has(id));
    if (removedFolderIds.length > 0) await db.folders.bulkRemove(removedFolderIds);

    notifyDbChange("space_groups");
    notifyDbChange("spaces");
    notifyDbChange("folders");
    notifyDbChange("items");
    return {
      spaceGroupId: GITHUB_STARS_SPACE_GROUP_ID,
      spaceIds: plan.spaces.map((space) => space.id),
      importedCount: plan.items.length,
      updatedCount,
      removedCount: removedItems.length,
      metadataUrls: Array.from(new Set(plan.items.map((item) => item.url))),
    };
  }
}

export const githubStarsImportService = new GitHubStarsImportService();
