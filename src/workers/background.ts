import { scheduleForProcessing } from "@src/services/metadata-pipeline";
import { setupOffscreenDocument } from "@src/services/offscreen-helper";
import { PRIVATE_SPACE_ID, PUBLIC_SPACE_ID } from "@src/common/spaces";
import type { ImportTargetSpace } from "@src/services/db-manager";
import type { FolderDocType } from "@src/schemas/folder_schema";
import type { ItemDocType } from "@src/schemas/item_schema";

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

const IMPORT_MEDIA_ENDPOINT = "https://meta.vibesearch.app/import-media";
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
const MENU_QUICK_SAVE_ID = "vs:quick:save";
const MENU_QUICK_SHOT_ID = "vs:quick:shot";
const MENU_SAVE_TARGETS_ID = "vs:targets:save";
const MENU_SHOT_TARGETS_ID = "vs:targets:shot";
const MENU_MAX_SPACES = 6;
const MENU_MAX_FOLDERS = 8;
const MENU_MAX_ITEMS = 2;
const MENU_REFRESH_DEBOUNCE_MS = 180;
const MENU_REFRESH_LOW_PRIORITY_DEBOUNCE_MS = 900;
const MENU_REFRESH_MIN_INTERVAL_MS = 2500;
const MAX_SCREENSHOT_IMAGES_PER_ITEM = 8;
const SCREENSHOT_CAPTURE_PROMPT_SETTLE_DELAY_MS = 120;
const SCREENSHOT_CAPTURE_FALLBACK_DELAY_MS = 900;
const LOCAL_IMPORT_HOST = "local.vibesearch.invalid";
const PROCESS_STATUS_HISTORY_MAX = 120;

type OffscreenResponse<T> = { success?: boolean; payload?: T; error?: string };
type ImportMode = "save" | "shot";
type ImportTarget = { mode: ImportMode; spaceId?: string; folderId?: string; itemId?: string };
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
  tags: string[];
  shouldFetchMetadata: boolean;
  isMetaFetched: boolean;
};
type ScreenshotPromptChoice = "full" | "region" | "cancel";
type ScreenshotPromptAction = {
  id: ScreenshotPromptChoice;
  label: string;
};
type ScreenshotPromptRequest = {
  heading: string;
  body: string;
  actions: ScreenshotPromptAction[];
  fallbackConfirmAction?: "full" | "region";
};
type ScreenshotPromptResult = {
  choice: ScreenshotPromptChoice;
  method: "overlay" | "confirm" | "fallback-auto";
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
  const pathMode = mode === "shot" ? "screenshot" : "import";
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
  return trimText(`${mode === "shot" ? "Screenshots" : "Imports"} · ${pickHostLabel(context)} · ${day}`, 80);
};
const inferSource = (url: string | null): ItemDocType["source"] => {
  const host = getHostname(url);
  if (!host) return "web";
  if (host.includes("x.com") || host.includes("twitter.com")) return "twitter";
  if (host.includes("reddit.com")) return "reddit";
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("substack.com")) return "substack";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("github.com")) return "github";
  if (host.includes("medium.com") || host.includes("dev.to")) return "article";
  return "web";
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
  label: `${mode === "shot" ? "Screenshot" : "Import"} • ${pickHostLabel(context)}`,
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

