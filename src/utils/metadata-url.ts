const DIRECT_RESOURCE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "tif",
  "tiff",
  "heic",
  "heif",
  "ico",
  "mp4",
  "webm",
  "mov",
  "m4v",
  "mkv",
  "avi",
  "m3u8",
  "mp3",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "flac",
  "opus",
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "rar",
  "wasm",
  "onnx",
]);

const parseHttpUrl = (value: string | null | undefined): URL | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
};

const extensionFromPathname = (pathname: string): string => {
  const lastSegment = pathname.split("/").filter(Boolean).pop() || "";
  const decoded = (() => {
    try {
      return decodeURIComponent(lastSegment);
    } catch {
      return lastSegment;
    }
  })();
  const match = /\.([a-z0-9]{2,8})$/i.exec(decoded);
  return match?.[1]?.toLowerCase() || "";
};

export const isLikelyDirectResourceUrl = (value: string | null | undefined): boolean => {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  return DIRECT_RESOURCE_EXTENSIONS.has(extensionFromPathname(parsed.pathname));
};

export const isMetadataFetchableUrl = (
  value: string | null | undefined,
  options: { blockedHosts?: string[] } = {}
): boolean => {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  const blockedHosts = new Set((options.blockedHosts || []).map((host) => host.toLowerCase()));
  if (blockedHosts.has(parsed.hostname.toLowerCase())) return false;
  return !isLikelyDirectResourceUrl(parsed.toString());
};

export const filterMetadataFetchableUrls = (
  urls: string[],
  options: { blockedHosts?: string[] } = {}
): string[] => urls.filter((url) => isMetadataFetchableUrl(url, options));
