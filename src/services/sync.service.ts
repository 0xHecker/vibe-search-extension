import { databaseManager } from "./db-manager";
import { vectorStoreService } from "./vector-store.service";

class SyncService {
  [key: string]: any;
  private isSyncing = false;

  /**
   * Philosophy: To maintain a healthy and efficient vector store, we use a
   * "rebuild and compact" strategy. This process runs periodically to:
   *  1. Remove vectors for deleted items.
   *  2. Re-embed items whose content has changed (marked as `isDirty`).
   *  3. Compact the vector file to reclaim space and keep searches fast.
   * This is a safe, atomic operation that works on a temporary file and
   * replaces the old one only upon successful completion, preventing data loss.
   */
  public async rebuildAndCompact() {
    if (this.isSyncing) {
      console.log("Sync already in progress. Skipping.");
      return;
    }

    this.isSyncing = true;
    console.log("Starting vector store rebuild and compaction...");

    try {
      // Step 1: Get all active items from the database
      const activeItems = await databaseManager.getAllActiveItems();
      if (activeItems.length === 0) {
        console.log("No active items found. Clearing vector store.");
        await vectorStoreService.clearStorage();
        return;
      }

      // Step 2: Create a new temporary vector file
      await vectorStoreService.createNewVectorFile("vectors.tmp");

      // Step 3: Separate dirty and clean items
      const dirtyItems = activeItems.filter((item) => item.isDirty);
      const cleanItems = activeItems
        .filter((item) => !item.isDirty)
        .filter((item) => item.vector_index !== undefined && item.vector_index > -1) as {
        id: string;
        vector_index: number;
      }[];

      // Step 4: Re-embed dirty items and copy clean vectors
      const { newIndexMap } = await vectorStoreService.rebuildVectors(
        "vectors.tmp",
        dirtyItems,
        cleanItems
      );

      // Step 5: Update the database with the new vector indexes and clear dirty flags
      const updates = newIndexMap.map((item: { id: string; vector_index: number }) => ({
        id: item.id,
        vector_index: item.vector_index,
        isDirty: false,
      }));
      await databaseManager.bulkUpdateItems(updates);

      // Step 6: Atomically replace the old file with the new one
      await vectorStoreService.renameFile("vectors.tmp", "vectors.bin");

      // Step 7: Clear the deleted items collection
      await databaseManager.clearDeletedItems();

      console.log("Vector store rebuild and compaction complete.");
    } catch (error) {
      console.error("Error during vector store rebuild:", error);
      // Attempt to clean up the temporary file if it exists
      await vectorStoreService.deleteFile("vectors.tmp");
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncService = new SyncService();
