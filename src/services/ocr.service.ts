import type { OcrResultItem } from "@paddleocr/paddleocr-js";
import type { ItemDocType } from "@src/schemas/item_schema";
import {
  METADATA_WORKER_BASE_URL,
  OCR_IMAGE_PROXY_URL,
  OCR_MODEL_BASE_URL,
  OCR_MODEL_CACHE,
  OCR_MODEL_VERSION,
  getLegacyOcrModelUrl,
  getOcrModelUrl,
  isDeprecatedOcrModelCacheUrl,
  resolveOcrModelRoleFromUrl,
} from "@src/services/ocr-model-config";

export { OCR_MODEL_VERSION } from "@src/services/ocr-model-config";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_LONG_SIDE = 1600;
const MIN_IMAGE_SIDE = 24;
const MAX_IMAGES_PER_ITEM = 3;
const MIN_LINE_SCORE = 0.45;
const MAX_OCR_TEXT_CHARS = 12000;

type ImageCandidate = {
  url: string;
  source: "display" | "s3" | "original";
  width?: number;
  height?: number;
  capturedAt?: number;
};

type ImageOcrResult = {
  lines: Array<{ text: string; score: number }>;
  width: number;
  height: number;
};

type SandboxOcrPayload = {
  image: { width?: number; height?: number };
  items: OcrResultItem[];
};

type SandboxMessage =
  | { target: "vibe-search-ocr-sandbox"; type: "ready" }
  | { target: "vibe-search-ocr-sandbox"; type: "response"; id: string; payload?: unknown; error?: string }
  | { target: "vibe-search-ocr-sandbox"; type: "modelFetch"; id: string; url: string };

type ParentMessage = {
  target: "vibe-search-ocr-parent";
  type: "runOcr" | "modelFetchResponse";
  id: string;
  payload?: unknown;
  error?: string;
};

export type ItemOcrResult = {
  status: "done" | "skipped" | "error";
  text: string;
  confidence?: number;
  lineCount: number;
  sourceHash: string;
  error?: string;
};

const normalizeWhitespace = (input: string): string =>
  input
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const isLikelyDirectFetchable = (value: string): boolean => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "metadata-worker.watermelons.workers.dev" ||
      hostname === "bucket.vibesearch.app" ||
      hostname === "preview-bucket.vibesearch.app"
    );
  } catch {
    return false;
  }
};

const getWorkerR2Url = (value: string): string | null => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "bucket.vibesearch.app" || hostname === "preview-bucket.vibesearch.app") {
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (key) return `${METADATA_WORKER_BASE_URL}/r2/${encodeURIComponent(key)}`;
    }
  } catch {}
  return null;
};

const blobFromCanvas = (canvas: HTMLCanvasElement, type: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode resized OCR image."));
      },
      type || "image/png",
      0.92
    );
  });