const postImportMediaJson = async (body: Record<string, unknown>) => {
  const headers = buildImportUploadHeaders("application/json");
  const response = await fetch(IMPORT_MEDIA_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as MediaUploadResponse;
  if (!response.ok) throw new Error(payload.error || `Media upload failed (${response.status})`);
  return { ...payload, url: payload.url || (payload.key ? `https://bucket.vibesearch.app/${payload.key}` : null) };
};
const postImportMediaBinary = async (blob: Blob, sourcePageUrl?: string | null, fileName?: string) => {
  const headers = buildImportUploadHeaders(blob.type || "image/png");
  if (sourcePageUrl) headers.set("X-VS-Source-Url", sourcePageUrl);
  if (fileName) headers.set("X-VS-File-Name", fileName);
  const response = await fetch(IMPORT_MEDIA_ENDPOINT, { method: "POST", headers, body: blob });
  const payload = (await response.json().catch(() => ({}))) as MediaUploadResponse;
  if (!response.ok) throw new Error(payload.error || `Binary upload failed (${response.status})`);
  return { ...payload, url: payload.url || (payload.key ? `https://bucket.vibesearch.app/${payload.key}` : null) };
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
  const bySpace = /^vs:(save|shot):space:([^:]+)$/i.exec(menuId);
  if (bySpace) return { mode: bySpace[1] as ImportMode, spaceId: bySpace[2] };
  const byFolder = /^vs:(save|shot):folder:([^:]+)$/i.exec(menuId);
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
  return context.linkUrl || context.pageUrl || context.frameUrl || context.mediaUrl || context.tabUrl || null;
};
const createTitle = (context: ImportClickContext, mode: ImportMode, fallbackUrl: string) => {
  if (mode === "shot") return trimText(context.tabTitle ? `Screenshot · ${context.tabTitle}` : `Screenshot · ${fallbackUrl}`);
  if (context.selectionText) return trimText(context.selectionText.replace(/\s+/g, " "));
  if (context.tabTitle) return trimText(context.tabTitle);
  return trimText(fallbackUrl);
};
const contextText = (context: ImportClickContext, mode: ImportMode) => {
  const lines: string[] = [];
  if (context.selectionText) lines.push(context.selectionText, "");
  lines.push(`Imported via: ${mode === "shot" ? "page-screenshot" : "context-menu"}`);
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

const showCaptureToastInTab = async (
  tab: chrome.tabs.Tab | undefined,
  message: string,
  tone: "info" | "success" | "error" = "info"
) => {
  await executeScriptInTab(
    tab,
    (payload: { message: string; tone: "info" | "success" | "error" }) => {
      try {
        const rootId = "__vibesearch_capture_toast_root__";
        let root = document.getElementById(rootId);
        if (!root) {
          root = document.createElement("div");
          root.id = rootId;
          root.style.position = "fixed";
          root.style.right = "14px";
          root.style.bottom = "14px";
          root.style.zIndex = "2147483647";
          root.style.display = "flex";
          root.style.flexDirection = "column";
          root.style.gap = "8px";
          root.style.pointerEvents = "none";
          document.documentElement.appendChild(root);
        }

        const toast = document.createElement("div");
        toast.style.maxWidth = "320px";
        toast.style.padding = "9px 12px";
        toast.style.borderRadius = "10px";
        toast.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        toast.style.fontSize = "12px";
        toast.style.fontWeight = "600";
        toast.style.lineHeight = "1.35";
        toast.style.pointerEvents = "none";
        toast.style.boxShadow = "0 14px 26px rgba(2, 6, 23, 0.35)";
        toast.style.border = "1px solid rgba(148, 163, 184, 0.45)";
        if (payload.tone === "success") {
          toast.style.background = "rgba(22, 163, 74, 0.9)";
          toast.style.color = "#dcfce7";
        } else if (payload.tone === "error") {
          toast.style.background = "rgba(185, 28, 28, 0.92)";
          toast.style.color = "#fee2e2";
        } else {
          toast.style.background = "rgba(15, 23, 42, 0.92)";
          toast.style.color = "#e2e8f0";
        }
        toast.textContent = payload.message;
        root.appendChild(toast);
        window.setTimeout(() => {
          toast.remove();
          if (root && root.childElementCount === 0) {
            root.remove();
          }
        }, 2200);
      } catch {}
    },
    [{ message, tone }]
  );
};

const pickPromptFallbackAction = (request: ScreenshotPromptRequest): "full" | "region" => {
  if (request.fallbackConfirmAction === "region") {
    return "region";
  }
  if (request.actions.some((action) => action.id === "full")) {
    return "full";
  }
  if (request.actions.some((action) => action.id === "region")) {
    return "region";
  }
  return "full";
};

const promptScreenshotCapture = async (
  tab: chrome.tabs.Tab | undefined,
  request: ScreenshotPromptRequest
): Promise<ScreenshotPromptResult> => {
  const overlayResult = await executeScriptInTab<ScreenshotPromptChoice | null>(
    tab,
    (payload: ScreenshotPromptRequest) => {
      try {
        return new Promise<ScreenshotPromptChoice>((resolve) => {
          const rootId = "__vibesearch_screenshot_prompt__";
          const existing = document.getElementById(rootId);
          if (existing) existing.remove();

          const root = document.createElement("div");
          root.id = rootId;
          root.style.position = "fixed";
          root.style.top = "14px";
          root.style.right = "14px";
          root.style.zIndex = "2147483647";
          root.style.pointerEvents = "none";

          const panel = document.createElement("div");
          panel.style.pointerEvents = "auto";
          panel.style.maxWidth = "360px";
          panel.style.minWidth = "280px";
          panel.style.padding = "12px";
          panel.style.borderRadius = "12px";
          panel.style.border = "1px solid rgba(148, 163, 184, 0.5)";
          panel.style.background = "rgba(15, 23, 42, 0.95)";
          panel.style.color = "#f8fafc";
          panel.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
          panel.style.boxShadow = "0 18px 36px rgba(2, 6, 23, 0.45)";

          const heading = document.createElement("div");
          heading.textContent = payload.heading || "Capture screenshot";
          heading.style.fontSize = "14px";
          heading.style.fontWeight = "700";
          heading.style.marginBottom = "6px";

          const body = document.createElement("div");
          body.textContent = payload.body || "";
          body.style.fontSize = "12px";
          body.style.lineHeight = "1.4";
          body.style.opacity = "0.95";
          body.style.marginBottom = "10px";

          const normalizedActions = Array.isArray(payload.actions)
            ? payload.actions.filter((action) => !!action && typeof action.id === "string" && typeof action.label === "string")
            : [];
          if (normalizedActions.length === 0) {
            normalizedActions.push(
              { id: "full", label: "Full tab" },
              { id: "region", label: "Select area" },
              { id: "cancel", label: "Cancel" }
            );
          }
          const preferredConfirmChoice =
            normalizedActions.find((action) => action.id === "full")?.id ||
            normalizedActions.find((action) => action.id === "region")?.id ||
            normalizedActions[0]?.id ||
            "full";
          const cancelChoice =
            normalizedActions.find((action) => action.id === "cancel")?.id || preferredConfirmChoice;

          const actionRow = document.createElement("div");
          actionRow.style.display = "flex";
          actionRow.style.flexWrap = "wrap";
          actionRow.style.gap = "8px";
          actionRow.style.justifyContent = "flex-end";

          for (const action of normalizedActions) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = action.label;
            button.style.borderRadius = "8px";
            button.style.padding = "6px 10px";
            button.style.fontSize = "12px";
            button.style.fontWeight = action.id === preferredConfirmChoice ? "700" : "600";
            button.style.cursor = "pointer";
            if (action.id === "cancel") {
              button.style.border = "1px solid rgba(148, 163, 184, 0.55)";
              button.style.background = "transparent";
              button.style.color = "#e2e8f0";
            } else if (action.id === "region") {
              button.style.border = "1px solid rgba(34, 197, 94, 0.75)";
              button.style.background = "rgba(34, 197, 94, 0.18)";
              button.style.color = "#dcfce7";
            } else {
              button.style.border = "1px solid rgba(14, 165, 233, 0.8)";
              button.style.background = "#0ea5e9";
              button.style.color = "#082f49";
            }
            button.addEventListener("click", () => clear(action.id));
            actionRow.appendChild(button);
          }

          panel.appendChild(heading);
          panel.appendChild(body);
          panel.appendChild(actionRow);
          root.appendChild(panel);
          document.documentElement.appendChild(root);

          let settled = false;
          const clear = (choice: ScreenshotPromptChoice) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("keydown", onKeyDown, true);
            root.remove();
            resolve(choice);
          };
          const isTypingContext = () => {
            const active = document.activeElement as HTMLElement | null;
            if (!active) return false;
            const tag = active.tagName;
            return tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable;
          };
          const onKeyDown = (event: KeyboardEvent) => {
            if (isTypingContext()) return;
            if (event.key === "Escape") {
              event.preventDefault();
              clear(cancelChoice);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              clear(preferredConfirmChoice);
              return;
            }
            if (event.key.toLowerCase() === "f") {
              const fullChoice = normalizedActions.find((action) => action.id === "full")?.id;
              if (fullChoice) {
                event.preventDefault();
                clear(fullChoice);
              }
              return;
            }
            if (event.key.toLowerCase() === "r") {
              const regionChoice = normalizedActions.find((action) => action.id === "region")?.id;
              if (regionChoice) {
                event.preventDefault();
                clear(regionChoice);
              }
            }
          };
          window.addEventListener("keydown", onKeyDown, true);
        });
      } catch {
        return null;
      }
    },
    [request]
  );

  if (overlayResult === "full" || overlayResult === "region" || overlayResult === "cancel") {
    return { choice: overlayResult, method: "overlay" };
  }

  const fallbackAction = pickPromptFallbackAction(request);
  const fallbackLabel = fallbackAction === "region" ? "Select area" : "Capture full tab";
  const confirmMessage = [request.heading, "", request.body, "", `OK = ${fallbackLabel}, Cancel = Skip`].join("\n");
  const confirmResult = await executeScriptInTab<boolean>(
    tab,
    (text: string) => window.confirm(text),
    [confirmMessage]
  );
  if (confirmResult !== null) {
    return { choice: confirmResult ? fallbackAction : "cancel", method: "confirm" };
  }

  return { choice: "full", method: "fallback-auto" };
};

