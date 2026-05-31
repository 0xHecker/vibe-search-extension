import { databaseManager } from "./db-manager";
import { vectorStoreService } from "./vector-store.service";
import { vectorPipelineCoordinator } from "./vector-pipeline-coordinator";
import { vectorMaintenanceJournalService } from "./vector-maintenance-journal.service";

const sendProcessStatus = (payload: {
  id: string;
  label: string;
  state: "processing" | "success" | "error";
  detail: string;
  retryAction?: "REBUILD_VECTORS";
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

class SyncService {
  [key: string]: any;
  private isSyncing = false;
  private readonly tempFileName = "vectors.tmp";
  private readonly backupFileName = "vectors.bak";

  private async cleanupResidualCompactionFiles() {
    await vectorStoreService.deleteFile(this.tempFileName);
    await vectorStoreService.deleteFile(this.backupFileName);
  }

  public async recoverInterruptedMaintenance() {
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;
    try {
      await vectorPipelineCoordinator.runExclusive("compaction", async () => {
        const journal = await vectorMaintenanceJournalService.read();
        if (journal.phase === "idle") {
          await this.cleanupResidualCompactionFiles();
          return;
        }

        sendProcessStatus({
          id: "vector-sync",
          label: "Vector store",
          state: "processing",
          detail: "Recovering from interrupted vector maintenance...",
        });

        if (journal.phase === "preparing" || journal.phase === "prepared") {
          await this.cleanupResidualCompactionFiles();
          await vectorMaintenanceJournalService.clear("Recovered pre-swap interruption.");
          sendProcessStatus({
            id: "vector-sync",
            label: "Vector store",
            state: "success",
            detail: "Recovered interrupted vector maintenance.",
          });
          return;
        }

        if (journal.phase === "swapped") {
          const hasBackup = await vectorStoreService.fileExists(this.backupFileName);
          if (hasBackup) {
            await vectorStoreService.renameFile(this.backupFileName, "vectors.bin");
          }
          await vectorStoreService.deleteFile(this.tempFileName);

          const resetCount = await databaseManager.markAllActiveItemsForReembedding();
          await vectorStoreService.clearStorage();
          await databaseManager.clearDeletedItems();
          await vectorMaintenanceJournalService.clear(
            `Recovered interrupted swap; scheduled ${resetCount} items for re-embedding.`
          );

          sendProcessStatus({
            id: "vector-sync",
            label: "Vector store",
            state: "processing",
            detail: `Recovered interrupted commit. Re-embedding ${resetCount} items...`,
          });
          return;
        }

        if (journal.phase === "db_committed") {
          await this.cleanupResidualCompactionFiles();
          await vectorMaintenanceJournalService.clear("Recovered post-commit cleanup.");
          sendProcessStatus({
            id: "vector-sync",
            label: "Vector store",
            state: "success",
            detail: "Recovered vector maintenance cleanup.",
          });
          return;
        }
      });
    } catch (error) {
      console.error("Error during vector maintenance recovery:", error);
      sendProcessStatus({
        id: "vector-sync",
        label: "Vector store",
        state: "error",
        detail: error instanceof Error ? error.message : "Vector maintenance recovery failed.",
        retryAction: "REBUILD_VECTORS",
      });
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

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
      sendProcessStatus({
        id: "vector-sync",
        label: "Vector store",
        state: "processing",
        detail: "Vector compaction already in progress.",
      });
      return;
    }

    this.isSyncing = true;
    console.log("Starting vector store rebuild and compaction...");

    if (vectorPipelineCoordinator.getActiveOperation() === "embedding") {
      sendProcessStatus({
        id: "vector-sync",
        label: "Vector store",
        state: "processing",
        detail: "Waiting for embedding queue to settle...",
      });
    } else {
      sendProcessStatus({
        id: "vector-sync",
        label: "Vector store",
        state: "processing",
        detail: "Compacting vector store...",
      });
    }

    const tempFileName = this.tempFileName;
    const backupFileName = this.backupFileName;
    let backupExists = false;
    const operationId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

    try {
      await vectorPipelineCoordinator.runExclusive("compaction", async () => {
        await vectorMaintenanceJournalService.begin(operationId, "Vector compaction started.");
        sendProcessStatus({
          id: "vector-sync",
          label: "Vector store",
          state: "processing",
          detail: "Compacting vector store...",
        });

        // Step 1: Get all active items from the database
        const activeItems = await databaseManager.getAllActiveItems();
        if (activeItems.length === 0) {
          console.log("No active items found. Clearing vector store.");
          await vectorStoreService.clearStorage();
          sendProcessStatus({
            id: "vector-sync",
            label: "Vector store",
            state: "success",
            detail: "Vector store cleared. No active records.",
          });
          return;
        }

        // Step 2: Create a new temporary vector file
        await vectorStoreService.createNewVectorFile(tempFileName);

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
          tempFileName,
          dirtyItems,
          cleanItems
        );
        await vectorMaintenanceJournalService.setPhase("prepared", {
          operationId,
          detail: `Prepared compacted vectors for ${newIndexMap.length} items.`,
        });

        // Step 5: Create backup, swap in rebuilt vectors, then commit DB index updates.
        await vectorStoreService.copyFile("vectors.bin", backupFileName, { truncateDest: true });
        backupExists = true;
        await vectorStoreService.renameFile(tempFileName, "vectors.bin");
        await vectorMaintenanceJournalService.setPhase("swapped", {
          operationId,
          detail: "Swapped compacted vector file into place.",
        });

        const updates = newIndexMap.map((item: { id: string; vector_index: number }) => ({
          id: item.id,
          vector_index: item.vector_index,
          isEmbedded: true,
          isDirty: false,
        }));

        try {
          await databaseManager.bulkUpdateItems(updates);
          await databaseManager.clearDeletedItems();
          await vectorMaintenanceJournalService.setPhase("db_committed", {
            operationId,
            detail: `Committed vector indexes for ${updates.length} items.`,
          });
        } catch (dbError) {
          if (backupExists) {
            try {
              await vectorStoreService.renameFile(backupFileName, "vectors.bin");
              backupExists = false;
              await vectorMaintenanceJournalService.setPhase("prepared", {
                operationId,
                detail: "Rolled back swapped vectors after DB commit failure.",
              });
            } catch (rollbackError) {
              throw new Error(
                `Database update failed after vector swap, and rollback failed: ${
                  rollbackError instanceof Error ? rollbackError.message : "unknown rollback error"
                }`
              );
            }
          }
          throw dbError;
        }

        if (backupExists) {
          await vectorStoreService.deleteFile(backupFileName);
          backupExists = false;
        }
        await vectorMaintenanceJournalService.clear("Vector compaction complete.");

        console.log("Vector store rebuild and compaction complete.");
        sendProcessStatus({
          id: "vector-sync",
          label: "Vector store",
          state: "success",
          detail: "Vector compaction complete.",
        });
      });
    } catch (error) {
      console.error("Error during vector store rebuild:", error);
      sendProcessStatus({
        id: "vector-sync",
        label: "Vector store",
        state: "error",
        detail: error instanceof Error ? error.message : "Vector compaction failed.",
        retryAction: "REBUILD_VECTORS",
      });
      // Attempt to clean up the temporary file if it exists
      try {
        await vectorStoreService.deleteFile(tempFileName);
      } catch {}
      try {
        await vectorStoreService.deleteFile(backupFileName);
      } catch {}
      try {
        const journal = await vectorMaintenanceJournalService.read();
        if (journal.operationId === operationId && journal.phase !== "swapped") {
          await vectorMaintenanceJournalService.clear("Compaction failed before commit completion.");
        }
      } catch {}
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncService = new SyncService();
