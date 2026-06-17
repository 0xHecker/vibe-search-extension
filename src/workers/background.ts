import { scheduleForProcessing } from "@src/services/metadata-pipeline";
import { setupOffscreenDocument } from "@src/services/offscreen-helper";
import { PRIVATE_SPACE_ID, PUBLIC_SPACE_ID } from "@src/common/spaces";
import type { ImportTargetSpace } from "@src/services/db-manager";
import type { FolderDocType } from "@src/schemas/folder_schema";
import type { ItemDocType } from "@src/schemas/item_schema";
import { inferSource } from "@src/utils/infer-source";

const SYNC_ALARM_NAME = "vector-sync-alarm";
const EMBEDDING_ALARM_NAME = "embedding-alarm";
const FORCE_DEV_OFFSCREEN_RESET = (import.meta as any)?.env?.VITE_FORCE_DEV_OFFSCREEN_RESET === "1";
const SEARCH_PAGE_PATH = "/src/pages/search/index.html";
const SEARCH_ONLY_OFFSCREEN_METHODS = new Set<string>([
  "items:moveToSpace",
  "spaces:listSpaces",
  "spaces:createSpace",
  "spaces:renameSpace",
  "spaces:setPrivatePassword",
  "spaces:unlockSpace",
  "spaces:changePrivatePassword",
  "spaces:recoverPrivatePassword",
  "spaces:lockSpace",
  "spaces:touchSpaceActivity",
  "spaces:getSpaceAccessState",
]);
const INTERNAL_ONLY_OFFSCREEN_METHODS = new Set<string>(["items:saveFetchedMetadata"]);

const METADATA_WORKER_BASE_URL = "https://metadata-worker.watermelons.workers.dev";
const LEGACY_METADATA_WORKER_BASE_URL = "https://meta.vibesearch.app";
const IMPORT_MEDIA_ENDPOINT = `${METADATA_WORKER_BASE_URL}/import-media`;
const LEGACY_IMPORT_MEDIA_ENDPOINT = `${LEGACY_METADATA_WORKER_BASE_URL}/import-media`;
const IMPORT_MEDIA_UPLOAD_TOKEN = `${(import.meta as any)?.env?.VITE_IMPORT_MEDIA_UPLOAD_TOKEN || ""}`.trim();
const IMPORT_SETTINGS_KEY = "vs_import_settings_v1";
const IMPORT_DRAFTS_KEY = "vs_import_drafts_v1";
const IMPORT_MAX_DRAFTS = 24;
const IMPORT_FAILED_ATTEMPTS_MAX = 20;
const IMPORT_CONTEXTS: [`${chrome.contextMenus.ContextType}`, ...`${chrome.contextMenus.ContextType}`[]] = [
  chrome.contextMenus.ContextType.PAGE,
  chrome.contextMenus.ContextType.FRAME,
  chrome.contextMenus.ContextType.SELECTION,
  chrome.contextMenus.ContextType.LINK,
  chrome.contextMenus.ContextType.IMAGE,
  chrome.contextMenus.ContextType.VIDEO,
  chrome.contextMenus.ContextType.AUDIO,
];
const MENU_ROOT_ID = "vs:root";
const MENU_OPEN_SEARCH_ID = "vs:open:search";
// Content-aware primary actions
const MENU_SAVE_IMAGE_ID = "vs:save:image";
const MENU_SAVE_VIDEO_ID = "vs:save:video";
const MENU_SAVE_LINK_ID = "vs:save:link";
const MENU_SAVE_SELECTION_ID = "vs:save:selection";
const MENU_SAVE_PAGE_ID = "vs:save:page";
const MENU_EXTRACT_TEXT_ID = "vs:extract:text";
// Screenshot actions
const MENU_SHOT_VISIBLE_ID = "vs:shot:visible";
const MENU_SHOT_REGION_ID = "vs:shot:region";
// Targeting submenus
const MENU_SAVE_TARGETS_ID = "vs:targets:save";
const MENU_EXTRACT_TARGETS_ID = "vs:targets:extract";
const MENU_SHOT_TARGETS_ID = "vs:targets:shot";
const MENU_MAX_SPACES = 6;
const MENU_MAX_FOLDERS = 8;
const MENU_MAX_ITEMS = 2;
const MENU_REFRESH_DEBOUNCE_MS = 180;
const MENU_REFRESH_LOW_PRIORITY_DEBOUNCE_MS = 900;
const MENU_REFRESH_MIN_INTERVAL_MS = 2500;


const LOCAL_IMPORT_HOST = "local.vibesearch.invalid";
const PROCESS_STATUS_HISTORY_MAX = 120;

type OffscreenResponse<T> = { success?: boolean; payload?: T; error?: string };
type ImportMode = "save" | "shot" | "extract";
type ImportTarget = { mode: ImportMode; spaceId?: string; folderId?: string; itemId?: string; screenshotMode?: "visible" | "region" };
type ImportSettings = { reviewBeforeSave: boolean };
type ImportRetryAction = "RETRY_IMPORT";
type ImportClickContext = {
  pageUrl: string | null;
  frameUrl: string | null;
  linkUrl: string | null;
  mediaUrl: string | null;
  mediaType: chrome.contextMenus.OnClickData["mediaType"] | null;
  selectionText: string;
  tabUrl: string | null;
  tabTitle: string;
  tabFavIconUrl: string | null;
  capturedAt: number;
};
type MediaUploadResponse = { url?: string | null; key?: string; error?: string };
type ExtractImageTextResponse = {
  status: "done" | "skipped" | "error";
  text: string;
  confidence?: number;
  lineCount: number;
  sourceHash: string;
  error?: string;
};
type SaveContentKind = "default" | "text-only" | "image-only";
type ImageDomMetadata = {
  pageTitle: string;
  siteName: string;
  pageUrl: string;
  faviconUrl: string;
  altText: string;
  titleText: string;
  ariaLabel: string;
  width: number;
  height: number;
};
type PreparedImportContent = {
  primaryUrl: string;
  title: string;
  textContent: string;
  source: ItemDocType["source"];
  iconUrl?: string;
  displayImageUrl?: string;
  media?: ItemDocType["media"];
  ocrText?: string;
  ocrStatus?: ItemDocType["ocrStatus"];
  ocrConfidence?: number;
  ocrLineCount?: number;
  ocrSourceHash?: string;
  tags: string[];
  shouldFetchMetadata: boolean;
  isMetaFetched: boolean;
};

type ScreenshotRegionSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};
type ScreenshotRegionSelectionResult =
  | { status: "selected"; selection: ScreenshotRegionSelection }
  | { status: "cancelled" }
  | { status: "unavailable" };

type ExtractedContent = {
  canonicalUrl: string;
  title: string;
  author?: string;
  description?: string;
  thumbnailUrl?: string;
  mediaUrls?: Array<{ url: string; type: "image" | "video" | "audio" }>;
  platform: string;
  timestamp?: number;
};

class ImportCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportCancelledError";
  }
}
type TabSnapshot = {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
};
type ImportDraft = {
  id: string;
  mode: ImportMode;
  createdAt: number;
  updatedAt: number;
  primaryUrl: string;
  title: string;
  textContent: string;
  source: ItemDocType["source"];
  tags: string[];
  iconUrl?: string;
  displayImageUrl?: string;
  media?: ItemDocType["media"];
  ocrText?: string;
  ocrStatus?: ItemDocType["ocrStatus"];
  ocrConfidence?: number;
  ocrLineCount?: number;
  ocrSourceHash?: string;
  shouldFetchMetadata?: boolean;
  isMetaFetched?: boolean;
  context: ImportClickContext;
  target: { spaceId: string; folderId?: string; parentId?: string | null; newFolderName?: string };
};
type ImportDraftSubmitPayload = {
  draftId: string;
  title?: string;
  url?: string;
  textContent?: string;
  source?: ItemDocType["source"];
  iconUrl?: string;
  displayImageUrl?: string;
  tags?: string[] | string;
  spaceId?: string;
  folderId?: string;
  parentId?: string | null;
  createFolderName?: string;
};
type FailedImportAttempt = {
  target: ImportTarget;
  context: ImportClickContext;
  tab?: TabSnapshot;
  createdAt: number;
};
type ProcessStatusRecord = {
  id: string;
  label: string;
  state: "processing" | "success" | "error";
  detail: string;
  retryAction?: string;
  updatedAt: number;
};

const trimText = (value: string, max = 80) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
const trimMultilineText = (value: string, max = 4000) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
const normalizeHttpUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};
const normalizeIconUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
    return null;
  } catch {
    return null;
  }
};
const getFileNameFromUrl = (url: string | null | undefined): string => {
  if (!url) return "image";
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").filter(Boolean).pop() || "image";
    const decoded = decodeURIComponent(raw).replace(/\.[a-z0-9]{2,5}$/i, "");
    return trimText(decoded || "image", 60);
  } catch {
    return "image";
  }
};
const normalizeSelectionText = (value: string): string => {
  if (!value) return "";
  const normalizedLines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim());
  return trimMultilineText(normalizedLines.join("\n"), 6000);
};
const buildSyntheticImportUrl = (context: ImportClickContext, mode: ImportMode): string => {
  const host = pickHostLabel(context).replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const safeHost = host || "capture";
  const pathMode = mode === "shot" ? "screenshot" : mode === "extract" ? "image-text" : "import";
  return `https://${LOCAL_IMPORT_HOST}/${pathMode}/${safeHost}/${context.capturedAt}`;
};
const getHostname = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const uniqueList = (values: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};
const pickHostLabel = (context: ImportClickContext) =>
  (getHostname(context.linkUrl) ||
    getHostname(context.pageUrl) ||
    getHostname(context.frameUrl) ||
    getHostname(context.mediaUrl) ||
    getHostname(context.tabUrl) ||
    "web")
    .replace(/^www\./, "");
const autoFolderName = (context: ImportClickContext, mode: ImportMode) => {
  const day = new Date(context.capturedAt).toISOString().slice(0, 10);
  const label = mode === "shot" ? "Screenshots" : mode === "extract" ? "Image text" : "Imports";
  return trimText(`${label} · ${pickHostLabel(context)} · ${day}`, 80);
};
const looksLikeMediaUrl = (url: string | null) =>
  !!url &&
  [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".mp4", ".webm", ".mov", ".m3u8", ".mp3", ".wav", ".ogg", ".m4a", ".aac"].some((ext) =>
    url.toLowerCase().includes(ext)
  );
