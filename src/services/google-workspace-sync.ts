import { clearGoogleAccessToken, getGoogleAccessToken } from "@src/services/google-auth";
import type { ShareSnapshotV1, SharedItem } from "@src/services/share-snapshot";

const GOOGLE_SYNC_STATE_KEY = "vs_google_workspace_sync_v1";
const SHEET_TABS = ["Items", "Folders", "Spaces", "Tags", "Item Tags", "Media"] as const;

export type GoogleWorkspaceSyncState = {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  driveFileId?: string;
  driveFileUrl?: string;
  lastSyncedAt?: number;
  itemCount?: number;
  folderCount?: number;
  error?: string;
};

export type GoogleWorkspaceSyncResult = GoogleWorkspaceSyncState & {
  ok: true;
};

type GoogleFile = {
  id?: string;
  webViewLink?: string;
  webContentLink?: string;
};

export type GoogleDriveBackup = {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
};

export async function getGoogleWorkspaceSyncState(): Promise<GoogleWorkspaceSyncState> {
  const row = await chrome.storage.local.get(GOOGLE_SYNC_STATE_KEY);
  const state = row[GOOGLE_SYNC_STATE_KEY];
  return state && typeof state === "object" ? (state as GoogleWorkspaceSyncState) : {};
}

export async function clearGoogleWorkspaceAuth(): Promise<void> {
  await clearGoogleAccessToken();
}

export async function listGoogleWorkspaceBackups(
  options: { interactive?: boolean } = {}
): Promise<GoogleDriveBackup[]> {
  const { token } = await getGoogleAccessToken(options.interactive !== false);
  const query = "name = 'vibesearch-export.json' and trashed = false";
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("fields", "files(id,name,modifiedTime,size)");

  const response = await googleJson<{ files?: GoogleDriveBackup[] }>(token, url.toString(), {
    method: "GET",
  });
  return (response.files || []).filter(
    (file): file is GoogleDriveBackup => typeof file.id === "string" && typeof file.name === "string"
  );
}

export async function downloadGoogleWorkspaceBackup(
  fileId: string,
  options: { interactive?: boolean } = {}
): Promise<ShareSnapshotV1> {
  if (!fileId) throw new Error("GOOGLE_BACKUP_FILE_ID_MISSING");
  const { token } = await getGoogleAccessToken(options.interactive !== false);
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (response.status === 401) await clearGoogleAccessToken(token);
  if (!response.ok) throw await googleError(response);
  return (await response.json()) as ShareSnapshotV1;
}

export async function syncSnapshotToGoogleWorkspace(
  snapshot: ShareSnapshotV1,
  options: { interactive?: boolean } = {}
): Promise<GoogleWorkspaceSyncResult> {
  const { token } = await getGoogleAccessToken(options.interactive !== false);
  const currentState = await getGoogleWorkspaceSyncState();
  const spreadsheet = await syncSpreadsheet(token, snapshot, currentState.spreadsheetId);
  const driveFile = await syncDriveJson(token, snapshot, currentState.driveFileId);

  const nextState: GoogleWorkspaceSyncResult = {
    ok: true,
    spreadsheetId: spreadsheet.id,
    spreadsheetUrl: spreadsheet.webViewLink || spreadsheetUrl(spreadsheet.id || ""),
    driveFileId: driveFile.id,
    driveFileUrl: driveFile.webViewLink || driveFile.webContentLink,
    lastSyncedAt: Date.now(),
    itemCount: snapshot.items.length,
    folderCount: snapshot.folders.length,
  };

  await chrome.storage.local.set({ [GOOGLE_SYNC_STATE_KEY]: nextState });
  return nextState;
}

async function syncSpreadsheet(
  token: string,
  snapshot: ShareSnapshotV1,
  existingSpreadsheetId?: string
): Promise<GoogleFile> {
  let spreadsheetId = existingSpreadsheetId || "";
  if (!spreadsheetId) {
    const created = await googleJson<{ spreadsheetId: string; spreadsheetUrl?: string }>(
      token,
      "https://sheets.googleapis.com/v4/spreadsheets",
      {
        method: "POST",
        body: JSON.stringify({
          properties: { title: "VibeSearch Export" },
          sheets: SHEET_TABS.map((title) => ({ properties: { title } })),
        }),
      }
    );
    spreadsheetId = created.spreadsheetId;
  } else {
    await googleJson(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
      method: "POST",
      body: JSON.stringify({ ranges: SHEET_TABS.map((title) => `${title}!A:Z`) }),
    }).catch(async (error) => {
      if (isNotFound(error)) {
        await chrome.storage.local.set({ [GOOGLE_SYNC_STATE_KEY]: {} });
        spreadsheetId = "";
        return;
      }
      throw error;
    });
    if (!spreadsheetId) return syncSpreadsheet(token, snapshot, "");
  }

  const tables = buildSheetTables(snapshot);
  for (const [title, values] of Object.entries(tables)) {
    await googleJson(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({ range: `${title}!A1`, majorDimension: "ROWS", values }),
      }
    );
  }

  return {
    id: spreadsheetId,
    webViewLink: spreadsheetUrl(spreadsheetId),
  };
}

