import { getDb } from "@src/services/DatabaseService";
import type { ItemDocType } from "@src/schemas/item_schema";
import { UNGROUPED_SPACE_GROUP_ID } from "@src/schemas/space_schema";
import { readOpfsFile, saveMediaToOpfs } from "@src/services/media-storage";
import { isMetadataFetchableUrl } from "@src/utils/metadata-url";

const MIGRATION_FORMAT = "vibesearch-local-extension-migration";
const MIGRATION_VERSION = 1;
const RESTORE_BATCH_SIZE = 400;

const COLLECTION_NAMES = [
  // space_groups first: spaces reference a spaceGroupId, and exporting the groups
  // keeps named collections like "Browser Bookmarks" and "GitHub Stars" intact
  // across an export → restore round-trip (previously they were dropped).
  "space_groups",
  "spaces",
  "folders",
  "items",
  "tags",
  "item_tags",
  "search_history",
  "flashcards",
  "deleted_items",
] as const;

type MigrationCollectionName = (typeof COLLECTION_NAMES)[number];
type MigrationCollections = Record<MigrationCollectionName, Record<string, unknown>[]>;

type MigratedOpfsFile = {
  opfsPath: string;
  mimeType: string;
  base64: string;
};

export type LocalExtensionMigrationBundle = {
  format: typeof MIGRATION_FORMAT;
  version: typeof MIGRATION_VERSION;
  createdAt: number;
  collections: MigrationCollections;
  opfsFiles: MigratedOpfsFile[];
  warnings: string[];
};

export type LocalExtensionMigrationSummary = {
  collections: Record<MigrationCollectionName, number>;
  opfsFileCount: number;
  warningCount: number;
};

export type RestoreLocalExtensionMigrationResult = LocalExtensionMigrationSummary & {
  restoredOpfsFileCount: number;
  scheduledReembeddingItemCount: number;
  metadataPendingUrlCount: number;
};

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const createEmptyCollections = (): MigrationCollections => ({
  space_groups: [],
  spaces: [],
  folders: [],
  items: [],
  tags: [],
  item_tags: [],
  search_history: [],
  flashcards: [],
  deleted_items: [],
});

const summarize = (
  collections: MigrationCollections,
  opfsFileCount: number,
  warningCount: number
): LocalExtensionMigrationSummary => ({
  collections: Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, collections[name].length])
  ) as LocalExtensionMigrationSummary["collections"],
  opfsFileCount,
  warningCount,
});

const yieldToEventLoop = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const bulkUpsertInBatches = async (collection: { bulkUpsert: (rows: Record<string, unknown>[]) => Promise<unknown> }, rows: Record<string, unknown>[]) => {
  for (let start = 0; start < rows.length; start += RESTORE_BATCH_SIZE) {
    await collection.bulkUpsert(rows.slice(start, start + RESTORE_BATCH_SIZE));
    await yieldToEventLoop();
  }
};

export const summarizeLocalExtensionMigrationBundle = (
  bundle: LocalExtensionMigrationBundle
): LocalExtensionMigrationSummary => summarize(bundle.collections, bundle.opfsFiles.length, bundle.warnings.length);

const getReferencedOpfsPaths = (items: Record<string, unknown>[]): string[] => {
  const paths = new Set<string>();
  for (const item of items) {
    const media = (item as ItemDocType).media;
    for (const entry of media || []) {
      if (entry.storageType === "opfs" && typeof entry.opfsPath === "string" && entry.opfsPath) {
        paths.add(entry.opfsPath);
      }
    }
  }
  return Array.from(paths);
};

const parseOpfsPath = (opfsPath: string): { itemId: string; fileName: string } | null => {
  const parts = opfsPath.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "media") return null;
  const [, itemId, fileName] = parts;
  if (!itemId || !fileName || itemId.includes("/") || fileName.includes("/")) return null;
  return { itemId, fileName };
};

// Imported items that were never enriched (or whose export predates metadata)
// arrive with `isMetaFetched !== true`. Collect their URLs so the import ->
// metadata -> embedding chain runs automatically, mirroring bookmark imports.
export const collectMetadataPendingUrls = (items: Record<string, unknown>[]): string[] => {
  const urls = new Set<string>();
  for (const item of items) {
    const record = item as Partial<ItemDocType>;
    if (record.isMetaFetched === true) continue;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!isMetadataFetchableUrl(url)) continue;
    urls.add(url);
  }
  return Array.from(urls);
};

// Hand pending URLs to the background metadata pipeline, which paces, batches,
// dedupes, and retries them. Fire-and-forget: restore must not block on it.
const queueMetadataForRestoredItems = (urls: string[]) => {
  if (urls.length === 0) return;
  try {
    const runtime = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome?.runtime;
    void runtime
      ?.sendMessage?.({
        target: "background",
        type: "FETCH_METADATA",
        payload: { urls, revalidate: false },
      })
      ?.catch?.(() => {});
  } catch {}
};