const resolveMediaType = (
  mediaType: chrome.contextMenus.OnClickData["mediaType"] | null,
  url: string | null
): "image" | "video" | "audio" | null => {
  if (mediaType === "image") return "image";
  if (mediaType === "video") return "video";
  if (mediaType === "audio") return "audio";
  if (!url) return null;
  const lower = url.toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"].some((ext) => lower.includes(ext))) return "image";
  if ([".mp4", ".webm", ".mov", ".m3u8"].some((ext) => lower.includes(ext))) return "video";
  if ([".mp3", ".wav", ".ogg", ".m4a", ".aac"].some((ext) => lower.includes(ext))) return "audio";
  return null;
};

const sendProcessStatus = (
  id: string,
  label: string,
  state: "processing" | "success" | "error",
  detail: string,
  retryAction?: ImportRetryAction
) => {
  const payload: ProcessStatusRecord = {
    id,
    label,
    state,
    detail,
    retryAction,
    updatedAt: Date.now(),
  };
  recentProcessStatuses.set(id, payload);
  if (recentProcessStatuses.size > PROCESS_STATUS_HISTORY_MAX) {
    const trim = [...recentProcessStatuses.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, PROCESS_STATUS_HISTORY_MAX);
    recentProcessStatuses.clear();
    for (const row of trim) recentProcessStatuses.set(row.id, row);
  }
  try {
    chrome.runtime.sendMessage({
      type: "PROCESS_STATUS",
      payload,
    });
  } catch {}
};
const listRecentProcessStatuses = (max = 24): ProcessStatusRecord[] =>
  [...recentProcessStatuses.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(200, max)));
const createImportJob = (mode: ImportMode, context: ImportClickContext) => ({
  id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  label: `${mode === "shot" ? "Screenshot" : mode === "extract" ? "Extract text" : "Import"} • ${pickHostLabel(context)}`,
});

const getStorageValue = async <T>(key: string, fallback: T): Promise<T> => {
  const row = await chrome.storage.local.get(key);
  if (!(key in row)) return fallback;
  return (row[key] as T) ?? fallback;
};
const setStorageValue = async <T>(key: string, value: T): Promise<void> => {
  await chrome.storage.local.set({ [key]: value });
};
const getImportSettings = async (): Promise<ImportSettings> => {
  const raw = await getStorageValue<Partial<ImportSettings>>(IMPORT_SETTINGS_KEY, {});
  return { reviewBeforeSave: raw.reviewBeforeSave === true };
};
const setImportSettings = async (reviewBeforeSave: boolean): Promise<ImportSettings> => {
  const next = { reviewBeforeSave: reviewBeforeSave === true };
  await setStorageValue(IMPORT_SETTINGS_KEY, next);
  return next;
};
const loadDrafts = async (): Promise<ImportDraft[]> => {
  const raw = await getStorageValue<unknown[]>(IMPORT_DRAFTS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is ImportDraft => !!entry && typeof (entry as ImportDraft).id === "string")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, IMPORT_MAX_DRAFTS);
};
const saveDrafts = async (drafts: ImportDraft[]) => {
  await setStorageValue(
    IMPORT_DRAFTS_KEY,
    [...drafts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, IMPORT_MAX_DRAFTS)
  );
};
const toTabSnapshot = (tab?: chrome.tabs.Tab): TabSnapshot | undefined => {
  if (!tab) return undefined;
  return {
    id: typeof tab.id === "number" ? tab.id : undefined,
    windowId: typeof tab.windowId === "number" ? tab.windowId : undefined,
    url: tab.url,
    title: tab.title,
  };
};

const failedImportAttempts = new Map<string, FailedImportAttempt>();
const recentProcessStatuses = new Map<string, ProcessStatusRecord>();
const rememberFailedImportAttempt = (statusId: string, attempt: FailedImportAttempt) => {
  failedImportAttempts.set(statusId, attempt);
  const entries = [...failedImportAttempts.entries()].sort(
    (a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0)
  );
  while (entries.length > IMPORT_FAILED_ATTEMPTS_MAX) {
    const oldest = entries.shift();
    if (!oldest) break;
    failedImportAttempts.delete(oldest[0]);
  }
};
const getFailedImportAttempt = (statusId: string): FailedImportAttempt | null => {
  return failedImportAttempts.get(statusId) || null;
};
const resolveRetryTab = async (snapshot?: TabSnapshot): Promise<chrome.tabs.Tab | undefined> => {
  if (!snapshot) return undefined;
  if (typeof snapshot.id === "number") {
    try {
      const tab = await chrome.tabs.get(snapshot.id);
      return tab;
    } catch {}
  }
  return snapshot as chrome.tabs.Tab;
};

const buildImportUploadHeaders = (contentType: string): Headers => {
  const headers = new Headers({ "Content-Type": contentType });
  if (IMPORT_MEDIA_UPLOAD_TOKEN) {
    headers.set("X-VS-Import-Token", IMPORT_MEDIA_UPLOAD_TOKEN);
  }
  return headers;
};

const sendForwardedToOffscreen = async <T = unknown>(request: {
  service: string;
  type: string;
  payload?: unknown;
}): Promise<T> => {
  await setupOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    ...request,
    target: "offscreen",
    isForwarded: true,
  })) as OffscreenResponse<T>;
  if (!response?.success) throw new Error(response?.error || `${request.service}.${request.type} failed`);
  return response.payload as T;
};

const postImportMedia = async (init: RequestInit, label: string): Promise<MediaUploadResponse> => {
  let lastError = "";
  for (const endpoint of [IMPORT_MEDIA_ENDPOINT, LEGACY_IMPORT_MEDIA_ENDPOINT]) {
    try {
      const response = await fetch(endpoint, init);
      const payload = (await response.json().catch(() => ({}))) as MediaUploadResponse;
      if (response.ok) return payload;
      lastError = payload.error || `${label} failed (${response.status})`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError || `${label} failed`);
};

const postImportMediaJson = async (body: Record<string, unknown>) => {
  const payload = await postImportMedia(
    {
      method: "POST",
      headers: buildImportUploadHeaders("application/json"),
      body: JSON.stringify(body),
    },
    "Media upload"
  );
  return { ...payload, url: resolveUploadedMediaUrl(payload) };
};
const postImportMediaBinary = async (blob: Blob, sourcePageUrl?: string | null, fileName?: string) => {
  const headers = buildImportUploadHeaders(blob.type || "image/png");
  if (sourcePageUrl) headers.set("X-VS-Source-Url", sourcePageUrl);
  if (fileName) headers.set("X-VS-File-Name", fileName);
  const payload = await postImportMedia({ method: "POST", headers, body: blob }, "Binary upload");
  return { ...payload, url: resolveUploadedMediaUrl(payload) };
};

const resolveUploadedMediaUrl = (payload: MediaUploadResponse): string | null => {
  if (payload.key) return `${METADATA_WORKER_BASE_URL}/r2/${encodeURIComponent(payload.key)}`;
  return payload.url || null;
};

const captureVisibleTabPng = async (tab?: chrome.tabs.Tab) =>
  await new Promise<string>((resolve, reject) => {
    const callback = (dataUrl?: string) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!dataUrl) return reject(new Error("captureVisibleTab returned empty image"));
      resolve(dataUrl);
    };
    if (typeof tab?.windowId === "number") chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, callback);
    else chrome.tabs.captureVisibleTab({ format: "png" }, callback);
  });
const parseTargetFromMenuId = (menuId: string): ImportTarget | null => {
  const bySpace = /^vs:(save|shot|extract):space:([^:]+)$/i.exec(menuId);
  if (bySpace) return { mode: bySpace[1] as ImportMode, spaceId: bySpace[2] };
  const byFolder = /^vs:(save|shot|extract):folder:([^:]+)$/i.exec(menuId);
  if (byFolder) return { mode: byFolder[1] as ImportMode, folderId: byFolder[2] };
  const byItem = /^vs:(save|shot):item:([^:]+):([^:]+)$/i.exec(menuId);
  if (byItem) return { mode: byItem[1] as ImportMode, folderId: byItem[2], itemId: byItem[3] };
  return null;
};
const collectContext = (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): ImportClickContext => ({
  pageUrl: normalizeHttpUrl(info.pageUrl || null),
  frameUrl: normalizeHttpUrl(info.frameUrl || null),
  linkUrl: normalizeHttpUrl(info.linkUrl || null),
  mediaUrl: normalizeHttpUrl(info.srcUrl || null),
  mediaType: info.mediaType || null,
  selectionText: normalizeSelectionText(info.selectionText || ""),
  tabUrl: normalizeHttpUrl(tab?.url || null),
  tabTitle: (tab?.title || "").trim(),
  tabFavIconUrl: normalizeIconUrl(tab?.favIconUrl || null),
  capturedAt: Date.now(),
});
const resolvePrimaryUrl = (context: ImportClickContext, mode: ImportMode) => {
  if (mode === "shot") {
    return context.pageUrl || context.tabUrl || context.linkUrl || context.mediaUrl || null;
  }
  if (mode === "extract") {
    return context.mediaUrl || context.linkUrl || context.pageUrl || context.frameUrl || context.tabUrl || null;
  }
  return context.linkUrl || context.pageUrl || context.frameUrl || context.mediaUrl || context.tabUrl || null;
};
const createTitle = (context: ImportClickContext, mode: ImportMode, fallbackUrl: string) => {
  if (mode === "shot") return trimText(context.tabTitle ? `Screenshot · ${context.tabTitle}` : `Screenshot · ${fallbackUrl}`);
  if (mode === "extract") return trimText(context.tabTitle ? `Image text · ${context.tabTitle}` : `Image text · ${fallbackUrl}`);
  if (context.selectionText) return trimText(context.selectionText.replace(/\s+/g, " "));
  if (context.tabTitle) return trimText(context.tabTitle);
  return trimText(fallbackUrl);
};
const contextText = (context: ImportClickContext, mode: ImportMode) => {
  const lines: string[] = [];
  if (context.selectionText) lines.push(context.selectionText, "");
  lines.push(`Imported via: ${mode === "shot" ? "page-screenshot" : mode === "extract" ? "image-ocr" : "context-menu"}`);
  lines.push(`Imported at: ${new Date(context.capturedAt).toISOString()}`);
  if (context.tabTitle) lines.push(`Tab: ${context.tabTitle}`);
  if (context.pageUrl) lines.push(`Page: ${context.pageUrl}`);
  if (context.frameUrl && context.frameUrl !== context.pageUrl) lines.push(`Frame: ${context.frameUrl}`);
  if (context.linkUrl) lines.push(`Link: ${context.linkUrl}`);
  if (context.mediaUrl) lines.push(`Media source: ${context.mediaUrl}`);
  return lines.join("\n");
};
const suggestedTags = (context: ImportClickContext, source: ItemDocType["source"]) =>
  uniqueList([source !== "web" ? source : "", pickHostLabel(context), context.mediaType || ""]).slice(0, 6);