const selectScreenshotRegion = async (
  tab: chrome.tabs.Tab | undefined
): Promise<ScreenshotRegionSelectionResult> => {
  const result = await executeScriptInTab<ScreenshotRegionSelectionResult | null>(
    tab,
    () => {
      try {
        return new Promise<ScreenshotRegionSelectionResult>((resolve) => {
          const rootId = "__vibesearch_region_selector__";
          const existing = document.getElementById(rootId);
          if (existing) existing.remove();

          const clamp = (value: number, min: number, max: number) => {
            if (Number.isNaN(value)) return min;
            return Math.min(max, Math.max(min, value));
          };

          const viewportWidth = Math.max(1, Math.floor(window.innerWidth || document.documentElement.clientWidth || 1));
          const viewportHeight = Math.max(1, Math.floor(window.innerHeight || document.documentElement.clientHeight || 1));
          const minimumSize = 12;

          const root = document.createElement("div");
          root.id = rootId;
          root.style.position = "fixed";
          root.style.inset = "0";
          root.style.zIndex = "2147483647";
          root.style.cursor = "crosshair";
          root.style.userSelect = "none";
          root.style.background = "rgba(2, 6, 23, 0.30)";
          root.style.pointerEvents = "auto";

          const marquee = document.createElement("div");
          marquee.style.position = "fixed";
          marquee.style.border = "2px solid rgba(34, 197, 94, 0.95)";
          marquee.style.background = "rgba(34, 197, 94, 0.16)";
          marquee.style.boxShadow = "0 0 0 99999px rgba(2, 6, 23, 0.35)";
          marquee.style.pointerEvents = "none";
          marquee.style.display = "none";
          root.appendChild(marquee);

          const panel = document.createElement("div");
          panel.style.position = "fixed";
          panel.style.top = "14px";
          panel.style.left = "50%";
          panel.style.transform = "translateX(-50%)";
          panel.style.maxWidth = "560px";
          panel.style.padding = "12px 14px";
          panel.style.borderRadius = "12px";
          panel.style.border = "1px solid rgba(148, 163, 184, 0.55)";
          panel.style.background = "rgba(15, 23, 42, 0.96)";
          panel.style.color = "#f8fafc";
          panel.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
          panel.style.boxShadow = "0 18px 36px rgba(2, 6, 23, 0.45)";
          panel.style.pointerEvents = "auto";

          const heading = document.createElement("div");
          heading.textContent = "Select screenshot area";
          heading.style.fontSize = "14px";
          heading.style.fontWeight = "700";
          heading.style.marginBottom = "4px";

          const hint = document.createElement("div");
          hint.textContent = "Drag to draw a selection. Press Enter to confirm, Esc to cancel.";
          hint.style.fontSize = "12px";
          hint.style.opacity = "0.9";
          hint.style.marginBottom = "8px";

          const sizeText = document.createElement("div");
          sizeText.textContent = "Selection: none";
          sizeText.style.fontSize = "12px";
          sizeText.style.marginBottom = "10px";
          sizeText.style.opacity = "0.92";

          const actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.justifyContent = "flex-end";
          actions.style.gap = "8px";

          const cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.textContent = "Cancel";
          cancelButton.style.border = "1px solid rgba(148, 163, 184, 0.55)";
          cancelButton.style.borderRadius = "8px";
          cancelButton.style.padding = "6px 10px";
          cancelButton.style.background = "transparent";
          cancelButton.style.color = "#e2e8f0";
          cancelButton.style.fontSize = "12px";
          cancelButton.style.fontWeight = "600";
          cancelButton.style.cursor = "pointer";

          const applyButton = document.createElement("button");
          applyButton.type = "button";
          applyButton.textContent = "Use selection";
          applyButton.style.border = "1px solid rgba(34, 197, 94, 0.8)";
          applyButton.style.borderRadius = "8px";
          applyButton.style.padding = "6px 10px";
          applyButton.style.background = "rgba(34, 197, 94, 0.2)";
          applyButton.style.color = "#dcfce7";
          applyButton.style.fontSize = "12px";
          applyButton.style.fontWeight = "700";
          applyButton.style.cursor = "pointer";
          applyButton.disabled = true;
          applyButton.style.opacity = "0.5";

          actions.appendChild(cancelButton);
          actions.appendChild(applyButton);
          panel.appendChild(heading);
          panel.appendChild(hint);
          panel.appendChild(sizeText);
          panel.appendChild(actions);
          root.appendChild(panel);
          document.documentElement.appendChild(root);

          let isDragging = false;
          let startX = 0;
          let startY = 0;
          let currentRect: { x: number; y: number; width: number; height: number } | null = null;
          let settled = false;

          const hasValidSelection = () =>
            !!currentRect && currentRect.width >= minimumSize && currentRect.height >= minimumSize;
          const refreshUi = () => {
            const valid = hasValidSelection();
            applyButton.disabled = !valid;
            applyButton.style.opacity = valid ? "1" : "0.5";
            if (!currentRect || currentRect.width <= 0 || currentRect.height <= 0) {
              sizeText.textContent = "Selection: none";
              marquee.style.display = "none";
              return;
            }
            sizeText.textContent = `Selection: ${Math.round(currentRect.width)} x ${Math.round(currentRect.height)} px`;
            marquee.style.display = "block";
            marquee.style.left = `${currentRect.x}px`;
            marquee.style.top = `${currentRect.y}px`;
            marquee.style.width = `${currentRect.width}px`;
            marquee.style.height = `${currentRect.height}px`;
          };
          const setRect = (sx: number, sy: number, ex: number, ey: number) => {
            const x1 = clamp(sx, 0, viewportWidth);
            const y1 = clamp(sy, 0, viewportHeight);
            const x2 = clamp(ex, 0, viewportWidth);
            const y2 = clamp(ey, 0, viewportHeight);
            currentRect = {
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            };
            refreshUi();
          };
          const cleanup = () => {
            window.removeEventListener("mousemove", onMouseMove, true);
            window.removeEventListener("mouseup", onMouseUp, true);
            window.removeEventListener("keydown", onKeyDown, true);
            root.remove();
          };
          const settle = (result: ScreenshotRegionSelectionResult) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
          };
          const onMouseMove = (event: MouseEvent) => {
            if (!isDragging) return;
            event.preventDefault();
            setRect(startX, startY, event.clientX, event.clientY);
          };
          const onMouseUp = (event: MouseEvent) => {
            if (!isDragging) return;
            event.preventDefault();
            isDragging = false;
            setRect(startX, startY, event.clientX, event.clientY);
          };
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
              event.preventDefault();
              settle({ status: "cancelled" });
              return;
            }
            if (event.key === "Enter" && hasValidSelection()) {
              event.preventDefault();
              settle({
                status: "selected",
                selection: {
                  x: currentRect!.x,
                  y: currentRect!.y,
                  width: currentRect!.width,
                  height: currentRect!.height,
                  viewportWidth,
                  viewportHeight,
                },
              });
            }
          };

          root.addEventListener(
            "mousedown",
            (event) => {
              if (event.button !== 0) return;
              const target = event.target as Node | null;
              if (target && panel.contains(target)) return;
              event.preventDefault();
              isDragging = true;
              startX = clamp(event.clientX, 0, viewportWidth);
              startY = clamp(event.clientY, 0, viewportHeight);
              setRect(startX, startY, startX, startY);
            },
            true
          );
          window.addEventListener("mousemove", onMouseMove, true);
          window.addEventListener("mouseup", onMouseUp, true);
          window.addEventListener("keydown", onKeyDown, true);
          cancelButton.addEventListener("click", (event) => {
            event.preventDefault();
            settle({ status: "cancelled" });
          });
          applyButton.addEventListener("click", (event) => {
            event.preventDefault();
            if (!hasValidSelection()) return;
            settle({
              status: "selected",
              selection: {
                x: currentRect!.x,
                y: currentRect!.y,
                width: currentRect!.width,
                height: currentRect!.height,
                viewportWidth,
                viewportHeight,
              },
            });
          });
          refreshUi();
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

const wait = async (ms: number) =>
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForScreenshotPromptSettle = async (promptResult: ScreenshotPromptResult) => {
  const delayMs =
    promptResult.method === "fallback-auto"
      ? SCREENSHOT_CAPTURE_FALLBACK_DELAY_MS
      : SCREENSHOT_CAPTURE_PROMPT_SETTLE_DELAY_MS;
  await wait(delayMs);
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

const captureScreenshotMedia = async (
  context: ImportClickContext,
  tab: chrome.tabs.Tab | undefined,
  job: { id: string; label: string }
): Promise<{ media?: ItemDocType["media"]; displayImageUrl?: string }> => {
  const initialPrompt = await promptScreenshotCapture(
    tab,
    {
      heading: "Capture screenshot",
      body: "Choose capture mode: full tab or selected area. Press Enter for full tab or Esc to cancel.",
      actions: [
        { id: "full", label: "Full tab" },
        { id: "region", label: "Select area" },
        { id: "cancel", label: "Cancel" },
      ],
      fallbackConfirmAction: "full",
    }
  );
  if (initialPrompt.choice === "cancel") {
    throw new ImportCancelledError("Screenshot capture cancelled.");
  }
  let captureChoice: Exclude<ScreenshotPromptChoice, "cancel"> =
    initialPrompt.choice === "region" ? "region" : "full";
  if (initialPrompt.method === "fallback-auto") {
    sendProcessStatus(
      job.id,
      job.label,
      "processing",
      "Capture prompt unavailable here. Using full-tab capture."
    );
  }
  await waitForScreenshotPromptSettle(initialPrompt);

  const uploads: string[] = [];
  let sequence = 0;
  while (sequence < MAX_SCREENSHOT_IMAGES_PER_ITEM) {
    let regionSelection: ScreenshotRegionSelection | undefined;
    if (captureChoice === "region") {
      if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
        sendProcessStatus(
          job.id,
          job.label,
          "processing",
          "Area crop is not available in this browser context. Capturing full tab instead."
        );
        captureChoice = "full";
      }
    }
    if (captureChoice === "region") {
      sendProcessStatus(job.id, job.label, "processing", "Select an area to capture...");
      const regionResult = await selectScreenshotRegion(tab);
      if (regionResult.status === "cancelled") {
        if (sequence === 0) {
          throw new ImportCancelledError("Screenshot area selection cancelled.");
        }
        break;
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
        captureChoice = "full";
      }
    }

    sendProcessStatus(
      job.id,
      job.label,
      "processing",
      sequence === 0 ? "Capturing screenshot..." : `Capturing screenshot ${sequence + 1}...`
    );
    let upload: MediaUploadResponse;
    try {
      upload = await uploadScreenshot(
        context,
        tab,
        sequence,
        regionSelection,
        async () => {
          sendProcessStatus(
            job.id,
            job.label,
            "processing",
            sequence === 0
              ? "Screenshot captured. Uploading..."
              : `Screenshot ${sequence + 1} captured. Uploading...`
          );
          await showCaptureToastInTab(
            tab,
            sequence === 0 ? "Screenshot captured. Uploading..." : `Screenshot ${sequence + 1} captured.`,
            "success"
          );
        }
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Screenshot capture failed.";
      await showCaptureToastInTab(tab, detail, "error");
      throw error;
    }
    if (upload.url) {
      uploads.push(upload.url);
      sendProcessStatus(
        job.id,
        job.label,
        "processing",
        sequence === 0 ? "Screenshot uploaded." : `Screenshot ${sequence + 1} uploaded.`
      );
    }
    sequence += 1;

    if (sequence >= MAX_SCREENSHOT_IMAGES_PER_ITEM) {
      break;
    }
    const continuePrompt = await promptScreenshotCapture(
      tab,
      {
        heading: "Screenshot saved",
        body: "Capture another screenshot for the same item?",
        actions: [
          { id: "full", label: "Full tab" },
          { id: "region", label: "Select area" },
          { id: "cancel", label: "Finish" },
        ],
        fallbackConfirmAction: "full",
      }
    );
    if (continuePrompt.choice === "cancel") {
      break;
    }
    captureChoice = continuePrompt.choice === "region" ? "region" : "full";
    if (continuePrompt.method === "fallback-auto") {
      sendProcessStatus(
        job.id,
        job.label,
        "processing",
        "Capture prompt unavailable here. Using full-tab capture for next screenshot."
      );
    }
    await waitForScreenshotPromptSettle(continuePrompt);
  }

  if (uploads.length === 0) {
    throw new Error("Screenshot upload failed. Nothing was captured.");
  }
  sendProcessStatus(
    job.id,
    job.label,
    "processing",
    uploads.length === 1 ? "1 screenshot attached to import." : `${uploads.length} screenshots attached to import.`
  );
  await showCaptureToastInTab(
    tab,
    uploads.length === 1
      ? "Screenshot saved to import."
      : `${uploads.length} screenshots saved to import.`,
    "success"
  );

  const sourcePage = context.pageUrl || context.tabUrl || "screenshot";
  const media: ItemDocType["media"] = uploads.map((url, index) => ({
    type: "image",
    originalUrl: `${sourcePage}#screenshot-${index + 1}`,
    storageType: "s3",
    s3Url: url,
    pageUrl: context.pageUrl || context.tabUrl || undefined,
    pageTitle: context.tabTitle || undefined,
    faviconUrl: context.tabFavIconUrl || undefined,
    capturedAt: context.capturedAt + index,
  }));
  return {
    media,
    displayImageUrl: uploads[0],
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
    const screenshot = await captureScreenshotMedia(context, tab, job);
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
  const primaryUrl = resolved.url;
  const source = inferSource(primaryUrl);
  let media: ItemDocType["media"] | undefined;
  let displayImageUrl: string | undefined;
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

  return {
    primaryUrl,
    title: createTitle(context, target.mode, primaryUrl),
    textContent: contextText(context, target.mode),
    source,
    iconUrl: context.tabFavIconUrl || undefined,
    displayImageUrl,
    media,
    tags: suggestedTags(context, source),
    shouldFetchMetadata: !resolved.synthetic,
    isMetaFetched: resolved.synthetic,
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

    await add({ id: MENU_ROOT_ID, title: "Save to VibeSearch", contexts: IMPORT_CONTEXTS });
    await add({ id: MENU_QUICK_SAVE_ID, parentId: MENU_ROOT_ID, title: "Quick save (Public, auto folder)", contexts: IMPORT_CONTEXTS });
    await add({ id: MENU_QUICK_SHOT_ID, parentId: MENU_ROOT_ID, title: "Capture page screenshot (Public, auto folder)", contexts: IMPORT_CONTEXTS });
    await add({ id: `${MENU_ROOT_ID}:sep:1`, parentId: MENU_ROOT_ID, type: "separator", contexts: IMPORT_CONTEXTS });
    await add({ id: MENU_SAVE_TARGETS_ID, parentId: MENU_ROOT_ID, title: "Save content to…", contexts: IMPORT_CONTEXTS });
    await add({ id: MENU_SHOT_TARGETS_ID, parentId: MENU_ROOT_ID, title: "Capture screenshot to…", contexts: IMPORT_CONTEXTS });

    const spaces = await loadImportTargets();
    for (const mode of ["save", "shot"] as ImportMode[]) {
      const root = mode === "save" ? MENU_SAVE_TARGETS_ID : MENU_SHOT_TARGETS_ID;
      for (const space of spaces) {
        const spaceNodeId = `vs:node:${mode}:space:${space.id}`;
        await add({
          id: spaceNodeId,
          parentId: root,
          title: trimText(space.isPrivate && !space.isUnlocked ? `${space.name} (locked)` : space.name, 60),
          contexts: IMPORT_CONTEXTS,
          enabled: true,
        });
        if (!space.isUnlocked) {
          await add({
            id: `vs:${mode}:space:${space.id}`,
            parentId: spaceNodeId,
            title:
              mode === "save"
                ? "Save in this locked space (new folder)"
                : "Screenshot in this locked space (new folder)",
            contexts: IMPORT_CONTEXTS,
          });
          continue;
        }
        await add({
          id: `vs:${mode}:space:${space.id}`,
          parentId: spaceNodeId,
          title: mode === "save" ? "Save in this space (new folder)" : "Screenshot in this space (new folder)",
          contexts: IMPORT_CONTEXTS,
        });
        for (const folder of space.folders.slice(0, MENU_MAX_FOLDERS)) {
          const folderNodeId = `vs:node:${mode}:folder:${space.id}:${folder.id}`;
          await add({ id: folderNodeId, parentId: spaceNodeId, title: trimText(folder.name || "Untitled folder", 60), contexts: IMPORT_CONTEXTS });
          await add({
            id: `vs:${mode}:folder:${folder.id}`,
            parentId: folderNodeId,
            title: mode === "save" ? "Save in this folder" : "Screenshot in this folder",
            contexts: IMPORT_CONTEXTS,
          });
          for (const item of folder.recentItems.slice(0, MENU_MAX_ITEMS)) {
            await add({
              id: `vs:${mode}:item:${folder.id}:${item.id}`,
              parentId: folderNodeId,
              title: trimText(`Attach under: ${item.title}`, 60),
              contexts: IMPORT_CONTEXTS,
            });
          }
        }
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
    await runImportAction(attempt.target, attempt.context, retryTab);
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
    if (menuId === MENU_QUICK_SAVE_ID) {
      attemptedTarget = { mode: "save", spaceId: PUBLIC_SPACE_ID };
      await runImportAction(attemptedTarget, context, tab);
      return;
    }
    if (menuId === MENU_QUICK_SHOT_ID) {
      attemptedTarget = { mode: "shot", spaceId: PUBLIC_SPACE_ID };
      await runImportAction(attemptedTarget, context, tab);
      return;
    }
    const target = parseTargetFromMenuId(menuId);
    if (target) {
      attemptedTarget = target;
      await runImportAction(target, context, tab);
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