export const validateLocalExtensionMigrationBundle = (
  value: unknown
): LocalExtensionMigrationBundle => {
  if (!value || typeof value !== "object") throw new Error("MIGRATION_FILE_INVALID");
  const bundle = value as Partial<LocalExtensionMigrationBundle>;
  if (bundle.format !== MIGRATION_FORMAT || bundle.version !== MIGRATION_VERSION) {
    throw new Error("MIGRATION_FILE_VERSION_UNSUPPORTED");
  }
  if (!bundle.collections || typeof bundle.collections !== "object") {
    throw new Error("MIGRATION_FILE_COLLECTIONS_INVALID");
  }
  for (const name of COLLECTION_NAMES) {
    if (!Array.isArray(bundle.collections[name])) {
      throw new Error(`MIGRATION_FILE_${name.toUpperCase()}_INVALID`);
    }
  }
  if (!Array.isArray(bundle.opfsFiles) || !Array.isArray(bundle.warnings)) {
    throw new Error("MIGRATION_FILE_MEDIA_INVALID");
  }
  for (const file of bundle.opfsFiles) {
    if (
      !file ||
      typeof file.opfsPath !== "string" ||
      typeof file.mimeType !== "string" ||
      typeof file.base64 !== "string" ||
      !parseOpfsPath(file.opfsPath)
    ) {
      throw new Error("MIGRATION_FILE_MEDIA_ENTRY_INVALID");
    }
  }
  return bundle as LocalExtensionMigrationBundle;
};

export const buildLocalExtensionMigrationBundle = async (): Promise<LocalExtensionMigrationBundle> => {
  const db = await getDb();
  const collections = createEmptyCollections();

  await Promise.all(
    COLLECTION_NAMES.map(async (name) => {
      const docs = await db[name].find().exec();
      collections[name] = docs.map((doc) => doc.toMutableJSON() as Record<string, unknown>);
    })
  );

  const warnings: string[] = [];
  const opfsFiles: MigratedOpfsFile[] = [];
  for (const opfsPath of getReferencedOpfsPaths(collections.items)) {
    const file = await readOpfsFile(opfsPath);
    if (!file) {
      warnings.push(`Local media file could not be read: ${opfsPath}`);
      continue;
    }
    opfsFiles.push({
      opfsPath,
      mimeType: file.type || "application/octet-stream",
      base64: toBase64(await file.arrayBuffer()),
    });
  }

  return {
    format: MIGRATION_FORMAT,
    version: MIGRATION_VERSION,
    createdAt: Date.now(),
    collections,
    opfsFiles,
    warnings,
  };
};

export const restoreLocalExtensionMigrationBundle = async (
  value: unknown
): Promise<RestoreLocalExtensionMigrationResult> => {
  const bundle = validateLocalExtensionMigrationBundle(value);
  const db = await getDb();

  // A vector index belongs to one OPFS origin. The source vector file is not
  // copied, so every migrated item enters the destination embedding queue.
  const migratedItems = bundle.collections.items.map((item) => {
    const url = typeof item.url === "string" ? item.url : "";
    return {
      ...item,
      vector_index: -1,
      vector_indexes: [],
      isEmbedded: false,
      isDirty: false,
      isMetaFetched: isMetadataFetchableUrl(url) ? item.isMetaFetched === true : true,
    };
  });
  const migratedSpaces = bundle.collections.spaces.map((space) => ({
    ...space,
    spaceGroupId:
      typeof space.spaceGroupId === "string" ? space.spaceGroupId : UNGROUPED_SPACE_GROUP_ID,
  }));

  const collections: MigrationCollections = {
    ...bundle.collections,
    spaces: migratedSpaces,
    items: migratedItems,
  };

  for (const name of COLLECTION_NAMES) {
    const rows = collections[name];
    if (rows.length > 0) {
      await bulkUpsertInBatches(db[name] as any, rows);
    }
  }

  let restoredOpfsFileCount = 0;
  for (const file of bundle.opfsFiles) {
    const parsed = parseOpfsPath(file.opfsPath);
    if (!parsed) continue;
    const bytes = fromBase64(file.base64);
    await saveMediaToOpfs(
      parsed.itemId,
      new File([bytes], parsed.fileName, { type: file.mimeType }),
      parsed.fileName
    );
    restoredOpfsFileCount += 1;
    if (restoredOpfsFileCount % 10 === 0) await yieldToEventLoop();
  }

  const metadataPendingUrls = collectMetadataPendingUrls(migratedItems);
  queueMetadataForRestoredItems(metadataPendingUrls);

  return {
    ...summarize(collections, bundle.opfsFiles.length, bundle.warnings.length),
    restoredOpfsFileCount,
    scheduledReembeddingItemCount: migratedItems.length,
    metadataPendingUrlCount: metadataPendingUrls.length,
  };
};