const uploadRemoteMediaIfPresent = async (context: ImportClickContext) => {
  const mediaUrl = context.mediaUrl || (!context.mediaUrl && looksLikeMediaUrl(context.linkUrl) ? context.linkUrl : null);
  if (!mediaUrl) return { upload: null as MediaUploadResponse | null, mediaType: null as "image" | "video" | "audio" | null, originalUrl: null as string | null };
  const mediaType = resolveMediaType(context.mediaType, mediaUrl);
  if (!mediaType) return { upload: null, mediaType: null, originalUrl: mediaUrl };
  const upload = await postImportMediaJson({ remoteUrl: mediaUrl, sourcePageUrl: context.pageUrl || context.tabUrl || mediaUrl });
  return { upload, mediaType, originalUrl: mediaUrl };
};
const dataUrlToBlob = (dataUrl: string): Blob => {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Invalid screenshot data URL.");
  }

  const meta = dataUrl.slice(5, commaIndex);
  const rawBody = dataUrl.slice(commaIndex + 1);
  const mimeType = (meta.split(";")[0] || "image/png").trim() || "image/png";
  const isBase64 = /;base64/i.test(meta);

  if (isBase64) {
    const binary = atob(rawBody);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  const text = decodeURIComponent(rawBody);
  return new Blob([text], { type: mimeType });
};
const cropScreenshotBlob = async (
  sourceBlob: Blob,
  selection: ScreenshotRegionSelection
): Promise<Blob> => {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    return sourceBlob;
  }

  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const viewportWidth = Math.max(1, Math.floor(selection.viewportWidth || 1));
    const viewportHeight = Math.max(1, Math.floor(selection.viewportHeight || 1));
    const scaleX = bitmap.width / viewportWidth;
    const scaleY = bitmap.height / viewportHeight;

    const sx = Math.max(0, Math.min(bitmap.width - 1, Math.floor(selection.x * scaleX)));
    const sy = Math.max(0, Math.min(bitmap.height - 1, Math.floor(selection.y * scaleY)));
    const maxWidth = Math.max(1, bitmap.width - sx);
    const maxHeight = Math.max(1, bitmap.height - sy);
    const sw = Math.max(1, Math.min(maxWidth, Math.floor(selection.width * scaleX)));
    const sh = Math.max(1, Math.min(maxHeight, Math.floor(selection.height * scaleY)));

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return sourceBlob;
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const cropped = await canvas.convertToBlob({ type: "image/png", quality: 1 });
    return cropped || sourceBlob;
  } catch {
    return sourceBlob;
  } finally {
    bitmap.close();
  }
};
const uploadScreenshot = async (
  context: ImportClickContext,
  tab: chrome.tabs.Tab | undefined,
  sequence = 0,
  selection?: ScreenshotRegionSelection,
  onCaptured?: () => Promise<void> | void
) => {
  const dataUrl = await captureVisibleTabPng(tab);
  if (onCaptured) {
    await onCaptured();
  }
  const sourceBlob = dataUrlToBlob(dataUrl);
  const uploadBlob = selection ? await cropScreenshotBlob(sourceBlob, selection) : sourceBlob;
  const suffix = sequence > 0 ? `-${sequence + 1}` : "";
  return await postImportMediaBinary(
    uploadBlob,
    context.pageUrl || context.tabUrl,
    `screenshot-${context.capturedAt}${suffix}.png`
  );
};

const executeScriptInTab = async <T>(
  tab: chrome.tabs.Tab | undefined,
  func: (...args: any[]) => T | Promise<T>,
  args: unknown[] = []
): Promise<T | null> => {
  if (!tab || typeof tab.id !== "number") {
    return null;
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func,
      args,
    });
    return (results?.[0]?.result as T | undefined) ?? null;
  } catch {
    return null;
  }
};

const extractContentFromPage = async (
  tab: chrome.tabs.Tab | undefined,
  clickedUrl?: string
): Promise<ExtractedContent | null> => {
  if (!tab || typeof tab.id !== "number") return null;
  
  try {
    // Inject a minimal universal extractor (OG meta + canonical link)
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (clickedUrl?: string) => {
        const getMeta = (name: string): string | null => {
          for (const sel of [`meta[property="${name}"]`, `meta[name="${name}"]`, `meta[property="og:${name}"]`, `meta[name="twitter:${name}"]`]) {
            const el = document.querySelector(sel);
            if (el) return el.getAttribute("content") || null;
          }
          return null;
        };
        const trim = (s: string | null | undefined, max = 500): string => {
          const v = (s || "").trim();
          return v.length <= max ? v : v.slice(0, max - 1) + "…";
        };
        const resolveUrl = (href: string | null | undefined): string | null => {
          if (!href) return null;
          try { return new URL(href, window.location.href).href; } catch { return null; }
        };

        const canonicalUrl = clickedUrl || getMeta("url") || document.querySelector('link[rel="canonical"]')?.getAttribute("href") || window.location.href;
        const title = getMeta("title") || document.querySelector("h1")?.textContent?.trim() || document.title || "Saved page";
        const description = getMeta("description");
        const thumbnailUrl = resolveUrl(getMeta("image"));
        const author = getMeta("author");

        return {
          canonicalUrl,
          title: trim(title),
          author: author ?? undefined,
          description: trim(description, 300),
          thumbnailUrl: thumbnailUrl ?? undefined,
          platform: "web",
        };
      },
      args: [clickedUrl],
    });
    
    return (result?.[0]?.result as ExtractedContent | undefined) ?? null;
  } catch {
    return null;
  }
};

const showBrandedToast = async (
  tab: chrome.tabs.Tab | undefined,
  message: string,
  actions?: Array<{ label: string; action: string; payload?: Record<string, unknown> }>,
  duration = 4000
) => {
  await executeScriptInTab(
    tab,
    (payload: {
      message: string;
      actions?: Array<{ label: string; action: string; payload?: Record<string, unknown> }>;
      duration: number;
    }) => {
      try {
        const TOKENS = {
          bg: "#ffffff",
          border: "#c6c6c6",
          accent: "#ff4d4d",
          accentFaded: "#ffe5e5",
          text: "#212121",
          shadow: "0px 20px 35px rgba(15, 23, 42, 0.18)",
          radius: "10px",
          radiusSm: "6px",
          fontSans: '"Neutral Sans", ui-sans-serif, system-ui, sans-serif',
        };

        const rootId = "__vibesearch_toast_root__";
        let root = document.getElementById(rootId);
        if (!root) {
          root = document.createElement("div");
          root.id = rootId;
          const shadow = root.attachShadow({ mode: "open" });
          const container = document.createElement("div");
          container.id = "container";
          Object.assign(container.style, {
            position: "fixed",
            right: "16px",
            bottom: "16px",
            zIndex: "2147483647",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            pointerEvents: "none",
            fontFamily: TOKENS.fontSans,
          });
          shadow.appendChild(container);
          document.documentElement.appendChild(root);
        }

        const shadow = root.shadowRoot!;
        const container = shadow.getElementById("container")!;

        const toast = document.createElement("div");
        Object.assign(toast.style, {
          maxWidth: "380px",
          minWidth: "280px",
          padding: "12px 14px",
          borderRadius: TOKENS.radius,
          background: TOKENS.bg,
          border: `1px solid ${TOKENS.border}`,
          boxShadow: TOKENS.shadow,
          display: "flex",
          alignItems: "center",
          gap: "12px",
          pointerEvents: "auto",
          fontSize: "13px",
          lineHeight: "1.4",
          color: TOKENS.text,
          fontFamily: TOKENS.fontSans,
        });

        const messageEl = document.createElement("div");
        messageEl.textContent = payload.message;
        Object.assign(messageEl.style, { flex: "1", fontWeight: "500" });
        toast.appendChild(messageEl);

        if (payload.actions && payload.actions.length > 0) {
          const actionsRow = document.createElement("div");
          Object.assign(actionsRow.style, {
            display: "flex",
            gap: "8px",
            alignItems: "center",
          });

          for (const action of payload.actions) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = action.label;
            Object.assign(btn.style, {
              padding: "5px 10px",
              borderRadius: TOKENS.radiusSm,
              border: `1px solid ${TOKENS.accent}`,
              background: "transparent",
              color: TOKENS.accent,
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
              fontFamily: TOKENS.fontSans,
              transition: "all 150ms",
            });
            btn.addEventListener("mouseenter", () => {
              btn.style.background = TOKENS.accentFaded;
            });
            btn.addEventListener("mouseleave", () => {
              btn.style.background = "transparent";
            });
            btn.addEventListener("click", () => {
              if (action.action === "UNDO_SAVE") {
                chrome.runtime.sendMessage({
                  target: "background",
                  type: "UNDO_SAVE",
                  payload: action.payload,
                });
              } else if (action.action === "OPEN_SEARCH") {
                chrome.runtime.sendMessage({
                  target: "background",
                  type: "OPEN_SEARCH",
                });
              }
              toast.remove();
              if (container.childElementCount === 0) root!.remove();
            });
            actionsRow.appendChild(btn);
          }

          toast.appendChild(actionsRow);
        }

        container.appendChild(toast);

        if (payload.duration > 0) {
          setTimeout(() => {
            toast.remove();
            if (container.childElementCount === 0) root!.remove();
          }, payload.duration);
        }
      } catch {}
    },
    [{ message, actions, duration }]
  );
};


