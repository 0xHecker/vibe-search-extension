const MEDIA_DIR = "media";

const getMediaDir = async () => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MEDIA_DIR, { create: true });
};

const getItemDir = async (itemId: string) => {
  const mediaDir = await getMediaDir();
  return mediaDir.getDirectoryHandle(itemId, { create: true });
};

const getFileHandleFromOpfsPath = async (
  opfsPath: string
): Promise<FileSystemFileHandle | null> => {
  const parts = opfsPath.split("/").filter(Boolean);
  if (parts.length < 3) return null;

  const fileName = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  const root = await navigator.storage.getDirectory();
  let dir: FileSystemDirectoryHandle = root;

  for (const part of dirParts) {
    dir = await dir.getDirectoryHandle(part);
  }

  return dir.getFileHandle(fileName);
};

export const saveMediaToOpfs = async (
  itemId: string,
  file: File,
  fileName?: string
): Promise<{ opfsPath: string; size: number }> => {
  const itemDir = await getItemDir(itemId);
  const safeName =
    fileName ||
    `${crypto.randomUUID()}.${file.name.split(".").pop() || "bin"}`;
  const fileHandle = await itemDir.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();

  const opfsPath = `${MEDIA_DIR}/${itemId}/${safeName}`;

  // The saved file is already addressable by opfsPath. Creating a blob URL here
  // would retain a duplicate in memory without a consumer to release it.
  return { opfsPath, size: file.size };
};

export const isObjectUrl = (url: string | null | undefined): url is string =>
  typeof url === "string" && url.startsWith("blob:");

export const revokeObjectUrl = (url: string | null | undefined): void => {
  if (!isObjectUrl(url)) return;
  URL.revokeObjectURL(url);
};

export const resolveOpfsMedia = async (
  opfsPath: string
): Promise<string | null> => {
  try {
    const fileHandle = await getFileHandleFromOpfsPath(opfsPath);
    if (!fileHandle) return null;
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
};

export const deleteMediaFromOpfs = async (opfsPath: string): Promise<void> => {
  try {
    const parts = opfsPath.split("/");
    if (parts.length < 3) return;
    const root = await navigator.storage.getDirectory();
    const dirPath = parts.slice(0, -1);
    const fileName = parts[parts.length - 1];
    let dir: FileSystemDirectoryHandle = root;
    for (const part of dirPath) {
      dir = await dir.getDirectoryHandle(part);
    }
    await dir.removeEntry(fileName);
  } catch {
    // File may not exist; ignore
  }
};

export const deleteAllMediaForItem = async (itemId: string): Promise<void> => {
  try {
    const mediaDir = await getMediaDir();
    await mediaDir.removeEntry(itemId, { recursive: true });
  } catch {
    // Directory may not exist; ignore
  }
};

export const isGifUrl = (url: string): boolean => {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".gif");
  } catch {
    return url.toLowerCase().endsWith(".gif");
  }
};

export const inferMediaType = (
  url: string,
  file?: File
): "image" | "video" => {
  if (file) {
    if (file.type.startsWith("video/")) return "video";
    return "image";
  }
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (
      path.endsWith(".mp4") ||
      path.endsWith(".webm") ||
      path.endsWith(".mov") ||
      path.endsWith(".avi") ||
      path.endsWith(".mkv")
    ) {
      return "video";
    }
  } catch {
    if (
      url.toLowerCase().endsWith(".mp4") ||
      url.toLowerCase().endsWith(".webm") ||
      url.toLowerCase().endsWith(".mov")
    ) {
      return "video";
    }
  }
  return "image";
};

export const MEDIA_LIMITS = {
  image: 5,
  gif: 5,
  video: 4,
} as const;

export type MediaCategory = "image" | "gif" | "video";

export const categorizeMedia = (
  entry: { type: string; originalUrl: string }
): MediaCategory => {
  if (entry.type === "video") return "video";
  if (isGifUrl(entry.originalUrl)) return "gif";
  return "image";
};

export const getMediaCounts = (
  media: Array<{ type: string; originalUrl: string }>
): { image: number; gif: number; video: number } => {
  const counts = { image: 0, gif: 0, video: 0 };
  for (const entry of media) {
    counts[categorizeMedia(entry)]++;
  }
  return counts;
};

export const canAddMedia = (
  media: Array<{ type: string; originalUrl: string }>,
  category: MediaCategory
): boolean => {
  const counts = getMediaCounts(media);
  return counts[category] < MEDIA_LIMITS[category];
};

// --- R2 promotion ---

