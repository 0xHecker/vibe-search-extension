import { OffscreenRouter } from "@src/services/router";
import { vectorStoreService } from "@src/services/vector-store.service";
import { embeddingService } from "@src/services/embedding.service";
import { databaseManager } from "@src/services/db-manager";
import { getDb, addDummyData } from "@src/services/DatabaseService";
import { syncService } from "@src/services/sync.service";

const sendStatusUpdate = (message: string) => {
  chrome.runtime.sendMessage({ type: "STATUS_UPDATE", payload: message });
};

console.log("Offscreen document script loaded.");

const router = new OffscreenRouter();

// Register all the services that the offscreen document will manage.
router.registerService("vectorStore", vectorStoreService);
router.registerService("embedding", embeddingService);
router.registerService("dbManager", databaseManager);
router.registerService("sync", syncService);
// To add a new service (e.g., for RxDB or image classification),
// you would simply create the service and register it here.
// router.registerService("imageClassifier", imageClassificationService);

// Start listening for messages.
router.listen();

const BATCH_SIZE = 100; // Process 100 items at a time

/**
 * Philosophy: The embedding process is split into two parts for a balance of
 * responsiveness and long-term efficiency.
 *
 * 1. Immediate "Append-Only" Updates:
 *    - `embedNewItems`: Handles items that have never been embedded before.
 *    - `embedDirtyItems`: Handles items that have been edited.
 *    Both functions immediately generate embeddings and APPEND them to the end of
 *    the vector file. This makes changes searchable almost instantly. The old
 *    vectors from dirty items are left as orphans, to be cleaned up later.
 *
 * 2. Periodic "Rebuild and Compact":
 *    - A scheduled alarm triggers the `syncService.rebuildAndCompact` method.
 *    - This process acts as a garbage collector, rebuilding the vector file with
 *      only the most current vectors, discarding all orphans and deleted item
 *      vectors. This keeps the store lean and efficient.
 */
const embedNewItems = async () => {
  sendStatusUpdate("Checking for new items to embed...");
  let totalProcessed = 0;

  while (true) {
    const itemsToEmbed = await databaseManager.getItemsToEmbed();
    const batch = itemsToEmbed.slice(0, BATCH_SIZE);

    if (batch.length === 0) {
      if (totalProcessed > 0) {
        sendStatusUpdate(`Finished embedding new items. Total processed: ${totalProcessed}`);
      }
      break;
    }

    sendStatusUpdate(
      `Found ${itemsToEmbed.length} new items. Processing batch of ${batch.length}...`
    );

    try {
      const startingVectorIndex = await vectorStoreService.getVectorCount();
      const sentences = batch.map((item: { textContent: string }) => item.textContent);
      await vectorStoreService.generateAndStoreEmbeddings({ sentences });

      const updates = batch.map((item: { id: string }, i: number) => ({
        id: item.id,
        vector_index: startingVectorIndex + i,
        isEmbedded: true,
        isDirty: false,
      }));

      await databaseManager.bulkUpdateItems(updates);
      totalProcessed += batch.length;
      sendStatusUpdate(`Batch of new items embedded. Total processed: ${totalProcessed}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
      console.error("Error embedding new items batch:", error);
      sendStatusUpdate(`EMBEDDING FAILED on new items batch: ${errorMessage}`);
      break;
    }
  }
};

const embedDirtyItems = async () => {
  sendStatusUpdate("Checking for dirty items to re-embed...");
  const dirtyItems = await databaseManager.getDirtyItems();

  if (dirtyItems.length === 0) {
    return;
  }

  sendStatusUpdate(`Found ${dirtyItems.length} dirty items. Re-embedding...`);
  try {
    const startingVectorIndex = await vectorStoreService.getVectorCount();
    const sentences = dirtyItems.map((item: { textContent: string }) => item.textContent);
    await vectorStoreService.generateAndStoreEmbeddings({ sentences });

    const updates = dirtyItems.map((item: { id: string }, i: number) => ({
      id: item.id,
      vector_index: startingVectorIndex + i,
      isDirty: false,
    }));

    await databaseManager.bulkUpdateItems(updates);
    sendStatusUpdate(`${dirtyItems.length} dirty items have been re-embedded.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    console.error("Error re-embedding dirty items:", error);
    sendStatusUpdate(`RE-EMBEDDING FAILED: ${errorMessage}`);
  }
};

const initializeApp = async () => {
  try {
    sendStatusUpdate("Initializing database...");
    const db = await getDb();
    sendStatusUpdate("Database initialized. Checking for seed data...");
    const items = await db.items.find().exec();

    if (items.length === 0) {
      sendStatusUpdate("No items found. Seeding database...");
      await addDummyData();
      sendStatusUpdate("Database seeded successfully.");
    } else {
      sendStatusUpdate(`Found ${items.length} items in the database.`);
    }

    // Initial embedding process
    await embedNewItems();
    await embedDirtyItems();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    console.error("Error during offscreen initialization:", error);
    sendStatusUpdate(`Error: ${errorMessage}`);
  }
};

initializeApp();