const selectScreenshotRegion = async (
  tab: chrome.tabs.Tab | undefined
): Promise<ScreenshotRegionSelectionResult> => {
  const result = await executeScriptInTab<ScreenshotRegionSelectionResult | null>(
    tab,
    () => {
      try {
        return new Promise<{
          status: "selected";
          selection: {
            x: number;
            y: number;
            width: number;
            height: number;
            viewportWidth: number;
            viewportHeight: number;
          };
        } | { status: "cancelled" }>((resolve) => {
          const TOKENS = {
            bg: "#ffffff",
            border: "#c6c6c6",
            accent: "#ff4d4d",
            text: "#212121",
            shadow: "0px 20px 35px rgba(15, 23, 42, 0.18)",
            radius: "10px",
            fontSans: '"Neutral Sans", ui-sans-serif, system-ui, sans-serif',
          };

          const rootId = "__vibesearch_screenshot_selector__";
          const existing = document.getElementById(rootId);
          if (existing) existing.remove();

          const root = document.createElement("div");
          root.id = rootId;
          const shadow = root.attachShadow({ mode: "open" });

          // Scrim
          const scrim = document.createElement("div");
          Object.assign(scrim.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            height: "100%",
            background: "rgba(0, 0, 0, 0.4)",
            zIndex: "2147483646",
            cursor: "crosshair",
          });

          // Selection box
          const box = document.createElement("div");
          Object.assign(box.style, {
            position: "fixed",
            border: `2px solid ${TOKENS.accent}`,
            background: "rgba(255, 77, 77, 0.08)",
            pointerEvents: "none",
            display: "none",
            zIndex: "2147483647",
          });

          // Hint
          const hint = document.createElement("div");
          hint.textContent = "Drag to select \u2022 Enter to save \u2022 Esc to cancel";
          Object.assign(hint.style, {
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 16px",
            borderRadius: TOKENS.radius,
            background: TOKENS.bg,
            border: `1px solid ${TOKENS.border}`,
            boxShadow: TOKENS.shadow,
            fontSize: "13px",
            fontWeight: "500",
            color: TOKENS.text,
            fontFamily: TOKENS.fontSans,
            zIndex: "2147483647",
            pointerEvents: "none",
          });

          shadow.appendChild(scrim);
          shadow.appendChild(box);
          shadow.appendChild(hint);
          document.documentElement.appendChild(root);

          let startX = 0;
          let startY = 0;
          let isDragging = false;

          const cleanup = (
            selection: {
              x: number;
              y: number;
              width: number;
              height: number;
              viewportWidth: number;
              viewportHeight: number;
            } | null
          ) => {
            window.removeEventListener("keydown", onKeyDown, true);
            root.remove();
            if (selection) {
              resolve({ status: "selected", selection });
            } else {
              resolve({ status: "cancelled" });
            }
          };

          const onMouseDown = (e: MouseEvent) => {
            startX = e.clientX;
            startY = e.clientY;
            isDragging = true;
            box.style.display = "block";
            box.style.left = `${startX}px`;
            box.style.top = `${startY}px`;
            box.style.width = "0";
            box.style.height = "0";
          };

          const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const width = Math.abs(e.clientX - startX);
            const height = Math.abs(e.clientY - startY);
            box.style.left = `${x}px`;
            box.style.top = `${y}px`;
            box.style.width = `${width}px`;
            box.style.height = `${height}px`;
          };

          const onMouseUp = (e: MouseEvent) => {
            if (!isDragging) return;
            isDragging = false;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const width = Math.abs(e.clientX - startX);
            const height = Math.abs(e.clientY - startY);
            if (width > 10 && height > 10) {
              cleanup({
                x,
                y,
                width,
                height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
              });
            } else {
              box.style.display = "none";
            }
          };

          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cleanup(null);
            } else if (e.key === "Enter" && box.style.display === "block") {
              e.preventDefault();
              const x = parseInt(box.style.left, 10);
              const y = parseInt(box.style.top, 10);
              const width = parseInt(box.style.width, 10);
              const height = parseInt(box.style.height, 10);
              if (width > 10 && height > 10) {
                cleanup({
                  x,
                  y,
                  width,
                  height,
                  viewportWidth: window.innerWidth,
                  viewportHeight: window.innerHeight,
                });
              }
            }
          };

          scrim.addEventListener("mousedown", onMouseDown);
          scrim.addEventListener("mousemove", onMouseMove);
          scrim.addEventListener("mouseup", onMouseUp);
          window.addEventListener("keydown", onKeyDown, true);
        });
      } catch {
        return { status: "unavailable" } satisfies ScreenshotRegionSelectionResult;
      }
    },
    []
  );

  if (!result) {
    return { status: "unavailable" };
  }
  if (result.status === "selected") {
    const { selection } = result;
    if (
      Number.isFinite(selection.x) &&
      Number.isFinite(selection.y) &&
      Number.isFinite(selection.width) &&
      Number.isFinite(selection.height) &&
      selection.width > 0 &&
      selection.height > 0 &&
      selection.viewportWidth > 0 &&
      selection.viewportHeight > 0
    ) {
      return result;
    }
    return { status: "cancelled" };
  }
  if (result.status === "cancelled") {
    return result;
  }
  return { status: "unavailable" };
};

const resolveSaveContentKind = (context: ImportClickContext): SaveContentKind => {
  const mediaUrl =
    context.mediaUrl || (!context.mediaUrl && looksLikeMediaUrl(context.linkUrl) ? context.linkUrl : null);
  const mediaType = resolveMediaType(context.mediaType, mediaUrl);
  const hasSelectionText = context.selectionText.length > 0;

  if (mediaType === "image" && !!mediaUrl) {
    return "image-only";
  }
  if (hasSelectionText && !mediaUrl) {
    return "text-only";
  }
  return "default";
};

const resolveSavePrimaryUrl = (context: ImportClickContext) =>
  context.pageUrl || context.frameUrl || context.tabUrl || context.linkUrl || context.mediaUrl || null;

const resolveSavePrimaryUrlOrFallback = (
  context: ImportClickContext,
  mode: ImportMode
): { url: string; synthetic: boolean } => {
  const primary = resolveSavePrimaryUrl(context);
  if (primary) {
    return { url: primary, synthetic: false };
  }
  return { url: buildSyntheticImportUrl(context, mode), synthetic: true };
};

const fetchImageDomMetadata = async (
  tab: chrome.tabs.Tab | undefined,
  mediaUrl: string
): Promise<ImageDomMetadata | null> => {
  return await executeScriptInTab<ImageDomMetadata | null>(
    tab,
    (targetUrl: string) => {
      const normalize = (raw: string | null | undefined) => {
        if (!raw) return "";
        try {
          return new URL(raw, window.location.href).toString();
        } catch {
          return "";
        }
      };
      const normalizedTarget = normalize(targetUrl);
      const images = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
      const directMatch = images.find((img) => {
        const current = normalize(img.currentSrc || img.src);
        return !!current && current === normalizedTarget;
      });
      const looseMatch =
        directMatch ||
        images.find((img) => {
          const src = img.currentSrc || img.src || "";
          return src.includes(targetUrl) || targetUrl.includes(src);
        }) ||
        null;

      const siteNameMeta =
        (document.querySelector('meta[property="og:site_name"]') as HTMLMetaElement | null)?.content ||
        (document.querySelector('meta[name="application-name"]') as HTMLMetaElement | null)?.content ||
        "";
      const iconEl = document.querySelector(
        'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
      ) as HTMLLinkElement | null;
      const iconHref = iconEl?.getAttribute("href") || "";
      let faviconUrl = "";
      if (iconHref) {
        try {
          faviconUrl = new URL(iconHref, window.location.href).toString();
        } catch {}
      }
      if (!faviconUrl) {
        try {
          faviconUrl = new URL("/favicon.ico", window.location.origin).toString();
        } catch {}
      }

      const image = looseMatch;
      return {
        pageTitle: (document.title || "").trim(),
        siteName: (siteNameMeta || window.location.hostname.replace(/^www\./, "")).trim(),
        pageUrl: window.location.href,
        faviconUrl,
        altText: (image?.getAttribute("alt") || "").trim(),
        titleText: (image?.getAttribute("title") || "").trim(),
        ariaLabel: (image?.getAttribute("aria-label") || "").trim(),
        width: Number(image?.naturalWidth || 0),
        height: Number(image?.naturalHeight || 0),
      } satisfies ImageDomMetadata;
    },
    [mediaUrl]
  );
};

const buildTextOnlyContent = (context: ImportClickContext): PreparedImportContent | null => {
  const selected = normalizeSelectionText(context.selectionText);
  if (!selected) return null;
  const saveTarget = resolveSavePrimaryUrlOrFallback(context, "save");
  const source = inferSource(resolveSavePrimaryUrl(context) || saveTarget.url);
  const title = trimText(selected.split(/\n+/).find((line) => line.trim()) || selected, 80);
  return {
    primaryUrl: saveTarget.url,
    title,
    textContent: selected,
    source,
    iconUrl: context.tabFavIconUrl || undefined,
    tags: uniqueList([source !== "web" ? source : "", "text", pickHostLabel(context)]),
    shouldFetchMetadata: false,
    isMetaFetched: true,
  };
};

const buildImageOnlyContent = async (
  context: ImportClickContext,
  tab: chrome.tabs.Tab | undefined
): Promise<PreparedImportContent | null> => {
  const mediaUrl =
    context.mediaUrl || (!context.mediaUrl && looksLikeMediaUrl(context.linkUrl) ? context.linkUrl : null);
  if (!mediaUrl) return null;
  const mediaType = resolveMediaType(context.mediaType, mediaUrl);
  if (mediaType !== "image") return null;

  const domMeta = await fetchImageDomMetadata(tab, mediaUrl);
  const pageUrl = normalizeHttpUrl(domMeta?.pageUrl || null) || resolveSavePrimaryUrl(context) || null;
  const source = inferSource(pageUrl || mediaUrl);

  let media: ItemDocType["media"] | undefined;
  let displayImageUrl: string | undefined;
  try {
    const mediaResult = await uploadRemoteMediaIfPresent({
      ...context,
      mediaUrl,
      mediaType: "image",
    });
    if (mediaResult.upload?.url) {
      media = [{
        type: "image",
        originalUrl: mediaUrl,
        storageType: "s3",
        s3Url: mediaResult.upload.url,
        altText: domMeta?.altText || undefined,
        titleText: domMeta?.titleText || undefined,
        ariaLabel: domMeta?.ariaLabel || undefined,
        pageUrl: pageUrl || undefined,
        pageTitle: domMeta?.pageTitle || undefined,
        siteName: domMeta?.siteName || undefined,
        faviconUrl: normalizeIconUrl(domMeta?.faviconUrl || null) || context.tabFavIconUrl || undefined,
        width: domMeta?.width || undefined,
        height: domMeta?.height || undefined,
        capturedAt: context.capturedAt,
      }];
      displayImageUrl = mediaResult.upload.url || undefined;
    }
  } catch {}

  if (!media) {
    media = [{
      type: "image",
      originalUrl: mediaUrl,
      storageType: "hotlink",
      altText: domMeta?.altText || undefined,
      titleText: domMeta?.titleText || undefined,
      ariaLabel: domMeta?.ariaLabel || undefined,
      pageUrl: pageUrl || undefined,
      pageTitle: domMeta?.pageTitle || undefined,
      siteName: domMeta?.siteName || undefined,
      faviconUrl: normalizeIconUrl(domMeta?.faviconUrl || null) || context.tabFavIconUrl || undefined,
      width: domMeta?.width || undefined,
      height: domMeta?.height || undefined,
      capturedAt: context.capturedAt,
    }];
    displayImageUrl = mediaUrl;
  }

  const candidateLabel = trimText(
    domMeta?.altText || domMeta?.titleText || domMeta?.ariaLabel || getFileNameFromUrl(mediaUrl),
    80
  );
  const title = candidateLabel || trimText(`Image · ${pickHostLabel(context)}`, 80);
  const metadataLines = [
    domMeta?.altText ? `Alt: ${domMeta.altText}` : "",
    domMeta?.titleText ? `Title: ${domMeta.titleText}` : "",
    domMeta?.siteName ? `Site: ${domMeta.siteName}` : "",
    domMeta?.pageTitle ? `Page title: ${domMeta.pageTitle}` : "",
    pageUrl ? `Page URL: ${pageUrl}` : "",
    mediaUrl ? `Image URL: ${mediaUrl}` : "",
    domMeta?.faviconUrl ? `Favicon: ${domMeta.faviconUrl}` : "",
    domMeta?.width && domMeta?.height ? `Dimensions: ${domMeta.width}x${domMeta.height}` : "",
    `Imported at: ${new Date(context.capturedAt).toISOString()}`,
  ].filter(Boolean);

  return {
    primaryUrl: mediaUrl,
    title,
    textContent: metadataLines.join("\n"),
    source,
    iconUrl: normalizeIconUrl(domMeta?.faviconUrl || null) || context.tabFavIconUrl || undefined,
    displayImageUrl,
    media,
    tags: uniqueList([source !== "web" ? source : "", "image", pickHostLabel(context)]),
    shouldFetchMetadata: false,
    isMetaFetched: true,
  };
};