const METADATA_WORKER_BASE_URL = "https://metadata-worker.watermelons.workers.dev";
const IMPORT_MEDIA_ENDPOINT = `${METADATA_WORKER_BASE_URL}/import-media`;
const IMPORT_MEDIA_UPLOAD_TOKEN = import.meta.env.VITE_IMPORT_MEDIA_UPLOAD_TOKEN?.trim() || "";
const IMPORT_MEDIA_UPLOAD_RETRIES = 2;
const IMPORT_MEDIA_UPLOAD_TIMEOUT_MS = 45_000;
const IMPORT_MEDIA_RETRY_BASE_DELAY_MS = 350;

type MediaUploadResponse = { url?: string | null; key?: string; error?: string };
type UploadedMedia = { r2Url: string; key?: string };

const buildImportUploadHeaders = (contentType: string): Headers => {
  if (!IMPORT_MEDIA_UPLOAD_TOKEN) {
    throw new Error("IMPORT_MEDIA_UPLOAD_TOKEN_MISSING");
  }

  const headers = new Headers({ "Content-Type": contentType });
  headers.set("X-VS-Import-Token", IMPORT_MEDIA_UPLOAD_TOKEN);
  return headers;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cloneArrayBuffer = (buffer: ArrayBuffer): ArrayBuffer =>
  buffer.slice(0);

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;

const describeUploadError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return `request timed out after ${IMPORT_MEDIA_UPLOAD_TIMEOUT_MS / 1000}s`;
  }
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return "network request failed";
  }
  return error instanceof Error ? error.message : String(error);
};

const fetchWithTimeout = async (endpoint: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_MEDIA_UPLOAD_TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      credentials: "omit",
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const postImportMedia = async (
  initFactory: () => RequestInit,
  label: string
): Promise<MediaUploadResponse> => {
  let lastError = "";
  for (let attempt = 0; attempt <= IMPORT_MEDIA_UPLOAD_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(IMPORT_MEDIA_ENDPOINT, initFactory());
      const payload = (await response.json().catch(() => ({}))) as MediaUploadResponse;
      if (response.ok) return payload;

      lastError = payload.error || `${label} failed (${response.status})`;
      if (!isRetryableStatus(response.status)) break;
    } catch (error) {
      lastError = describeUploadError(error);
    }

    if (attempt < IMPORT_MEDIA_UPLOAD_RETRIES) {
      await wait(IMPORT_MEDIA_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new Error(`${label} failed after ${IMPORT_MEDIA_UPLOAD_RETRIES + 1} attempts: ${lastError || "unknown error"}`);
};

const resolveUploadedMediaUrl = (payload: MediaUploadResponse): string | null => {
  if (payload.key) return `${METADATA_WORKER_BASE_URL}/r2/${encodeURIComponent(payload.key)}`;
  return payload.url || null;
};

const resolveUploadedMedia = (payload: MediaUploadResponse): UploadedMedia | null => {
  const r2Url = resolveUploadedMediaUrl(payload);
  if (!r2Url) return null;
  return { r2Url, key: payload.key };
};

export const readOpfsFile = async (opfsPath: string): Promise<File | null> => {
  try {
    const fileHandle = await getFileHandleFromOpfsPath(opfsPath);
    if (!fileHandle) return null;
    return await fileHandle.getFile();
  } catch {
    return null;
  }
};

export const uploadOpfsFileToR2 = async (
  opfsPath: string,
  fileName?: string
): Promise<UploadedMedia | null> => {
  const file = await readOpfsFile(opfsPath);
  if (!file) return null;

  return uploadBlobToR2(file, fileName || file.name);
};

export const uploadBlobToR2 = async (
  blob: Blob,
  fileName?: string,
  options?: { sourcePageUrl?: string | null; label?: string }
): Promise<UploadedMedia | null> => {
  if (blob.size <= 0) throw new Error("IMPORT_MEDIA_EMPTY_FILE");

  const contentType = blob.type || "application/octet-stream";
  const body = await blob.arrayBuffer();
  const payload = await postImportMedia(
    () => {
      const headers = buildImportUploadHeaders(contentType);
      if (fileName) headers.set("X-VS-File-Name", fileName);
      if (options?.sourcePageUrl) headers.set("X-VS-Source-Url", options.sourcePageUrl);
      return { method: "POST", headers, body: cloneArrayBuffer(body) };
    },
    options?.label || "Media upload"
  );
  return resolveUploadedMedia(payload);
};

export const uploadRemoteMediaToR2 = async (
  remoteUrl: string,
  sourcePageUrl?: string | null
): Promise<UploadedMedia | null> => {
  const body = JSON.stringify({ remoteUrl, sourcePageUrl: sourcePageUrl || remoteUrl });
  const payload = await postImportMedia(
    () => ({
      method: "POST",
      headers: buildImportUploadHeaders("application/json"),
      body,
    }),
    "Remote media upload"
  );
  return resolveUploadedMedia(payload);
};
