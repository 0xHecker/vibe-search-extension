import { ItemDocType } from "@src/schemas/item_schema";
import { setupOffscreenDocument } from "@src/services/offscreen-helper";
import {
  DEFAULT_METADATA_PREFERENCES,
  getPreferencesForHost,
  pickImageField,
  pickStringField,
} from "@src/utils/metadataPreferences";

// --- URL Normalization & Helpers ---

const META_PREFIX = "https://meta.vibesearch.app/?url=";

function maybeDecode(raw: string): string {
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.includes("://") ? decoded : raw;
  } catch {
    return raw;
  }
}

function normalizeIncomingUrls(input: unknown): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    const trimmed = u.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("chrome://") || trimmed.startsWith("chrome-extension://")) return;
    if (trimmed.startsWith(META_PREFIX)) {
      const after = trimmed.slice(META_PREFIX.length);
      const beforeAmp = after.split("&")[0];
      const rawParts = beforeAmp.split(",");
      for (const part of rawParts) add(maybeDecode(part));
      return;
    }
    if (/%[0-9a-fA-F]{2}/.test(trimmed)) {
      const decoded = maybeDecode(trimmed);
      out.push(decoded);
      return;
    }
    if (trimmed.includes(",") && countSubstr(trimmed, "://") > 1) {
      const parts = trimmed.split(",").map((s) => s.trim());
      for (const p of parts) {
        if (p.includes("://")) add(p);
      }
      return;
    }
    out.push(trimmed);
  };

  if (Array.isArray(input)) {
    for (const u of input) if (typeof u === "string") add(u);
  } else if (typeof input === "string") {
    add(input);
  }
  return Array.from(new Set(out));
}

function countSubstr(haystack: string, needle: string): number {
  let count = 0,
    idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// --- Core Fetching Logic ---

type FetchResult = {
  metadata: Record<string, Partial<ItemDocType>>;
  successfulUrls: Set<string>; // URLs that got a successful API response (even if empty metadata)
  failedUrls: Set<string>; // URLs that failed due to 4xx/5xx or network errors
};

const fetchMetadataForUrls = async (urls: string[], revalidate = false): Promise<FetchResult> => {
  const result: FetchResult = {
    metadata: {},
    successfulUrls: new Set(),
    failedUrls: new Set(),
  };

  if (urls.length === 0) return result;

  const chunk = <T>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const safeUrls = normalizeIncomingUrls(urls);
  const batches = chunk(safeUrls, 5); // Match BATCH_SIZE

  for (const group of batches) {
    try {
      const query = group.map((u) => `url=${encodeURIComponent(u)}`).join("&");
      let endpoint = `https://meta.vibesearch.app/?${query}`;
      if (revalidate) {
        endpoint += "&re=1";
      }
      const res = await fetch(endpoint, { method: "GET" as const });
      if (!res.ok) {
        // API returned 4xx/5xx - mark all URLs in this batch as failed
        console.warn(`Metadata API returned ${res.status} for batch:`, group);
        for (const url of group) {
          result.failedUrls.add(url);
        }
        continue;
      }
      const arr = (await res.json()) as any[];
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          const entry = arr[i] ?? {};
          const inputUrl = group[i];
          const key = inputUrl || entry.url;
          if (!key) continue;

          // Mark as successful - we got a response for this URL
          result.successfulUrls.add(key);

          // Map fields using preferences
          let hostname: string | null = null;
          try {
            hostname = new URL(key).hostname;
          } catch {
            hostname = null;
          }
          const domainPrefs = hostname ? getPreferencesForHost(hostname) : {};
          const titleFields = domainPrefs.title || DEFAULT_METADATA_PREFERENCES.title;
          const descriptionFields =
            domainPrefs.description || DEFAULT_METADATA_PREFERENCES.description;
          const imageFields = domainPrefs.image || DEFAULT_METADATA_PREFERENCES.image;

          const title = pickStringField(entry, titleFields);
          const description = pickStringField(entry, descriptionFields);
          let favicon = entry.favicon as string | undefined;
          if (favicon && typeof favicon === "string") {
            if (favicon.startsWith("//")) {
              favicon = `https:${favicon}`;
            } else if (favicon.startsWith("/")) {
              try {
                const origin = new URL(key).origin;
                favicon = origin + favicon;
              } catch {}
            } else if (!favicon.includes("://")) {
              try {
                favicon = new URL(favicon, key).toString();
              } catch {}
            }
          }
          let displayImageUrl = pickImageField(entry, imageFields);
          if (displayImageUrl && typeof displayImageUrl === "string") {
            if (displayImageUrl.startsWith("//")) {
              displayImageUrl = `https:${displayImageUrl}`;
            } else if (displayImageUrl.startsWith("/")) {
              try {
                const origin = new URL(key).origin;
                displayImageUrl = origin + displayImageUrl;
              } catch {}
            } else if (!displayImageUrl.includes("://")) {
              try {
                displayImageUrl = new URL(displayImageUrl, key).toString();
              } catch {}
            }
          }

          const validSources = [
            "web",
            "twitter",
            "reddit",
            "note",
            "youtube",
            "instagram",
            "tiktok",
            "substack",
            "linkedin",
            "github",
            "article",
          ];
          const source = validSources.includes(entry.ogType) ? entry.ogType : "web";

          const mapped: Partial<ItemDocType> = {
            title: title,
            textContent: description,
            iconUrl: favicon,
            displayImageUrl: displayImageUrl,
            source: source as any,
            createdAt: entry.ogDate ? new Date(entry.ogDate).getTime() : undefined,
            updatedAt: entry.articleModifiedTime
              ? new Date(entry.articleModifiedTime).getTime()
              : undefined,
            authorUsername: entry.ogSiteName,
          } as Partial<ItemDocType>;

          result.metadata[key] = mapped;
          if (entry.url && entry.url !== key) {
            result.metadata[entry.url] = mapped;
            result.successfulUrls.add(entry.url);
          }
        }
      }
    } catch (e) {
      console.error("Error fetching metadata for group:", group, e);
      // Network error or parsing error - mark all URLs in this batch as failed
      for (const url of group) {
        result.failedUrls.add(url);
      }
    }
  }

  return result;
};