const buildExtractedImageTextContent = async (
  context: ImportClickContext,
  tab: chrome.tabs.Tab | undefined,
  job: { id: string; label: string }
): Promise<PreparedImportContent> => {
  const mediaUrl =
    context.mediaUrl || (!context.mediaUrl && looksLikeMediaUrl(context.linkUrl) ? context.linkUrl : null);
  if (!mediaUrl || resolveMediaType(context.mediaType, mediaUrl) !== "image") {
    throw new Error("No image found for text extraction.");
  }

  const domMeta = await fetchImageDomMetadata(tab, mediaUrl);
  const pageUrl = normalizeHttpUrl(domMeta?.pageUrl || null) || context.pageUrl || context.tabUrl || null;
  const source = inferSource(pageUrl || mediaUrl);

  sendProcessStatus(job.id, job.label, "processing", "Running OCR...");
  const result = await sendForwardedToOffscreen<ExtractImageTextResponse>({
    service: "ocr",
    type: "extractImageText",
    payload: { url: mediaUrl },
  });
  if (result.status !== "done" || !result.text.trim()) {
    throw new Error(result.error || "No readable text found in image.");
  }

  const text = trimMultilineText(result.text, 12000);
  const firstLine = text.split(/\n+/).find((line) => line.trim()) || "";
  const titleSeed =
    firstLine ||
    domMeta?.altText ||
    domMeta?.titleText ||
    domMeta?.ariaLabel ||
    getFileNameFromUrl(mediaUrl);
  const metadataLines = [
    "",
    "Image metadata:",
    domMeta?.altText ? `Alt: ${domMeta.altText}` : "",
    domMeta?.titleText ? `Title: ${domMeta.titleText}` : "",
    domMeta?.siteName ? `Site: ${domMeta.siteName}` : "",
    domMeta?.pageTitle ? `Page title: ${domMeta.pageTitle}` : "",
    pageUrl ? `Page URL: ${pageUrl}` : "",
    `Image URL: ${mediaUrl}`,
    domMeta?.width && domMeta?.height ? `Dimensions: ${domMeta.width}x${domMeta.height}` : "",
    result.lineCount ? `OCR lines: ${result.lineCount}` : "",
    typeof result.confidence === "number" ? `OCR confidence: ${Math.round(result.confidence * 100)}%` : "",
    `Extracted at: ${new Date(context.capturedAt).toISOString()}`,
  ].filter(Boolean);

  return {
    primaryUrl: mediaUrl,
    title: trimText(`Image text · ${titleSeed}`, 80),
    textContent: trimMultilineText([text, ...metadataLines].join("\n"), 16000),
    source,
    iconUrl: normalizeIconUrl(domMeta?.faviconUrl || null) || context.tabFavIconUrl || undefined,
    ocrText: text,
    ocrStatus: "done",
    ocrConfidence: result.confidence,
    ocrLineCount: result.lineCount,
    ocrSourceHash: result.sourceHash,
    tags: uniqueList([source !== "web" ? source : "", "image-text", "ocr", pickHostLabel(context)]),
    shouldFetchMetadata: false,
    isMetaFetched: true,
  };
};

