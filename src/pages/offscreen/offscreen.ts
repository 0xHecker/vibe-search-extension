import { OffscreenRouter } from "@src/services/router";
import { vectorStoreService } from "@src/services/vector-store.service";
import { databaseManager } from "@src/services/db-manager";
import { getDb } from "@src/services/DatabaseService";
import { syncService } from "@src/services/sync.service";
import { itemsController } from "@src/services/controllers/items.controller";
import { foldersController } from "@src/services/controllers/folders.controller";
import { tagsController } from "@src/services/controllers/tags.controller";
import { spacesController } from "@src/services/controllers/spaces.controller";
import { vectorPipelineCoordinator } from "@src/services/vector-pipeline-coordinator";
import { queryRankerService } from "@src/services/query-ranker.service";
import type { ItemDocType } from "@src/schemas/item_schema";
import { composeEmbeddingText, EMBEDDING_TEXT_VERSION } from "@src/search-core/embedding-text";

const sendStatusUpdate = (message: string) => {
  try {
    chrome.runtime.sendMessage({ type: "STATUS_UPDATE", payload: message });
  } catch {}
};

const sendProcessStatus = (payload: {
  id: string;
  label: string;
  state: "processing" | "success" | "error";
  detail: string;
  retryAction?: "RETRY_QUERY" | "TRIGGER_EMBEDDING" | "REBUILD_INDEX" | "REBUILD_VECTORS";
}) => {
  try {
    chrome.runtime.sendMessage({
      type: "PROCESS_STATUS",
      payload: {
        ...payload,
        updatedAt: Date.now(),
      },
    });
  } catch {}
};

type DbChangeScope = "items" | "folders" | "tags" | "spaces";

const DB_CHANGE_FLUSH_MS = 160;
let dbChangeFlushTimer: number | null = null;
const pendingDbScopes = new Set<DbChangeScope>();
const pendingItemIds = new Set<string>();

const flushDbChanges = () => {
  dbChangeFlushTimer = null;
  const scopes = Array.from(pendingDbScopes);
  pendingDbScopes.clear();

  const changedItemIds = Array.from(pendingItemIds).slice(0, 4000);
  pendingItemIds.clear();

  for (const scope of scopes) {
    try {
      chrome.runtime.sendMessage({
        type: "DB_CHANGE",
        scope,
        changedItemIds: scope === "items" ? changedItemIds : undefined,
        isCoalesced: true,
      });
    } catch {}
  }
};

