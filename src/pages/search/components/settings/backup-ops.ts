import type {
  LocalExtensionMigrationBundle,
  LocalExtensionMigrationSummary,
  RestoreLocalExtensionMigrationResult,
} from "@src/services/local-extension-migration";
import type { GoogleDriveBackup } from "@src/services/google-workspace-sync";
import type { MergeBackupSnapshotResult } from "@src/services/share-snapshot";

/**
 * Backup / restore operations, ported out of the old full-page MigrationTool so
 * the Settings modal can own them. The bundle never leaves the device unless
 * the user explicitly restores from Google Drive.
 */

export type StagedLocalMigration = {
  stageId: string;
  summary: LocalExtensionMigrationSummary;
};

export type {
  LocalExtensionMigrationBundle,
  LocalExtensionMigrationSummary,
  RestoreLocalExtensionMigrationResult,
  GoogleDriveBackup,
  MergeBackupSnapshotResult,
};

const callOffscreen = async <T,>(service: string, type: string, payload: unknown): Promise<T> => {
  const response = await chrome.runtime.sendMessage({ service, type, target: "offscreen", payload });
  if (!response?.success) throw new Error(response?.error || `${type} failed`);
  return response.payload as T;
};

const callBackground = async <T,>(type: string, payload?: unknown): Promise<T> => {
  const response = await chrome.runtime.sendMessage({ target: "background", type, payload });
  if (!response?.success) throw new Error(response?.error || `${type} failed`);
  return response.payload as T;
};

export const formatDateForFile = (value: number) =>
  new Date(value).toISOString().replace(/[:.]/g, "-");

export const formatMigrationSummary = (summary: LocalExtensionMigrationSummary) =>
  `${summary.collections.items} items, ${summary.collections.folders} folders, ${summary.collections.spaces} spaces, ${summary.opfsFileCount} local media files`;

export const buildBackupBundle = () =>
  callOffscreen<LocalExtensionMigrationBundle>("dbManager", "buildLocalExtensionMigrationBundle", {});

export const stageBackupBundle = (json: string) =>
  callOffscreen<StagedLocalMigration>("dbManager", "stageLocalExtensionMigrationBundle", { json });

export const restoreStagedBundle = (stageId: string) =>
  callOffscreen<RestoreLocalExtensionMigrationResult>(
    "dbManager",
    "restoreStagedLocalExtensionMigrationBundle",
    { stageId }
  );

export const listDriveBackups = () => callBackground<GoogleDriveBackup[]>("GOOGLE_BACKUP_LIST");

export const restoreDriveBackup = (fileId: string) =>
  callBackground<MergeBackupSnapshotResult>("GOOGLE_BACKUP_RESTORE", { fileId });

export const rebuildVectorIndex = async () => {
  const response = await chrome.runtime.sendMessage({
    service: "sync",
    type: "rebuildAndCompact",
    target: "offscreen",
    payload: { reembedMissing: true },
  });
  if (!response?.success) throw new Error(response?.error || "Vector indexing failed");
};

/** Wipe every local collection + OPFS media. Destructive and irreversible. */
export const deleteAllLocalData = () =>
  callOffscreen<{ deletedCollections: number }>("dbManager", "deleteAllData", {});

export const summarizeBundle = (
  bundle: LocalExtensionMigrationBundle
): LocalExtensionMigrationSummary => ({
  collections: Object.fromEntries(
    Object.entries(bundle.collections).map(([name, rows]) => [name, rows.length])
  ) as LocalExtensionMigrationSummary["collections"],
  opfsFileCount: bundle.opfsFiles.length,
  warningCount: bundle.warnings.length,
});

/** Trigger a browser download of the migration bundle as JSON. */
export const downloadBackupBundle = (bundle: LocalExtensionMigrationBundle) => {
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `vibesearch-extension-migration-${formatDateForFile(bundle.createdAt)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
};