// --- Manual, Reliable Request Pipeline ---

type UrlStatus = "idle" | "queued" | "inflight" | "done" | "failed";
type UrlEntry = { status: UrlStatus; attempts: number; revalidate: boolean };
const urlState = new Map<string, UrlEntry>();

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF = [1000, 5000, 30000]; // ms
const CONCURRENCY = 4;
const BATCH_SIZE = 5;
const TICK_INTERVAL = 400; // ms

const queue: Array<{ url: string; revalidate: boolean }> = [];
let inflightCount = 0;
let batchTimeout: NodeJS.Timeout | null = null;
const batchBuffer: Array<{ url: string; revalidate: boolean }> = [];

const processQueue = () => {
  while (inflightCount < CONCURRENCY && queue.length > 0) {
    inflightCount++;
    const batchToProcess = queue.splice(0, BATCH_SIZE);
    fetchAndProcessBatch(batchToProcess).finally(() => {
      inflightCount--;
      processQueue();
    });
  }
};

const fetchAndProcessBatch = async (batch: Array<{ url: string; revalidate: boolean }>) => {
  const urls = batch.map((b) => b.url);
  const safeUrls = normalizeIncomingUrls(urls);
  if (safeUrls.length === 0) return;

  // Check if any URL in batch needs revalidation (force cache bypass)
  const shouldRevalidate = batch.some((b) => b.revalidate);

  // Mark inflight and increment attempts
  for (const url of safeUrls) {
    const state = urlState.get(url);
    if (!state) continue;
    state.status = "inflight";
    state.attempts++;
  }

  console.log(
    `[MetadataPipeline] Fetching ${safeUrls.length} URLs, revalidate=${shouldRevalidate}`
  );

  try {
    // Single request for up to BATCH_SIZE URLs, with revalidate flag for cache bypass
    const fetchResult = await fetchMetadataForUrls(safeUrls, shouldRevalidate);

    // Build payload only for URLs that got a successful API response
    const payloadMap: Record<string, Partial<ItemDocType>> = {};
    for (const url of safeUrls) {
      if (fetchResult.successfulUrls.has(url)) {
        // URL got a successful response - use metadata if available, otherwise just mark as fetched
        payloadMap[url] = fetchResult.metadata[url] || { isMetaFetched: true };
      }
      // For failed URLs, we don't add to payloadMap - they won't be marked as fetched
    }

    // Only send update if we have successful URLs
    if (Object.keys(payloadMap).length > 0) {
      await setupOffscreenDocument();
      await chrome.runtime.sendMessage({
        service: "items",
        type: "saveFetchedMetadata",
        target: "offscreen",
        isForwarded: true,
        payload: { metaMap: payloadMap },
      });
      console.log(`[MetadataPipeline] Saved metadata for ${Object.keys(payloadMap).length} URLs`);
    }

    // Mark successful URLs as done
    for (const url of fetchResult.successfulUrls) {
      const state = urlState.get(url);
      if (state) state.status = "done";
    }

    // Handle failed URLs - schedule for retry with backoff
    for (const url of fetchResult.failedUrls) {
      const state = urlState.get(url);
      if (!state) continue;
      if (state.attempts < MAX_ATTEMPTS) {
        const delay = RETRY_BACKOFF[state.attempts - 1];
        console.log(`[MetadataPipeline] Scheduling retry for ${url} in ${delay}ms`);
        setTimeout(() => {
          state.status = "queued";
          addUrlToPipeline(url, state.revalidate);
        }, delay);
      } else {
        state.status = "failed";
        console.warn(
          `[MetadataPipeline] Permanently failed for URL after ${MAX_ATTEMPTS} attempts:`,
          url
        );
      }
    }
  } catch (error) {
    // Complete failure (e.g., offscreen document issue) - retry all URLs
    console.error("[MetadataPipeline] Error in fetchAndProcessBatch:", error);
    for (const url of safeUrls) {
      const state = urlState.get(url);
      if (!state) continue;
      if (state.attempts < MAX_ATTEMPTS) {
        const delay = RETRY_BACKOFF[state.attempts - 1];
        setTimeout(() => {
          state.status = "queued";
          addUrlToPipeline(url, state.revalidate);
        }, delay);
      } else {
        state.status = "failed";
      }
    }
  }
};