const captureScreenshotMedia = async (
  context: ImportClickContext,
  tab: chrome.tabs.Tab | undefined,
  job: { id: string; label: string },
  mode: "visible" | "region" = "visible"
): Promise<{ media?: ItemDocType["media"]; displayImageUrl?: string }> => {
  let regionSelection: ScreenshotRegionSelection | undefined;

  if (mode === "region") {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      sendProcessStatus(
        job.id,
        job.label,
        "processing",
        "Area crop is not available in this browser context. Capturing full tab instead."
      );
    } else {
      sendProcessStatus(job.id, job.label, "processing", "Select an area to capture...");
      const regionResult = await selectScreenshotRegion(tab);
      if (regionResult.status === "cancelled") {
        throw new ImportCancelledError("Screenshot area selection cancelled.");
      }
      if (regionResult.status === "selected") {
        regionSelection = regionResult.selection;
      } else {
        sendProcessStatus(
          job.id,
          job.label,
          "processing",
          "Area selection is unavailable on this page. Capturing full tab instead."
        );
      }
    }
  }

  sendProcessStatus(job.id, job.label, "processing", "Capturing screenshot...");
  let upload: MediaUploadResponse;
  try {
    upload = await uploadScreenshot(
      context,
      tab,
      0,
      regionSelection,
      async () => {
        sendProcessStatus(job.id, job.label, "processing", "Screenshot captured. Uploading...");
        await showBrandedToast(tab, "Screenshot captured. Uploading...");
      }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Screenshot capture failed.";
    await showBrandedToast(tab, detail);
    throw error;
  }

  if (!upload.url) {
    throw new Error("Screenshot upload failed. Nothing was captured.");
  }

  sendProcessStatus(job.id, job.label, "processing", "Screenshot uploaded.");

  const sourcePage = context.pageUrl || context.tabUrl || "screenshot";
  const media: ItemDocType["media"] = [{
    type: "image",
    originalUrl: `${sourcePage}#screenshot-1`,
    storageType: "s3",
    s3Url: upload.url,
    pageUrl: context.pageUrl || context.tabUrl || undefined,
    pageTitle: context.tabTitle || undefined,
    faviconUrl: context.tabFavIconUrl || undefined,
    capturedAt: context.capturedAt,
  }];
  return {
    media,
    displayImageUrl: upload.url,
  };
};
const prepareImportContent = async (
  target: ImportTarget,
  context: ImportClickContext,
  tab: chrome.tabs.Tab | undefined,
  job: { id: string; label: string }
): Promise<PreparedImportContent> => {
  if (target.mode === "shot") {
    const resolved = resolveSavePrimaryUrlOrFallback(context, "shot");
    const primaryUrl = resolved.url;
    const screenshot = await captureScreenshotMedia(context, tab, job, target.screenshotMode || "visible");
    const source = inferSource(primaryUrl);
    return {
      primaryUrl,
      title: createTitle(context, target.mode, primaryUrl),
      textContent: contextText(context, target.mode),
      source,
      iconUrl: context.tabFavIconUrl || undefined,
      displayImageUrl: screenshot.displayImageUrl,
      media: screenshot.media,
      tags: uniqueList([source !== "web" ? source : "", "screenshot", pickHostLabel(context)]),
      shouldFetchMetadata: !resolved.synthetic,
      isMetaFetched: resolved.synthetic,
    };
  }

  // Extract platform-aware content (canonical URL, title, author, media)
  const extracted = await extractContentFromPage(tab, context.linkUrl || context.pageUrl || undefined);

  const kind = resolveSaveContentKind(context);
  if (kind === "text-only") {
    const textOnly = buildTextOnlyContent(context);
    if (textOnly) return textOnly;
  }
  if (kind === "image-only") {
    const imageOnly = await buildImageOnlyContent(context, tab);
    if (imageOnly) return imageOnly;
  }

  const resolved = resolveSavePrimaryUrlOrFallback(context, "save");
  const primaryUrl = extracted?.canonicalUrl || resolved.url;
  const source = inferSource(primaryUrl);
  let media: ItemDocType["media"] | undefined;
  let displayImageUrl: string | undefined;
  
  // Use extracted media if available
  if (extracted?.mediaUrls && extracted.mediaUrls.length > 0) {
    media = extracted.mediaUrls.slice(0, 4).map((m) => ({
      type: m.type,
      originalUrl: m.url,
      storageType: "hotlink" as const,
    }));
    if (extracted.mediaUrls[0].type === "image") {
      displayImageUrl = extracted.thumbnailUrl || extracted.mediaUrls[0].url;
    }
  }
  
  // Otherwise try to upload remote media from context
  if (!media) {
    try {
      const mediaResult = await uploadRemoteMediaIfPresent(context);
      if (mediaResult.upload?.url && mediaResult.mediaType) {
        media = [{
          type: mediaResult.mediaType,
          originalUrl: mediaResult.originalUrl || primaryUrl,
          storageType: "s3",
          s3Url: mediaResult.upload.url,
        }];
        if (mediaResult.mediaType === "image") displayImageUrl = mediaResult.upload.url || undefined;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Media upload failed.";
      sendProcessStatus(
        job.id,
        job.label,
        "processing",
        `Media upload failed (${detail}). Continuing without media preview.`
      );
    }
  }

  // Use extracted content for title, description, author
  const title = extracted?.title || createTitle(context, target.mode, primaryUrl);
  const textContent = extracted?.description || contextText(context, target.mode);

  return {
    primaryUrl,
    title,
    textContent,
    source,
    iconUrl: context.tabFavIconUrl || undefined,
    displayImageUrl,
    media,
    tags: suggestedTags(context, source),
    shouldFetchMetadata: !resolved.synthetic && !extracted,
    isMetaFetched: resolved.synthetic || !!extracted,
  };
};

const toItemPayload = (params: {
  context: ImportClickContext;
  mode: ImportMode;
  primaryUrl: string;
  folderId: string;
  parentId: string | null;
  title?: string;
  textContent?: string;
  source?: ItemDocType["source"];
  iconUrl?: string;
  displayImageUrl?: string;
  media?: ItemDocType["media"];
  ocrText?: string;
  ocrStatus?: ItemDocType["ocrStatus"];
  ocrConfidence?: number;
  ocrLineCount?: number;
  ocrSourceHash?: string;
  shouldFetchMetadata?: boolean;
  isMetaFetched?: boolean;
}) => ({
  folderId: params.folderId,
  url: params.primaryUrl,
  title: params.title || createTitle(params.context, params.mode, params.primaryUrl),
  textContent: params.textContent || contextText(params.context, params.mode),
  source: params.source || inferSource(params.primaryUrl),
  iconUrl: params.iconUrl,
  displayImageUrl: params.displayImageUrl,
  media: params.media,
  ocrText: params.ocrText,
  ocrStatus: params.ocrStatus,
  ocrConfidence: params.ocrConfidence,
  ocrLineCount: params.ocrLineCount,
  ocrSourceHash: params.ocrSourceHash,
  parentId: params.parentId,
  chunkOrder: params.context.capturedAt,
  allowLockedPrivateWrite: true,
  isMetaFetched: params.isMetaFetched ?? false,
  shouldFetchMetadata: params.shouldFetchMetadata ?? true,
  isDirty: true,
  createdAt: params.context.capturedAt,
  updatedAt: params.context.capturedAt,
});

const resolveTargetFolder = async (
  target: { spaceId: string; folderId?: string; newFolderName?: string },
  context: ImportClickContext,
  mode: ImportMode
) => {
  const folderId = (target.folderId || "").trim();
  if (folderId) return folderId;
  const created = await sendForwardedToOffscreen<FolderDocType>({
    service: "folders",
    type: "create",
    payload: {
      name: (target.newFolderName || "").trim() || autoFolderName(context, mode),
      userId: "",
      spaceId: target.spaceId || PUBLIC_SPACE_ID,
      allowLockedPrivateWrite: true,
    },
  });
  if (!created?.id) throw new Error("Could not create destination folder.");
  return created.id;
};

let menuRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let menuRefreshRunning = false;
let menuRefreshQueued = false;
let lastMenuRefreshAt = 0;

const loadImportTargets = async () => {
  try {
    const payload = await sendForwardedToOffscreen<ImportTargetSpace[]>({
      service: "dbManager",
      type: "getImportTargets",
      payload: { maxSpaces: MENU_MAX_SPACES, maxFoldersPerSpace: MENU_MAX_FOLDERS, maxItemsPerFolder: MENU_MAX_ITEMS },
    });
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [] as ImportTargetSpace[];
  }
};
const refreshContextMenus = async () => {
  if (menuRefreshRunning) {
    menuRefreshQueued = true;
    return;
  }
  menuRefreshRunning = true;
  menuRefreshQueued = false;
  try {
    await new Promise<void>((resolve) => chrome.contextMenus.removeAll(() => resolve()));
    const add = (options: chrome.contextMenus.CreateProperties) =>
      new Promise<void>((resolve, reject) => {
        chrome.contextMenus.create(options, () =>
          chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()
        );
      });

    await add({ id: MENU_ROOT_ID, title: "VibeSearch", contexts: IMPORT_CONTEXTS });
    
    // Content-aware primary actions
    await add({ 
      id: MENU_SAVE_IMAGE_ID, 
      parentId: MENU_ROOT_ID, 
      title: "Save image", 
      contexts: [chrome.contextMenus.ContextType.IMAGE] 
    });
    await add({
      id: MENU_EXTRACT_TEXT_ID,
      parentId: MENU_ROOT_ID,
      title: "Extract text from image",
      contexts: [chrome.contextMenus.ContextType.IMAGE]
    });
    await add({ 
      id: MENU_SAVE_VIDEO_ID, 
      parentId: MENU_ROOT_ID, 
      title: "Save video", 
      contexts: [chrome.contextMenus.ContextType.VIDEO] 
    });
    await add({ 
      id: MENU_SAVE_LINK_ID, 
      parentId: MENU_ROOT_ID, 
      title: "Save link", 
      contexts: [chrome.contextMenus.ContextType.LINK] 
    });
    await add({ 
      id: MENU_SAVE_SELECTION_ID, 
      parentId: MENU_ROOT_ID, 
      title: "Save quote", 
      contexts: [chrome.contextMenus.ContextType.SELECTION] 
    });
    await add({ 
      id: MENU_SAVE_PAGE_ID, 
      parentId: MENU_ROOT_ID, 
      title: "Save this page", 
      contexts: [chrome.contextMenus.ContextType.PAGE, chrome.contextMenus.ContextType.FRAME] 
    });

    // Screenshot submenu
    await add({ id: `${MENU_ROOT_ID}:sep:shot`, parentId: MENU_ROOT_ID, type: "separator", contexts: IMPORT_CONTEXTS });
    await add({ 
      id: MENU_SHOT_VISIBLE_ID, 
      parentId: MENU_ROOT_ID, 
      title: "Screenshot visible area", 
      contexts: IMPORT_CONTEXTS 
    });
    await add({ 
      id: MENU_SHOT_REGION_ID, 
      parentId: MENU_ROOT_ID, 
      title: "Screenshot a region", 
      contexts: IMPORT_CONTEXTS 
    });

    // Save to… submenu (spaces/folders)
    await add({ id: `${MENU_ROOT_ID}:sep:targets`, parentId: MENU_ROOT_ID, type: "separator", contexts: IMPORT_CONTEXTS });
    await add({ id: MENU_SAVE_TARGETS_ID, parentId: MENU_ROOT_ID, title: "Save to…", contexts: IMPORT_CONTEXTS });

    const spaces = await loadImportTargets();
    const root = MENU_SAVE_TARGETS_ID;
    for (const space of spaces) {
      const spaceNodeId = `vs:node:save:space:${space.id}`;
      await add({
        id: spaceNodeId,
        parentId: root,
        title: trimText(space.isPrivate && !space.isUnlocked ? `${space.name} (locked)` : space.name, 60),
        contexts: IMPORT_CONTEXTS,
        enabled: true,
      });
      if (!space.isUnlocked) {
        await add({
          id: `vs:save:space:${space.id}`,
          parentId: spaceNodeId,
          title: "Save in this locked space (new folder)",
          contexts: IMPORT_CONTEXTS,
        });
        continue;
      }
      await add({
        id: `vs:save:space:${space.id}`,
        parentId: spaceNodeId,
        title: "Save in this space (new folder)",
        contexts: IMPORT_CONTEXTS,
      });
      for (const folder of space.folders.slice(0, MENU_MAX_FOLDERS)) {
        const folderNodeId = `vs:node:save:folder:${space.id}:${folder.id}`;
        await add({ id: folderNodeId, parentId: spaceNodeId, title: trimText(folder.name || "Untitled folder", 60), contexts: IMPORT_CONTEXTS });
        await add({
          id: `vs:save:folder:${folder.id}`,
          parentId: folderNodeId,
          title: "Save in this folder",
          contexts: IMPORT_CONTEXTS,
        });
        for (const item of folder.recentItems.slice(0, MENU_MAX_ITEMS)) {
          await add({
            id: `vs:save:item:${folder.id}:${item.id}`,
            parentId: folderNodeId,
            title: trimText(`Attach under: ${item.title}`, 60),
            contexts: IMPORT_CONTEXTS,
          });
        }
      }
    }

    await add({ id: `${MENU_ROOT_ID}:sep:extract`, parentId: MENU_ROOT_ID, type: "separator", contexts: [chrome.contextMenus.ContextType.IMAGE] });
    await add({
      id: MENU_EXTRACT_TARGETS_ID,
      parentId: MENU_ROOT_ID,
      title: "Extract text to…",
      contexts: [chrome.contextMenus.ContextType.IMAGE],
    });
    for (const space of spaces) {
      const spaceNodeId = `vs:node:extract:space:${space.id}`;
      await add({
        id: spaceNodeId,
        parentId: MENU_EXTRACT_TARGETS_ID,
        title: trimText(space.isPrivate && !space.isUnlocked ? `${space.name} (locked)` : space.name, 60),
        contexts: [chrome.contextMenus.ContextType.IMAGE],
        enabled: true,
      });
      if (!space.isUnlocked) {
        await add({
          id: `vs:extract:space:${space.id}`,
          parentId: spaceNodeId,
          title: "Extract into this locked space (new folder)",
          contexts: [chrome.contextMenus.ContextType.IMAGE],
        });
        continue;
      }
      await add({
        id: `vs:extract:space:${space.id}`,
        parentId: spaceNodeId,
        title: "Extract into this space (new folder)",
        contexts: [chrome.contextMenus.ContextType.IMAGE],
      });
      for (const folder of space.folders.slice(0, MENU_MAX_FOLDERS)) {
        await add({
          id: `vs:extract:folder:${folder.id}`,
          parentId: spaceNodeId,
          title: trimText(folder.name || "Untitled folder", 60),
          contexts: [chrome.contextMenus.ContextType.IMAGE],
        });
      }
    }

    await add({ id: `${MENU_ROOT_ID}:sep:2`, parentId: MENU_ROOT_ID, type: "separator", contexts: IMPORT_CONTEXTS });
    await add({ id: MENU_OPEN_SEARCH_ID, parentId: MENU_ROOT_ID, title: "Open VibeSearch", contexts: IMPORT_CONTEXTS });
  } catch (error) {
    console.error("[Background] Failed to refresh context menus:", error);
  } finally {
    menuRefreshRunning = false;
    lastMenuRefreshAt = Date.now();
    if (menuRefreshQueued) void refreshContextMenus();
  }
};
const scheduleContextMenuRefresh = (priority: "high" | "low" = "low") => {
  if (menuRefreshTimer) clearTimeout(menuRefreshTimer);
  const now = Date.now();
  const elapsed = now - lastMenuRefreshAt;
  const minGapDelay = Math.max(0, MENU_REFRESH_MIN_INTERVAL_MS - elapsed);
  const baseDelay =
    priority === "high" ? MENU_REFRESH_DEBOUNCE_MS : MENU_REFRESH_LOW_PRIORITY_DEBOUNCE_MS;
  const delay = priority === "high" ? baseDelay : Math.max(baseDelay, minGapDelay);
  menuRefreshTimer = setTimeout(() => {
    menuRefreshTimer = null;
    void refreshContextMenus();
  }, delay);
};

const createDraftFromAction = async (
  target: ImportTarget,
  context: ImportClickContext,
  tab: chrome.tabs.Tab | undefined,
  job: { id: string; label: string }
) => {
  const prepared = await prepareImportContent(target, context, tab, job);
  const draft: ImportDraft = {
    id: crypto.randomUUID(),
    mode: target.mode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    primaryUrl: prepared.primaryUrl,
    title: prepared.title,
    textContent: prepared.textContent,
    source: prepared.source,
    tags: prepared.tags,
    iconUrl: prepared.iconUrl,
    displayImageUrl: prepared.displayImageUrl,
    media: prepared.media,
    shouldFetchMetadata: prepared.shouldFetchMetadata,
    isMetaFetched: prepared.isMetaFetched,
    context,
    target: {
      spaceId: target.spaceId || PUBLIC_SPACE_ID,
      folderId: target.folderId,
      parentId: target.itemId || null,
      newFolderName: target.folderId ? undefined : autoFolderName(context, target.mode),
    },
  };
  const drafts = await loadDrafts();
  await saveDrafts([draft, ...drafts.filter((entry) => entry.id !== draft.id)]);
  return draft;
};

const openDraftEditor = async (draftId: string) => {
  const url = new URL(chrome.runtime.getURL("src/pages/popup/index.html"));
  url.searchParams.set("mode", "import");
  url.searchParams.set("draftId", draftId);
  await chrome.windows.create({ url: url.toString(), type: "popup", width: 500, height: 760, focused: true });
};

const runImportAction = async (
  target: ImportTarget,
  context: ImportClickContext,
  tab?: chrome.tabs.Tab
) => {
  const job = createImportJob(target.mode, context);
  sendProcessStatus(job.id, job.label, "processing", "Queued...");
  const settings = await getImportSettings();

  if (settings.reviewBeforeSave) {
    sendProcessStatus(job.id, job.label, "processing", "Preparing draft...");
    const draft = await createDraftFromAction(target, context, tab, job);
    await openDraftEditor(draft.id);
    sendProcessStatus(job.id, job.label, "success", "Draft ready. Review and save.");
    return;
  }

  sendProcessStatus(job.id, job.label, "processing", "Resolving destination...");

  const folderId = await resolveTargetFolder(
    { spaceId: target.spaceId || PUBLIC_SPACE_ID, folderId: target.folderId, newFolderName: autoFolderName(context, target.mode) },
    context,
    target.mode
  );

  const prepared = await prepareImportContent(target, context, tab, job);

  sendProcessStatus(job.id, job.label, "processing", "Saving...");
  await sendForwardedToOffscreen({
    service: "items",
    type: "addToFolder",
    payload: toItemPayload({
      context,
      mode: target.mode,
      primaryUrl: prepared.primaryUrl,
      folderId,
      parentId: target.itemId || null,
      title: prepared.title,
      textContent: prepared.textContent,
      source: prepared.source,
      iconUrl: prepared.iconUrl,
      media: prepared.media,
      displayImageUrl: prepared.displayImageUrl,
      shouldFetchMetadata: prepared.shouldFetchMetadata,
      isMetaFetched: prepared.isMetaFetched,
    }),
  });

  sendProcessStatus(job.id, job.label, "success", "Imported.");
  scheduleContextMenuRefresh("low");

  // Show branded toast with Undo / Open actions
  const primaryHostname = (() => {
    try {
      return new URL(prepared.primaryUrl).hostname.replace(/^www\./, "");
    } catch {
      return "this page";
    }
  })();
  await showBrandedToast(
    tab,
    `Saved from ${primaryHostname}`,
    [
      { label: "Undo", action: "UNDO_SAVE", payload: { primaryUrl: prepared.primaryUrl } },
      { label: "Open", action: "OPEN_SEARCH" },
    ],
    5000
  );
};

const runExtractTextAction = async (
  target: ImportTarget,
  context: ImportClickContext,
  tab?: chrome.tabs.Tab
) => {
  const job = createImportJob("extract", context);
  sendProcessStatus(job.id, job.label, "processing", "Resolving destination...");

  const folderId = await resolveTargetFolder(
    {
      spaceId: target.spaceId || PUBLIC_SPACE_ID,
      folderId: target.folderId,
      newFolderName: autoFolderName(context, "extract"),
    },
    context,
    "extract"
  );

  const prepared = await buildExtractedImageTextContent(context, tab, job);
  sendProcessStatus(job.id, job.label, "processing", "Saving extracted text...");
  const inserted = await sendForwardedToOffscreen<ItemDocType>({
    service: "items",
    type: "addToFolder",
    payload: toItemPayload({
      context,
      mode: "extract",
      primaryUrl: prepared.primaryUrl,
      folderId,
      parentId: null,
      title: prepared.title,
      textContent: prepared.textContent,
      source: prepared.source,
      iconUrl: prepared.iconUrl,
      ocrText: prepared.ocrText,
      ocrStatus: prepared.ocrStatus,
      ocrConfidence: prepared.ocrConfidence,
      ocrLineCount: prepared.ocrLineCount,
      ocrSourceHash: prepared.ocrSourceHash,
      shouldFetchMetadata: false,
      isMetaFetched: true,
    }),
  });

  sendProcessStatus(job.id, job.label, "success", "Extracted text saved.");
  scheduleContextMenuRefresh("low");
  await showBrandedToast(
    tab,
    "Extracted text saved",
    [
      { label: "Undo", action: "UNDO_SAVE", payload: { primaryUrl: inserted.url } },
      { label: "Open", action: "OPEN_SEARCH" },
    ],
    5000
  );
};

const runTargetAction = async (
  target: ImportTarget,
  context: ImportClickContext,
  tab?: chrome.tabs.Tab
) => {
  if (target.mode === "extract") {
    await runExtractTextAction(target, context, tab);
    return;
  }
  await runImportAction(target, context, tab);
};
const isSearchPageSender = (sender: chrome.runtime.MessageSender) => {
  const senderUrl = typeof sender.url === "string" ? sender.url : "";
  if (!senderUrl) return false;
  try {
    return new URL(senderUrl).pathname.endsWith(SEARCH_PAGE_PATH);
  } catch {
    return false;
  }
};
const isTrustedExtensionSender = (sender: chrome.runtime.MessageSender) => {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const senderUrl = typeof sender.url === "string" ? sender.url : "";
  if (!senderUrl) return true;
  try {
    return new URL(senderUrl).href.startsWith(chrome.runtime.getURL(""));
  } catch {
    return false;
  }
};
const isSearchOnlyOffscreenCall = (message: any) =>
  SEARCH_ONLY_OFFSCREEN_METHODS.has(`${message?.service || ""}:${message?.type || ""}`);
const isInternalOnlyOffscreenCall = (message: any) =>
  INTERNAL_ONLY_OFFSCREEN_METHODS.has(`${message?.service || ""}:${message?.type || ""}`);
const isSpaceUnlocked = async (spaceId: string): Promise<boolean> => {
  if (!spaceId || spaceId !== PRIVATE_SPACE_ID) return true;
  try {
    const state = await sendForwardedToOffscreen<{ isUnlocked?: boolean }>({
      service: "spaces",
      type: "getSpaceAccessState",
      payload: { spaceId },
    });
    return state?.isUnlocked === true;
  } catch {
    return false;
  }
};
const filterAccessibleDrafts = async (drafts: ImportDraft[]): Promise<ImportDraft[]> => {
  if (!drafts.some((draft) => draft.target.spaceId === PRIVATE_SPACE_ID)) {
    return drafts;
  }
  const privateUnlocked = await isSpaceUnlocked(PRIVATE_SPACE_ID);
  return drafts.filter((draft) => draft.target.spaceId !== PRIVATE_SPACE_ID || privateUnlocked);
};

const handleImportControlMessage = async (message: any, sender: chrome.runtime.MessageSender) => {
  if (!isTrustedExtensionSender(sender)) return { success: false, error: "UNAUTHORIZED_SENDER" };

  if (message.type === "IMPORT_RETRY_FAILED") {
    const statusId = `${message?.payload?.statusId || ""}`.trim();
    if (!statusId) return { success: false, error: "MISSING_STATUS_ID" };
    const attempt = getFailedImportAttempt(statusId);
    if (!attempt) return { success: false, error: "IMPORT_RETRY_NOT_FOUND" };
    const retryTab = await resolveRetryTab(attempt.tab);
    await runTargetAction(attempt.target, attempt.context, retryTab);
    failedImportAttempts.delete(statusId);
    return { success: true, payload: { retried: true } };
  }

  if (message.type === "IMPORT_GET_SETTINGS") {
    return { success: true, payload: await getImportSettings() };
  }
  if (message.type === "IMPORT_GET_PROCESS_STATUSES") {
    const max = Number(message?.payload?.max || 12);
    return { success: true, payload: listRecentProcessStatuses(max) };
  }
  if (message.type === "IMPORT_SET_SETTINGS") {
    return { success: true, payload: await setImportSettings(message?.payload?.reviewBeforeSave === true) };
  }
  if (message.type === "IMPORT_LIST_DRAFTS") {
    const drafts = await filterAccessibleDrafts(await loadDrafts());
    return {
      success: true,
      payload: drafts.map((draft) => ({
        id: draft.id,
        mode: draft.mode,
        title: draft.title,
        host: pickHostLabel(draft.context),
        createdAt: draft.createdAt,
      })),
    };
  }
  if (message.type === "IMPORT_GET_DRAFT") {
    const draftId = typeof message?.payload?.draftId === "string" ? message.payload.draftId : "";
    const [allDrafts, settings, targets] = await Promise.all([
      loadDrafts(),
      getImportSettings(),
      sendForwardedToOffscreen<ImportTargetSpace[]>({
        service: "dbManager",
        type: "getImportTargets",
        payload: { maxSpaces: 14, maxFoldersPerSpace: 40, maxItemsPerFolder: 12 },
      }).catch(() => [] as ImportTargetSpace[]),
    ]);
    const drafts = await filterAccessibleDrafts(allDrafts);
    const draft = draftId
      ? allDrafts.find((entry) => entry.id === draftId) || null
      : drafts[0] || null;
    return { success: true, payload: { draft, settings, targets } };
  }
  if (message.type === "IMPORT_OPEN_EDITOR") {
    const draftId = typeof message?.payload?.draftId === "string" ? message.payload.draftId : "";
    const accessibleDrafts = await filterAccessibleDrafts(await loadDrafts());
    let targetId = draftId;
    if (targetId && !accessibleDrafts.some((draft) => draft.id === targetId)) {
      targetId = "";
    }
    if (!targetId) targetId = accessibleDrafts[0]?.id || "";
    if (!targetId) return { success: false, error: "NO_IMPORT_DRAFTS" };
    await openDraftEditor(targetId);
    return { success: true, payload: { opened: true, draftId: targetId } };
  }
  if (message.type === "IMPORT_DELETE_DRAFT") {
    const draftId = (message?.payload?.draftId || "").trim();
    if (!draftId) return { success: false, error: "MISSING_DRAFT_ID" };
    await saveDrafts((await loadDrafts()).filter((entry) => entry.id !== draftId));
    return { success: true, payload: { deleted: true } };
  }
  if (message.type === "IMPORT_SUBMIT_DRAFT") {
    const payload = message.payload as ImportDraftSubmitPayload;
    const draftId = (payload?.draftId || "").trim();
    if (!draftId) return { success: false, error: "MISSING_DRAFT_ID" };

    const drafts = await loadDrafts();
    const draft = drafts.find((entry) => entry.id === draftId);
    if (!draft) return { success: false, error: "DRAFT_NOT_FOUND" };

    const primaryUrl = normalizeHttpUrl(payload.url || draft.primaryUrl);
    if (!primaryUrl) return { success: false, error: "INVALID_URL" };
    const originalDraftUrl = normalizeHttpUrl(draft.primaryUrl);
    const didPrimaryUrlChange = !!originalDraftUrl && originalDraftUrl !== primaryUrl;
    const effectiveMedia = didPrimaryUrlChange ? undefined : draft.media;
    const effectiveDisplayImageUrl = didPrimaryUrlChange
      ? undefined
      : payload.displayImageUrl ?? draft.displayImageUrl;
    const effectiveShouldFetchMetadata = didPrimaryUrlChange ? true : draft.shouldFetchMetadata ?? true;
    const effectiveIsMetaFetched = didPrimaryUrlChange ? false : draft.isMetaFetched ?? false;
    const effectiveSource = payload.source || (didPrimaryUrlChange ? inferSource(primaryUrl) : draft.source);

    const spaceId = (payload.spaceId || draft.target.spaceId || PUBLIC_SPACE_ID).trim() || PUBLIC_SPACE_ID;
    let folderId = (payload.folderId || draft.target.folderId || "").trim();
    if (folderId === "__new__" || !folderId) {
      const created = await sendForwardedToOffscreen<FolderDocType>({
        service: "folders",
        type: "create",
        payload: {
          name: (payload.createFolderName || draft.target.newFolderName || autoFolderName(draft.context, draft.mode)).trim(),
          userId: "",
          spaceId,
          allowLockedPrivateWrite: true,
        },
      });
      if (!created?.id) return { success: false, error: "FOLDER_CREATE_FAILED" };
      folderId = created.id;
    }

    const parentId =
      typeof payload.parentId === "string"
        ? payload.parentId || null
        : payload.parentId === null
          ? null
          : folderId === (draft.target.folderId || "")
            ? draft.target.parentId || null
            : null;

    const inserted = await sendForwardedToOffscreen<ItemDocType>({
      service: "items",
      type: "addToFolder",
      payload: toItemPayload({
        context: draft.context,
        mode: draft.mode,
        primaryUrl,
        folderId,
        parentId,
        title: trimText((payload.title || draft.title || "").trim() || primaryUrl),
        textContent: (payload.textContent ?? draft.textContent ?? "").trim(),
        source: effectiveSource,
        iconUrl: payload.iconUrl ?? draft.iconUrl,
        displayImageUrl: effectiveDisplayImageUrl,
        media: effectiveMedia,
        shouldFetchMetadata: effectiveShouldFetchMetadata,
        isMetaFetched: effectiveIsMetaFetched,
      }),
    });

    const tags = Array.isArray(payload.tags)
      ? uniqueList(payload.tags)
      : typeof payload.tags === "string"
        ? uniqueList(payload.tags.split(/[,\n]/))
        : uniqueList(draft.tags);

    for (const tagName of tags) {
      await sendForwardedToOffscreen({
        service: "tags",
        type: "addTagToItem",
        payload: { itemId: inserted.id, tagName },
      });
    }

    await saveDrafts(drafts.filter((entry) => entry.id !== draft.id));
    scheduleContextMenuRefresh("low");
    sendProcessStatus(`import-submit-${Date.now()}`, "Import", "success", "Draft imported.");
    return { success: true, payload: inserted };
  }

  return { success: false, error: "UNSUPPORTED_IMPORT_MESSAGE" };
};
chrome.contextMenus.onClicked.addListener((info, tab) => {
  let attemptedTarget: ImportTarget | null = null;
  let attemptedContext: ImportClickContext | null = null;
  const attemptedTabSnapshot = toTabSnapshot(tab);
  void (async () => {
    const menuId = typeof info.menuItemId === "string" ? info.menuItemId : `${info.menuItemId}`;
    if (menuId === MENU_OPEN_SEARCH_ID) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/search/index.html") });
      return;
    }
    const context = collectContext(info, tab);
    attemptedContext = context;
    
    // Content-aware primary actions (instant save to Public/auto-folder)
    if (menuId === MENU_SAVE_IMAGE_ID || menuId === MENU_SAVE_VIDEO_ID || 
        menuId === MENU_SAVE_LINK_ID || menuId === MENU_SAVE_SELECTION_ID || 
        menuId === MENU_SAVE_PAGE_ID) {
      attemptedTarget = { mode: "save", spaceId: PUBLIC_SPACE_ID };
      await runTargetAction(attemptedTarget, context, tab);
      return;
    }

    if (menuId === MENU_EXTRACT_TEXT_ID) {
      attemptedTarget = { mode: "extract", spaceId: PUBLIC_SPACE_ID };
      await runTargetAction(attemptedTarget, context, tab);
      return;
    }
    
    // Screenshot actions
    if (menuId === MENU_SHOT_VISIBLE_ID) {
      attemptedTarget = { mode: "shot", spaceId: PUBLIC_SPACE_ID };
      await runTargetAction(attemptedTarget, context, tab);
      return;
    }
    if (menuId === MENU_SHOT_REGION_ID) {
      attemptedTarget = { mode: "shot", spaceId: PUBLIC_SPACE_ID, screenshotMode: "region" };
      await runTargetAction(attemptedTarget, context, tab);
      return;
    }
    
    // Targeting submenu (Save to…)
    const target = parseTargetFromMenuId(menuId);
    if (target) {
      attemptedTarget = target;
      await runTargetAction(target, context, tab);
    }
  })().catch((error) => {
    const detail = error instanceof Error ? error.message : "Import failed.";
    const statusId = `import-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (error instanceof ImportCancelledError) {
      sendProcessStatus(statusId, "Import", "success", detail);
      return;
    }
    if (attemptedTarget && attemptedContext) {
      rememberFailedImportAttempt(statusId, {
        target: attemptedTarget,
        context: attemptedContext,
        tab: attemptedTabSnapshot,
        createdAt: Date.now(),
      });
      sendProcessStatus(statusId, "Import", "error", detail, "RETRY_IMPORT");
      return;
    }
    sendProcessStatus(statusId, "Import", "error", detail);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 6 * 60 });
  chrome.alarms.create(EMBEDDING_ALARM_NAME, { periodInMinutes: 5 });
  scheduleContextMenuRefresh("high");
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await setupOffscreenDocument();
    await chrome.runtime.sendMessage({
      type: "TRIGGER_EMBEDDING",
      target: "offscreen",
      isForwarded: true,
    });
  })().catch(() => {});
  scheduleContextMenuRefresh("high");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    await setupOffscreenDocument();
    if (alarm.name === SYNC_ALARM_NAME) {
      await chrome.runtime.sendMessage({
        service: "sync",
        type: "rebuildAndCompact",
        target: "offscreen",
        isForwarded: true,
      });
    } else if (alarm.name === EMBEDDING_ALARM_NAME) {
      await chrome.runtime.sendMessage({
        type: "TRIGGER_EMBEDDING",
        target: "offscreen",
        isForwarded: true,
      });
    }
  })().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "background" && message?.type === "FETCH_METADATA") {
    const { urls, revalidate } = message.payload || { urls: [], revalidate: false };
    scheduleForProcessing(urls, revalidate === true);
    return;
  }

  if (message?.target === "background" && message?.type === "UNDO_SAVE") {
    const primaryUrl = typeof message?.payload?.primaryUrl === "string" ? message.payload.primaryUrl : "";
    if (primaryUrl) {
      void sendForwardedToOffscreen({
        service: "items",
        type: "deleteByUrl",
        payload: { url: primaryUrl },
      }).catch(() => {});
    }
    return;
  }

  if (message?.target === "background" && message?.type === "OPEN_SEARCH") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/search/index.html") });
    return;
  }

  if (message?.target === "background" && typeof message?.type === "string" && message.type.startsWith("IMPORT_")) {
    void handleImportControlMessage(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ success: false, error: error instanceof Error ? error.message : "Unknown error" })
      );
    return true;
  }

  if (
    message?.type === "DB_CHANGE" &&
    (message.scope === "items" || message.scope === "folders" || message.scope === "spaces")
  ) {
    scheduleContextMenuRefresh(message.scope === "items" ? "low" : "high");
    return;
  }

  if (message?.target !== "offscreen" || message?.isForwarded) {
    return;
  }

  if (!isTrustedExtensionSender(sender)) {
    sendResponse({ success: false, error: "UNAUTHORIZED_SENDER" });
    return true;
  }

  if (isSearchOnlyOffscreenCall(message) && !isSearchPageSender(sender)) {
    sendResponse({ success: false, error: "UNAUTHORIZED_CONTEXT" });
    return true;
  }

  if (isInternalOnlyOffscreenCall(message)) {
    sendResponse({ success: false, error: "UNAUTHORIZED_CONTEXT" });
    return true;
  }

  void (async () => {
    try {
      if ((import.meta as any)?.env?.MODE === "development" && FORCE_DEV_OFFSCREEN_RESET) {
        try {
          await (chrome.offscreen as any).closeDocument?.();
        } catch {}
      }

      await setupOffscreenDocument();
      const response = await chrome.runtime.sendMessage({ ...message, isForwarded: true });
      sendResponse(response);
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();

  return true;
});

scheduleContextMenuRefresh("high");

console.log("Background script loaded with offscreen routing, context import, and draft review.");
