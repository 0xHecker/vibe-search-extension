import { OffscreenRouter } from "@src/services/router";
import { vectorStoreService } from "@src/services/vector-store.service";
import { embeddingService } from "@src/services/embedding.service";
import { databaseManager } from "@src/services/db-manager";
import { getDb } from "@src/services/DatabaseService";
import { syncService } from "@src/services/sync.service";
import { itemsController } from "@src/services/controllers/items.controller";
import { foldersController } from "@src/services/controllers/folders.controller";
import { tagsController } from "@src/services/controllers/tags.controller";

const sendStatusUpdate = (message: string) => {
  try {
    chrome.runtime.sendMessage({ type: "STATUS_UPDATE", payload: message });
  } catch {}
};

console.log("[Offscreen] Document script loaded.");

const router = new OffscreenRouter();

// Register all the services that the offscreen document will manage.
router.registerService("vectorStore", vectorStoreService);
router.registerService("embedding", embeddingService);
router.registerService("dbManager", databaseManager);
router.registerService("sync", syncService);
router.registerService("items", itemsController);
router.registerService("folders", foldersController);
router.registerService("tags", tagsController);

// Start listening for messages.
router.listen();

// --- Robust Embedding Queue ---
const EMBEDDING_BATCH_SIZE = 20; // Process 20 items at a time for embeddings
let isEmbeddingRunning = false;
let embeddingScheduled = false;

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
        const startingVectorIndex = await vectorStoreService.getVectorCount();
        const sentences = batch.map((item: { textContent: string }) => item.textContent || "");
        await vectorStoreService.generateAndStoreEmbeddings({ sentences });

        const updates = batch.map((item: { id: string }, i: number) => ({
          id: item.id,
          vector_index: startingVectorIndex + i,
          isEmbedded: true,
          isDirty: false,
        }));

        await databaseManager.bulkUpdateItems(updates);
        totalNewProcessed += batch.length;

        // Notify UI of progress
        sendStatusUpdate(`Embedded ${totalNewProcessed} new items...`);
      } catch (error) {
        console.error("[Offscreen] Error embedding new items batch:", error);
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
          const startingVectorIndex = await vectorStoreService.getVectorCount();
          const sentences = batch.map((item: { textContent: string }) => item.textContent || "");
          await vectorStoreService.generateAndStoreEmbeddings({ sentences });

          const updates = batch.map((item: { id: string }, idx: number) => ({
            id: item.id,
            vector_index: startingVectorIndex + idx,
            isDirty: false,
          }));

          await databaseManager.bulkUpdateItems(updates);
        } catch (error) {
          console.error("[Offscreen] Error re-embedding dirty items batch:", error);
          break;
        }
      }

      console.log(`[Offscreen] Finished re-embedding ${dirtyItems.length} dirty items`);
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

// Listen for direct embedding trigger messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRIGGER_EMBEDDING" && message.isForwarded) {
    console.log("[Offscreen] Received TRIGGER_EMBEDDING message");
    triggerEmbedding();
    sendResponse({ success: true });
    return true;
  }
});

const initializeApp = async () => {
  try {
    sendStatusUpdate("Initializing database...");
    const db = await getDb();
    sendStatusUpdate("Database initialized.");

    const items = await db.items.find().exec();
    console.log(`[Offscreen] Found ${items.length} items in the database.`);

    // Initial embedding process
    await processEmbeddingQueue();

    // Subscribe to item changes and trigger embedding
    db.items.$.subscribe(() => {
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "items" });
      } catch {}
      // Trigger embedding when items change
      triggerEmbedding();
    });

    db.folders.$.subscribe(() => {
      try {
        chrome.runtime.sendMessage({ type: "DB_CHANGE", scope: "folders" });
      } catch {}
    });

    console.log("[Offscreen] Initialization complete with auto-embedding enabled.");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    console.error("[Offscreen] Error during initialization:", error);
    sendStatusUpdate(`Error: ${errorMessage}`);
  }
};

initializeApp();