const flushBatchBuffer = () => {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }
  if (batchBuffer.length > 0) {
    queue.push(...batchBuffer);
    batchBuffer.length = 0;
    processQueue();
  }
};

const addUrlToPipeline = (url: string, revalidate: boolean) => {
  batchBuffer.push({ url, revalidate });
  if (batchBuffer.length >= BATCH_SIZE) {
    flushBatchBuffer();
  } else if (!batchTimeout) {
    batchTimeout = setTimeout(flushBatchBuffer, TICK_INTERVAL);
  }
};

/**
 * Schedule URLs for metadata fetching.
 * @param urls - Array of URLs to fetch metadata for
 * @param forceRefresh - If true, bypasses cache and re-fetches even for already-fetched URLs
 */
export const scheduleForProcessing = (urls: string[], forceRefresh = false) => {
  const normalized = normalizeIncomingUrls(urls);
  if (normalized.length === 0) return;

  console.log(
    `[MetadataPipeline] Scheduling ${normalized.length} URLs, forceRefresh=${forceRefresh}`
  );

  for (const url of normalized) {
    const state = urlState.get(url);
    if (!state) {
      // New URL - add to pipeline
      urlState.set(url, { status: "queued", attempts: 0, revalidate: forceRefresh });
      addUrlToPipeline(url, forceRefresh);
    } else if (forceRefresh) {
      // Force refresh - reset state and requeue with cache bypass
      state.status = "queued";
      state.attempts = 0;
      state.revalidate = true;
      addUrlToPipeline(url, true);
    } else if (state.status === "failed") {
      // Retry failed URL
      state.status = "queued";
      state.attempts = 0;
      addUrlToPipeline(url, false);
    }
    // If state exists and is "done" or "queued" or "inflight", skip unless forceRefresh
  }
};