const isTrustedForwarderSender = (sender: chrome.runtime.MessageSender): boolean => {
  if (!sender || sender.id !== chrome.runtime.id) {
    return false;
  }
  if (sender.tab) {
    return false;
  }
  const senderUrl = typeof sender.url === "string" ? sender.url : "";
  if (!senderUrl) return true;

  try {
    const path = new URL(senderUrl).pathname || "";
    if (path.includes("/src/pages/")) return false;
    if (path.endsWith(".html") && !path.endsWith("/_generated_background_page.html")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

const scheduleDbChange = (scope: DbChangeScope, changedItemIds?: string[]) => {
  pendingDbScopes.add(scope);
  if (scope === "items" && changedItemIds && changedItemIds.length > 0) {
    for (const itemId of changedItemIds) {
      if (itemId) pendingItemIds.add(itemId);
    }
  }

  if (dbChangeFlushTimer !== null) return;
  dbChangeFlushTimer = window.setTimeout(flushDbChanges, DB_CHANGE_FLUSH_MS);
};

const collectItemIdsFromCollectionChange = (changeEvent: any): string[] => {
  const ids = new Set<string>();

  const pushMaybeId = (value: unknown) => {
    if (typeof value === "string" && value) {
      ids.add(value);
    }
  };

  const visitEvent = (event: any) => {
    pushMaybeId(event?.documentId);
    pushMaybeId(event?.documentData?.id);
    pushMaybeId(event?.previousDocumentData?.id);
  };

  if (Array.isArray(changeEvent?.events)) {
    for (const event of changeEvent.events) {
      visitEvent(event);
    }
  } else {
    visitEvent(changeEvent);
  }

  return Array.from(ids);
};

const collectItemIdsFromItemTagsChange = (changeEvent: any): string[] => {
  const ids = new Set<string>();

  const pushMaybeId = (value: unknown) => {
    if (typeof value === "string" && value) {
      ids.add(value);
    }
  };

  const visitEvent = (event: any) => {
    pushMaybeId(event?.documentData?.itemId);
    pushMaybeId(event?.previousDocumentData?.itemId);
  };

  if (Array.isArray(changeEvent?.events)) {
    for (const event of changeEvent.events) {
      visitEvent(event);
    }
  } else {
    visitEvent(changeEvent);
  }

  return Array.from(ids);
};

const didTagNameChange = (changeEvent: any): boolean => {
  const isNameChanged = (event: any): boolean => {
    const operation = event?.operation;
    if (operation === "DELETE") return true;
    if (operation === "UPDATE") {
      return (event?.documentData?.name || "") !== (event?.previousDocumentData?.name || "");
    }
    return false;
  };

  if (Array.isArray(changeEvent?.events)) {
    for (const event of changeEvent.events) {
      if (isNameChanged(event)) {
        return true;
      }
    }
    return false;
  }

  return isNameChanged(changeEvent);
};

console.log("[Offscreen] Document script loaded.");

const router = new OffscreenRouter();

// Register all the services that the offscreen document will manage.
router.registerService("dbManager", databaseManager, {
  methods: ["getAllFolders", "getImportTargets"],
});
router.registerService("sync", syncService, {
  methods: ["rebuildAndCompact"],
});
router.registerService("items", itemsController, {
  methods: [
    "saveFetchedMetadata",
    "markSearchIndexDirty",
    "queryLocal",
    "addToFolder",
    "addMany",
    "refetchMetadata",
    "moveToSpace",
    "moveToFolder",
    "reorder",
    "delete",
  ],
});
router.registerService("folders", foldersController, {
  methods: [
    "create",
    "setPinned",
    "setLocked",
    "setCollapsed",
    "rename",
    "delete",
    "reorder",
    "moveToSpace",
    "copyToSpace",
  ],
});
router.registerService("tags", tagsController, {
  methods: ["getTagsForItem", "searchTags", "addTagToItem", "removeTagFromItem"],
});
router.registerService("spaces", spacesController, {
  methods: [
    "listSpaces",
    "createSpace",
    "renameSpace",
    "setPrivatePassword",
    "unlockSpace",
    "changePrivatePassword",
    "recoverPrivatePassword",
    "lockSpace",
    "touchSpaceActivity",
    "getSpaceAccessState",
  ],
});

// Start listening for messages.
router.listen();

// --- Robust Embedding Queue ---
const EMBEDDING_BATCH_SIZE = 20; // Process 20 items at a time for embeddings
const EMBEDDING_SCHEMA_VERSION_STORAGE_KEY = "vibe.search.embeddingTextVersion";
let isEmbeddingRunning = false;
let embeddingScheduled = false;
let embeddingCheckTimer: number | null = null;
let embeddingWaitNotified = false;

type EmbeddingBatchItem = Pick<
  ItemDocType,
  "id" | "title" | "textContent" | "url" | "source" | "authorUsername" | "media"
>;

const ensureEmbeddingSchemaVersion = async () => {
  try {
    const storage = await chrome.storage.local.get(EMBEDDING_SCHEMA_VERSION_STORAGE_KEY);
    const currentVersion =
      typeof storage[EMBEDDING_SCHEMA_VERSION_STORAGE_KEY] === "string"
        ? (storage[EMBEDDING_SCHEMA_VERSION_STORAGE_KEY] as string)
        : "";

    if (currentVersion === EMBEDDING_TEXT_VERSION) {
      return;
    }

    sendProcessStatus({
      id: "embedding-schema",
      label: "Embedding schema",
      state: "processing",
      detail: `Updating embedding schema ${currentVersion || "none"} -> ${EMBEDDING_TEXT_VERSION}...`,
    });

    const updatedCount = await databaseManager.markAllActiveItemsForReembedding();
    await chrome.storage.local.set({
      [EMBEDDING_SCHEMA_VERSION_STORAGE_KEY]: EMBEDDING_TEXT_VERSION,
    });

    sendProcessStatus({
      id: "embedding-schema",
      label: "Embedding schema",
      state: "success",
      detail:
        updatedCount > 0
          ? `Re-embedding scheduled for ${updatedCount} items.`
          : "Embedding schema is up to date.",
    });
  } catch (error) {
    console.error("[Offscreen] Failed embedding schema update:", error);
    sendProcessStatus({
      id: "embedding-schema",
      label: "Embedding schema",
      state: "error",
      detail: error instanceof Error ? error.message : "Failed to update embedding schema.",
      retryAction: "TRIGGER_EMBEDDING",
    });
  }
};

const maybeReportEmbeddingWait = () => {
  if (vectorPipelineCoordinator.getActiveOperation() === "compaction") {
    if (!embeddingWaitNotified) {
      sendProcessStatus({
        id: "embedding-queue",
        label: "Embedding queue",
        state: "processing",
        detail: "Waiting for vector maintenance to finish...",
      });
      embeddingWaitNotified = true;
    }
    return;
  }

  embeddingWaitNotified = false;
};

const runEmbeddingBatch = async (
  batch: EmbeddingBatchItem[],
  updateForItem: (item: EmbeddingBatchItem, vectorIndex: number) => Record<string, unknown>
): Promise<number> => {
  maybeReportEmbeddingWait();

  return vectorPipelineCoordinator.runExclusive("embedding", async () => {
    const sentences = batch.map((item) => composeEmbeddingText(item));
    const appendResult = await vectorStoreService.generateAndStoreEmbeddings({ sentences });
    if (appendResult.appendedCount !== batch.length) {
      throw new Error(
        `Embedding append mismatch: expected ${batch.length}, got ${appendResult.appendedCount}`
      );
    }

    const updates = batch.map((item, idx) => updateForItem(item, appendResult.startIndex + idx));
    await databaseManager.bulkUpdateItems(updates);
    return appendResult.appendedCount;
  });
};

/**
 * Process all pending embeddings in batches.
 * This function is designed to be called frequently and will
 * handle both new items and dirty items efficiently.
 */
const processEmbeddingQueue = async () => {
  if (isEmbeddingRunning) {
    // Already running, schedule another run when done
    embeddingScheduled = true;
    return;
  }

  isEmbeddingRunning = true;
  embeddingScheduled = false;
  sendProcessStatus({
    id: "embedding-queue",
    label: "Embedding queue",
    state: "processing",
    detail: "Embedding queued records...",
  });

  let processError: string | null = null;
  try {
    // Process new items (not yet embedded)
    let totalNewProcessed = 0;
    while (true) {
      const itemsToEmbed = await databaseManager.getItemsToEmbed();
      const batch = itemsToEmbed.slice(0, EMBEDDING_BATCH_SIZE);

      if (batch.length === 0) break;

      console.log(
        `[Offscreen] Embedding ${batch.length} new items (${itemsToEmbed.length} total pending)...`
      );

      try {
        const appendedCount = await runEmbeddingBatch(batch, (item, vectorIndex) => ({
          id: item.id,
          vector_index: vectorIndex,
          isEmbedded: true,
          isDirty: false,
        }));
        totalNewProcessed += appendedCount;

        // Notify UI of progress
        sendStatusUpdate(`Embedded ${totalNewProcessed} new items...`);
        sendProcessStatus({
          id: "embedding-queue",
          label: "Embedding queue",
          state: "processing",
          detail: `Embedded ${totalNewProcessed} new items...`,
        });
      } catch (error) {
        console.error("[Offscreen] Error embedding new items batch:", error);
        processError = error instanceof Error ? error.message : "Embedding failed for a batch";
        break;
      }
    }

    if (totalNewProcessed > 0) {
      console.log(`[Offscreen] Finished embedding ${totalNewProcessed} new items`);
    }

    // Process dirty items (need re-embedding)
    const dirtyItems = await databaseManager.getDirtyItems();
    if (dirtyItems.length > 0) {
      console.log(`[Offscreen] Re-embedding ${dirtyItems.length} dirty items...`);

      // Process dirty items in batches too
      for (let i = 0; i < dirtyItems.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = dirtyItems.slice(i, i + EMBEDDING_BATCH_SIZE);

        try {
          await runEmbeddingBatch(batch, (item, vectorIndex) => ({
            id: item.id,
            vector_index: vectorIndex,
            isEmbedded: true,
            isDirty: false,
          }));
        } catch (error) {
          console.error("[Offscreen] Error re-embedding dirty items batch:", error);
          processError =
            error instanceof Error ? error.message : "Re-embedding failed for a dirty batch";
          break;
        }
      }

      console.log(`[Offscreen] Finished re-embedding ${dirtyItems.length} dirty items`);
    }

    if (processError) {
      sendProcessStatus({
        id: "embedding-queue",
        label: "Embedding queue",
        state: "error",
        detail: processError,
        retryAction: "TRIGGER_EMBEDDING",
      });
    } else {
      sendProcessStatus({
        id: "embedding-queue",
        label: "Embedding queue",
        state: "success",
        detail: "Embedding queue is idle.",
      });
    }
  } finally {
    isEmbeddingRunning = false;

    // If another embedding was requested while we were running, run again
    if (embeddingScheduled) {
      setTimeout(processEmbeddingQueue, 100);
    }
  }
};

/**
 * Trigger embedding processing. Safe to call frequently -
 * will debounce and batch automatically.
 */
export const triggerEmbedding = () => {
  if (isEmbeddingRunning) {
    embeddingScheduled = true;
  } else {
    // Small delay to allow batch accumulation
    setTimeout(processEmbeddingQueue, 200);
  }
};

const scheduleEmbeddingIfNeeded = () => {
  if (embeddingCheckTimer !== null) {
    return;
  }

  embeddingCheckTimer = window.setTimeout(async () => {
    embeddingCheckTimer = null;
    try {
      const [newItems, dirtyItems] = await Promise.all([
        databaseManager.getItemsToEmbed(),
        databaseManager.getDirtyItems(),
      ]);
      if (newItems.length > 0 || dirtyItems.length > 0) {
        triggerEmbedding();
      }
    } catch (error) {
      console.error("[Offscreen] Failed to check embedding backlog:", error);
    }
  }, 250);
};

// Listen for direct embedding trigger messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRIGGER_EMBEDDING" && message.isForwarded) {
    if (!isTrustedForwarderSender(sender)) {
      sendResponse({ success: false, error: "UNAUTHORIZED_FORWARDER" });
      return true;
    }
    console.log("[Offscreen] Received TRIGGER_EMBEDDING message");
    triggerEmbedding();
    sendResponse({ success: true });
    return true;
  }
});