async function syncDriveJson(
  token: string,
  snapshot: ShareSnapshotV1,
  existingFileId?: string
): Promise<GoogleFile> {
  const body = JSON.stringify(snapshot, null, 2);
  if (existingFileId) {
    const updated = await uploadMultipart<GoogleFile>(
      token,
      `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,webViewLink,webContentLink`,
      "PATCH",
      { name: "vibesearch-export.json", mimeType: "application/json" },
      body
    ).catch((error) => {
      if (isNotFound(error)) return null;
      throw error;
    });
    if (updated?.id) return updated;
  }

  return uploadMultipart<GoogleFile>(
    token,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink",
    "POST",
    { name: "vibesearch-export.json", mimeType: "application/json" },
    body
  );
}

function buildSheetTables(snapshot: ShareSnapshotV1): Record<(typeof SHEET_TABS)[number], unknown[][]> {
  return {
    Items: [
      [
        "id",
        "title",
        "url",
        "source",
        "spaceId",
        "folderId",
        "author",
        "likes",
        "upvotes",
        "createdAt",
        "updatedAt",
        "textContent",
        "ocrText",
        "displayImageUrl",
      ],
      ...snapshot.items.map((item) => [
        item.id,
        item.title,
        item.url,
        item.source,
        item.spaceId || "",
        item.folderId || "",
        item.authorUsername || "",
        item.likes ?? "",
        item.upvotes ?? "",
        item.createdAt ? new Date(item.createdAt).toISOString() : "",
        item.updatedAt ? new Date(item.updatedAt).toISOString() : "",
        item.textContent || "",
        item.ocrText || "",
        item.displayImageUrl || "",
      ]),
    ],
    Folders: [
      ["id", "name", "spaceId", "parentId", "type", "sortOrder"],
      ...snapshot.folders.map((folder) => [
        folder.id,
        folder.name,
        folder.spaceId || "",
        folder.parentId || "",
        folder.type || "folder",
        folder.sortOrder ?? "",
      ]),
    ],
    Spaces: [
      ["id", "name", "slug", "spaceGroupId", "sortOrder", "isPrivate"],
      ...snapshot.spaces.map((space) => [
        space.id,
        space.name,
        space.slug || "",
        space.spaceGroupId || "",
        space.sortOrder ?? "",
        space.isPrivate === true ? "true" : "false",
      ]),
    ],
    Tags: [
      ["id", "name"],
      ...snapshot.tags.map((tag) => [tag.id, tag.name]),
    ],
    "Item Tags": [
      ["itemId", "tagId"],
      ...snapshot.itemTags.map((join) => [join.itemId, join.tagId]),
    ],
    Media: [
      [
        "itemId",
        "type",
        "storageType",
        "originalUrl",
        "s3Url",
        "thumbnailUrl",
        "embedUrl",
        "width",
        "height",
        "ocrText",
      ],
      ...snapshot.items.flatMap(mediaRows),
    ],
  };
}

function mediaRows(item: SharedItem): unknown[][] {
  return (item.media || []).map((entry) => [
    item.id,
    entry.type,
    entry.storageType,
    entry.originalUrl || "",
    entry.s3Url || "",
    entry.thumbnailUrl || "",
    entry.embedUrl || "",
    entry.width ?? "",
    entry.height ?? "",
    entry.ocr?.text || "",
  ]);
}

async function googleJson<T = unknown>(
  token: string,
  url: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (response.status === 401) await clearGoogleAccessToken(token);
  if (!response.ok) throw await googleError(response);
  return (await response.json()) as T;
}

async function uploadMultipart<T>(
  token: string,
  url: string,
  method: "POST" | "PATCH",
  metadata: Record<string, unknown>,
  content: string
): Promise<T> {
  const boundary = `vibesearch_${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (response.status === 401) await clearGoogleAccessToken(token);
  if (!response.ok) throw await googleError(response);
  return (await response.json()) as T;
}

async function googleError(response: Response): Promise<Error> {
  let detail = "";
  try {
    detail = JSON.stringify(await response.json());
  } catch {
    detail = await response.text().catch(() => "");
  }
  const error = new Error(`GOOGLE_API_${response.status}: ${detail || response.statusText}`);
  (error as Error & { status?: number }).status = response.status;
  return error;
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number })?.status === 404 || /GOOGLE_API_404/.test(String(error));
}

function spreadsheetUrl(spreadsheetId: string): string {
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : "";
}