class OcrSandboxClient {
  private frame: HTMLIFrameElement | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly fetchModel: (url: string) => Promise<Response>) {
    window.addEventListener("message", this.handleMessage);
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async ensureReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      const timeout = window.setTimeout(() => {
        reject(new Error("OCR sandbox did not initialize."));
      }, 30_000);
      this.resolveReady = () => {
        window.clearTimeout(timeout);
        resolve();
      };
    });

    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("src/pages/ocr-sandbox/index.html");
    frame.style.display = "none";
    frame.setAttribute("aria-hidden", "true");
    this.frame = frame;
    document.body.appendChild(frame);
    return this.readyPromise;
  }

  private postToSandbox(message: ParentMessage, transfer: Transferable[] = []) {
    const target = this.frame?.contentWindow;
    if (!target) {
      throw new Error("OCR sandbox is not available.");
    }
    target.postMessage(message, "*", transfer);
  }

  private readonly handleMessage = (event: MessageEvent<SandboxMessage>) => {
    if (this.frame?.contentWindow && event.source !== this.frame.contentWindow) return;
    const message = event.data;
    if (!message || message.target !== "vibe-search-ocr-sandbox") return;

    if (message.type === "ready") {
      this.resolveReady?.();
      this.resolveReady = null;
      return;
    }

    if (message.type === "modelFetch") {
      void this.handleModelFetch(message);
      return;
    }

    if (message.type === "response") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.payload);
      }
    }
  };

  private async handleModelFetch(message: Extract<SandboxMessage, { type: "modelFetch" }>) {
    try {
      const response = await this.fetchModel(message.url);
      if (!response.ok) {
        throw new Error(`Model fetch failed: HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      this.postToSandbox(
        {
          target: "vibe-search-ocr-parent",
          type: "modelFetchResponse",
          id: message.id,
          payload: {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type") || "application/octet-stream",
            buffer,
          },
        },
        [buffer]
      );
    } catch (error) {
      this.postToSandbox({
        target: "vibe-search-ocr-parent",
        type: "modelFetchResponse",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async request<T>(type: ParentMessage["type"], payload: unknown, transfer: Transferable[] = []): Promise<T> {
    await this.ensureReady();
    const id = this.createId();
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("OCR sandbox request timed out."));
      }, 180_000);
      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        this.postToSandbox(
          {
            target: "vibe-search-ocr-parent",
            type,
            id,
            payload,
          },
          transfer
        );
      } catch (error) {
        window.clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  public async runOcr(
    blob: Blob,
    image: { width: number; height: number },
    params: Record<string, unknown>
  ): Promise<SandboxOcrPayload> {
    const buffer = await blob.arrayBuffer();
    return this.request<SandboxOcrPayload>(
      "runOcr",
      {
        imageBuffer: buffer,
        imageType: blob.type || "image/png",
        imageWidth: image.width,
        imageHeight: image.height,
        params,
      },
      [buffer]
    );
  }

  public async prepare(): Promise<void> {
    await this.ensureReady();
  }
}

class OcrService {
  private sandbox: OcrSandboxClient | null = null;
  private modelCacheCleanupPromise: Promise<void> | null = null;
  private consecutiveInitFailures = 0;
  private initCircuitOpenUntil = 0;
  private readonly INIT_CIRCUIT_OPEN_MS = 60_000;

  private async cleanupDeprecatedModelCacheKeys(cache: Cache): Promise<void> {
    if (!this.modelCacheCleanupPromise) {
      this.modelCacheCleanupPromise = cache
        .keys()
        .then((requests) =>
          Promise.all(
            requests
              .filter((request) => isDeprecatedOcrModelCacheUrl(request.url))
              .map((request) => cache.delete(request).catch(() => false))
          )
        )
        .then(() => undefined);
    }
    await this.modelCacheCleanupPromise;
  }

  private async fetchWithModelCache(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const modelRole = resolveOcrModelRoleFromUrl(request.url);
    if (request.method !== "GET" || !modelRole || !request.url.startsWith(OCR_MODEL_BASE_URL)) {
      return fetch(request);
    }

    if (typeof caches === "undefined") {
      return fetch(request);
    }

    const cache = await caches.open(OCR_MODEL_CACHE);
    await this.cleanupDeprecatedModelCacheKeys(cache);
    const cacheKey = getOcrModelUrl(modelRole);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.fetchModelWithFallback(request, modelRole);
    if (response.ok) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  }

  private async fetchModelWithFallback(request: Request, modelRole: "det" | "rec"): Promise<Response> {
    try {
      const response = await fetch(request);
      if (response.ok || !request.url.startsWith(OCR_MODEL_BASE_URL)) {
        return response;
      }
    } catch (error) {
      if (!request.url.startsWith(OCR_MODEL_BASE_URL)) throw error;
    }

    return fetch(getLegacyOcrModelUrl(modelRole), { credentials: "omit" });
  }

  private async initialize(): Promise<OcrSandboxClient> {
    if (this.sandbox) return this.sandbox;
    if (Date.now() < this.initCircuitOpenUntil) {
      const seconds = Math.ceil((this.initCircuitOpenUntil - Date.now()) / 1000);
      throw new Error(`OCR model temporarily unavailable. Retry in ${seconds}s.`);
    }
    try {
      const sandbox = new OcrSandboxClient(this.fetchWithModelCache.bind(this));
      this.sandbox = sandbox;
      await sandbox.prepare();
      this.consecutiveInitFailures = 0;
      this.initCircuitOpenUntil = 0;
      return sandbox;
    } catch (error) {
      this.sandbox = null;
      this.consecutiveInitFailures += 1;
      if (this.consecutiveInitFailures >= 2) {
        this.initCircuitOpenUntil = Date.now() + this.INIT_CIRCUIT_OPEN_MS;
      }
      throw error;
    }
  }

  private stableHash(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  public getImageCandidates(item: ItemDocType): ImageCandidate[] {
    const byUrl = new Map<string, ImageCandidate>();
    const add = (candidate: ImageCandidate | null) => {
      if (!candidate?.url || !isHttpUrl(candidate.url)) return;
      if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate);
    };

    add(item.displayImageUrl ? { url: item.displayImageUrl, source: "display" } : null);
    for (const entry of item.media || []) {
      if (entry?.type !== "image") continue;
      const meta = {
        width: entry.width,
        height: entry.height,
        capturedAt: entry.capturedAt,
      };
      add(entry.s3Url ? { url: entry.s3Url, source: "s3", ...meta } : null);
      add(entry.originalUrl ? { url: entry.originalUrl, source: "original", ...meta } : null);
    }

    return Array.from(byUrl.values()).slice(0, MAX_IMAGES_PER_ITEM);
  }

  public getSourceHash(item: ItemDocType): string {
    const parts = this.getImageCandidates(item).map((candidate) =>
      [
        candidate.source,
        candidate.url,
        candidate.width || "",
        candidate.height || "",
        candidate.capturedAt || "",
      ].join("|")
    );
    return this.stableHash([OCR_MODEL_VERSION, ...parts].join("\n"));
  }

  private getSourceHashForCandidates(candidates: ImageCandidate[]): string {
    const parts = candidates.map((candidate) =>
      [
        candidate.source,
        candidate.url,
        candidate.width || "",
        candidate.height || "",
        candidate.capturedAt || "",
      ].join("|")
    );
    return this.stableHash([OCR_MODEL_VERSION, ...parts].join("\n"));
  }

  private async fetchImageBlob(candidate: ImageCandidate): Promise<Blob> {
    const fetchDirect = async () => {
      const response = await fetch(candidate.url, { credentials: "omit" });
      return this.responseToImageBlob(response);
    };

    if (isLikelyDirectFetchable(candidate.url)) {
      try {
        return await fetchDirect();
      } catch {}
    }

    const workerR2Url = getWorkerR2Url(candidate.url);
    if (workerR2Url) {
      try {
        const response = await fetch(workerR2Url, { credentials: "omit" });
        return this.responseToImageBlob(response);
      } catch {}
    }

    const proxy = new URL(OCR_IMAGE_PROXY_URL);
    proxy.searchParams.set("url", workerR2Url || candidate.url);
    const response = await fetch(proxy.toString(), { credentials: "omit" });
    return this.responseToImageBlob(response);
  }

  private async responseToImageBlob(response: Response): Promise<Blob> {
    if (!response.ok) {
      throw new Error(`Image fetch failed: HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error("IMAGE_TOO_LARGE");
    }

    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error("IMAGE_TOO_LARGE");
    }
    if (blob.type === "image/svg+xml") {
      throw new Error("UNSUPPORTED_IMAGE_TYPE");
    }
    return blob;
  }

  private async normalizeImageBlob(blob: Blob): Promise<{ blob: Blob; width: number; height: number }> {
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width < MIN_IMAGE_SIDE || bitmap.height < MIN_IMAGE_SIDE) {
        throw new Error("IMAGE_TOO_SMALL");
      }

      const longSide = Math.max(bitmap.width, bitmap.height);
      if (longSide <= MAX_IMAGE_LONG_SIDE) {
        return { blob, width: bitmap.width, height: bitmap.height };
      }

      const scale = MAX_IMAGE_LONG_SIDE / longSide;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Failed to create OCR resize canvas.");
      ctx.drawImage(bitmap, 0, 0, width, height);
      return { blob: await blobFromCanvas(canvas, "image/png"), width, height };
    } finally {
      bitmap.close();
    }
  }

  private sortLines(items: OcrResultItem[]): OcrResultItem[] {
    return [...items].sort((a, b) => {
      const ay = a.poly.reduce((sum, point) => sum + point[1], 0) / Math.max(1, a.poly.length);
      const by = b.poly.reduce((sum, point) => sum + point[1], 0) / Math.max(1, b.poly.length);
      const ax = a.poly.reduce((sum, point) => sum + point[0], 0) / Math.max(1, a.poly.length);
      const bx = b.poly.reduce((sum, point) => sum + point[0], 0) / Math.max(1, b.poly.length);
      if (Math.abs(ay - by) > 12) return ay - by;
      return ax - bx;
    });
  }

  private async runImage(candidate: ImageCandidate): Promise<ImageOcrResult> {
    const sandbox = await this.initialize();
    const sourceBlob = await this.fetchImageBlob(candidate);
    const image = await this.normalizeImageBlob(sourceBlob);
    const result = await sandbox.runOcr(image.blob, image, {
      textDetLimitSideLen: 960,
      textDetLimitType: "max",
      textDetMaxSideLimit: MAX_IMAGE_LONG_SIDE,
      textDetThresh: 0.2,
      textDetBoxThresh: 0.45,
      textDetUnclipRatio: 1.4,
      textRecScoreThresh: MIN_LINE_SCORE,
    });

    const lines = this.sortLines(result?.items || [])
      .map((item) => ({ text: normalizeWhitespace(item.text || ""), score: item.score || 0 }))
      .filter((line) => line.text && line.score >= MIN_LINE_SCORE);

    return {
      lines,
      width: result?.image?.width || image.width,
      height: result?.image?.height || image.height,
    };
  }

  public async processItem(item: ItemDocType): Promise<ItemOcrResult> {
    const candidates = this.getImageCandidates(item);
    const sourceHash = this.getSourceHashForCandidates(candidates);
    return this.processCandidates(candidates, sourceHash);
  }

  public async processImageUrl(url: string): Promise<ItemOcrResult> {
    const trimmed = (url || "").trim();
    const candidates: ImageCandidate[] = isHttpUrl(trimmed)
      ? [{ url: trimmed, source: "original", capturedAt: Date.now() }]
      : [];
    const sourceHash = this.getSourceHashForCandidates(candidates);
    return this.processCandidates(candidates, sourceHash);
  }

  private async processCandidates(
    candidates: ImageCandidate[],
    sourceHash: string
  ): Promise<ItemOcrResult> {
    if (candidates.length === 0) {
      return { status: "skipped", text: "", lineCount: 0, sourceHash, error: "No OCR image found." };
    }

    const allLines: Array<{ text: string; score: number }> = [];
    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const result = await this.runImage(candidate);
        allLines.push(...result.lines);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const seen = new Set<string>();
    const lines = allLines.filter((line) => {
      const key = line.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (lines.length === 0 && errors.length === candidates.length) {
      const permanent = errors.every((error) =>
        ["IMAGE_TOO_LARGE", "IMAGE_TOO_SMALL", "UNSUPPORTED_IMAGE_TYPE"].includes(error)
      );
      return {
        status: permanent ? "skipped" : "error",
        text: "",
        lineCount: 0,
        sourceHash,
        error: errors.slice(0, 3).join("; "),
      };
    }

    const text = normalizeWhitespace(lines.map((line) => line.text).join("\n")).slice(
      0,
      MAX_OCR_TEXT_CHARS
    );
    const confidence =
      lines.length > 0
        ? lines.reduce((sum, line) => sum + line.score, 0) / lines.length
        : undefined;

    return {
      status: "done",
      text,
      confidence,
      lineCount: lines.length,
      sourceHash,
      error: errors.length > 0 ? errors.slice(0, 3).join("; ") : undefined,
    };
  }
}

export const ocrService = new OcrService();