const initializeApp = async () => {
  try {
    queryRankerService.prewarm();
    sendStatusUpdate("Initializing database...");
    sendProcessStatus({
      id: "offscreen-runtime",
      label: "Worker runtime",
      state: "processing",
      detail: "Initializing offscreen services...",
    });
    const db = await getDb();
    await spacesController.ensureDefaults();
    await spacesController.maybeRepairFolderAndItemSpaceAssignments();
    sendStatusUpdate("Database initialized.");

    const items = await db.items.find().exec();
    console.log(`[Offscreen] Found ${items.length} items in the database.`);

    // Recover interrupted vector maintenance before new embedding work begins.
    await syncService.recoverInterruptedMaintenance();
    await ensureEmbeddingSchemaVersion();

    // Initial embedding process
    await processEmbeddingQueue();

    // Subscribe to item changes and trigger embedding
    db.items.$.subscribe((changeEvent: any) => {
      const changedIds = collectItemIdsFromCollectionChange(changeEvent);
      itemsController.scheduleSearchIndexSync(changedIds);
      scheduleDbChange("items", changedIds);
      // Trigger embedding only when there is actual pending work.
      scheduleEmbeddingIfNeeded();
    });

    db.folders.$.subscribe(() => {
      scheduleDbChange("folders");
    });

    db.spaces.$.subscribe(() => {
      scheduleDbChange("spaces");
    });

    db.tags.$.subscribe((changeEvent: any) => {
      if (didTagNameChange(changeEvent)) {
        itemsController.markSearchIndexDirty();
        scheduleDbChange("items");
      } else {
        scheduleDbChange("tags");
      }
    });

    db.item_tags.$.subscribe((changeEvent: any) => {
      const changedItemIds = collectItemIdsFromItemTagsChange(changeEvent);
      if (changedItemIds.length > 0) {
        itemsController.scheduleSearchIndexSync(changedItemIds);
      } else {
        itemsController.markSearchIndexDirty();
      }
      scheduleDbChange("items", changedItemIds);
    });

    console.log("[Offscreen] Initialization complete with auto-embedding enabled.");
    sendProcessStatus({
      id: "offscreen-runtime",
      label: "Worker runtime",
      state: "success",
      detail: "Offscreen services are ready.",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    console.error("[Offscreen] Error during initialization:", error);
    sendStatusUpdate(`Error: ${errorMessage}`);
    sendProcessStatus({
      id: "offscreen-runtime",
      label: "Worker runtime",
      state: "error",
      detail: errorMessage,
      retryAction: "RETRY_QUERY",
    });
  }
};

initializeApp();
