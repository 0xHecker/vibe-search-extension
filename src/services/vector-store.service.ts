import { OpfsHandler } from "./vector-store/opfs-handler";
import { VECTOR_DIMENSION } from "@src/common/constants";
import { embeddingService } from "./embedding.service";
import { dotProduct } from "./vector-store/dot-product";
import type { ItemDocType } from "@src/schemas/item_schema";
import { composeEmbeddingText, composeQueryEmbeddingText } from "@src/search-core/embedding-text";

interface SearchResult {
  index: number;
  score: number;
}

type VectorSearchTimings = {
  embeddingMs: number;
  scanMs: number;
  totalMs: number;
  scannedCount: number;
};

type VectorSearchResponse = {
  results: SearchResult[];
  timings: VectorSearchTimings;
};

type VectorIndexMapEntry = { id: string; vector_index: number };
type VectorSegment = { startIndex: number; count: number; data: Float32Array };
type EmbeddingAppendResult = {
  startIndex: number;
  appendedCount: number;
  totalCount: number;
};

type CopyCleanVectorsWorkerPayload = {
  sourceFile: string;
  destFile: string;
  cleanItems: VectorIndexMapEntry[];
  destStartIndex: number;
  vectorDimension: number;
  headerSize: number;
};

type CopyCleanVectorsWorkerRequest = {
  type: "COPY_CLEAN_VECTORS";
  requestId: number;
  payload: CopyCleanVectorsWorkerPayload;
};

type CopyCleanVectorsWorkerResult = {
  newIndexMap: VectorIndexMapEntry[];
  appendedCount: number;
};

type CopyCleanVectorsWorkerResponse = {
  type: "COPY_CLEAN_VECTORS_RESULT";
  requestId: number;
  payload: CopyCleanVectorsWorkerResult;
};

class VectorCompactionWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: CopyCleanVectorsWorkerResult) => void;
      reject: (error: Error) => void;
    }
  >();

  private createWorker(): Worker {
    const worker = new Worker(new URL("./workers/vector-compaction.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.addEventListener("message", (event: MessageEvent<CopyCleanVectorsWorkerResponse>) => {
      const message = event.data;
      if (!message || message.type !== "COPY_CLEAN_VECTORS_RESULT") return;
      const request = this.pending.get(message.requestId);
      if (!request) return;
      this.pending.delete(message.requestId);
      request.resolve(message.payload);
    });

    worker.addEventListener("error", (event) => {
      const error = new Error(event?.message || "Vector compaction worker failed.");
      for (const [id, pending] of this.pending.entries()) {
        this.pending.delete(id);
        pending.reject(error);
      }
      worker.terminate();
      if (this.worker === worker) {
        this.worker = null;
      }
    });

    return worker;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = this.createWorker();
    }
    return this.worker;
  }

  async copyCleanVectors(payload: CopyCleanVectorsWorkerPayload): Promise<CopyCleanVectorsWorkerResult> {
    const worker = this.ensureWorker();
    this.requestId += 1;
    const requestId = this.requestId;
    const message: CopyCleanVectorsWorkerRequest = {
      type: "COPY_CLEAN_VECTORS",
      requestId,
      payload,
    };

    return new Promise<CopyCleanVectorsWorkerResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage(message);
    });
  }
}

class TopKMinHeap {
  private heap: SearchResult[] = [];
  constructor(private readonly capacity: number) {}

  private swap(i: number, j: number) {
    const tmp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = tmp;
  }

  private bubbleUp(index: number) {
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].score <= this.heap[i].score) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  private bubbleDown(index: number) {
    let i = index;
    const n = this.heap.length;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;

      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest === i) break;

      this.swap(i, smallest);
      i = smallest;
    }
  }

  push(result: SearchResult) {
    if (this.capacity <= 0) return;

    if (this.heap.length < this.capacity) {
      this.heap.push(result);
      this.bubbleUp(this.heap.length - 1);
      return;
    }

    if (result.score <= this.heap[0].score) return;
    this.heap[0] = result;
    this.bubbleDown(0);
  }

  toSortedDesc(): SearchResult[] {
    return [...this.heap].sort((a, b) => b.score - a.score);
  }
}

// --- Base64 Conversion Utility ---
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

class VectorStoreService {
  [key: string]: any;
  private opfsHandler = new OpfsHandler();
  private compactionWorker = new VectorCompactionWorkerClient();
  private isInitialized = false;
  private lockPromise: Promise<void> = Promise.resolve();
  private readonly COPY_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
  private readonly QUERY_EMBEDDING_CACHE_LIMIT = 64;
  private queryEmbeddingCache = new Map<string, Float32Array>();

  // Vector file properties
  private vectorBuffer: ArrayBuffer | null = null;
  private vectorSegments: VectorSegment[] = [];
  private vectorCount = 0;
  private readonly MAGIC_NUMBER = 0x56494245; // "VIBE"
  private readonly VERSION = 1;
  private readonly HEADER_SIZE = 16;

  private toArrayBuffer(view: Float32Array): ArrayBuffer {
    if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
      return view.buffer as ArrayBuffer;
    }
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }

  private async deleteFileUnlocked(fileName: string): Promise<void> {
    const opfsHandler = new OpfsHandler();
    try {
      await opfsHandler.open(fileName, false, false);
      await opfsHandler.deleteSelf();
    } catch {
      // Ignore missing file cleanup.
    } finally {
      opfsHandler.close();
    }
  }

  private async copyFileUnlocked(
    sourceFile: string,
    destFile: string,
    options?: { truncateDest?: boolean; chunkSizeBytes?: number }
  ): Promise<void> {
    const sourceOpfs = new OpfsHandler();
    const destOpfs = new OpfsHandler();
    const truncateDest = options?.truncateDest ?? true;
    const chunkSize = Math.max(64 * 1024, options?.chunkSizeBytes ?? this.COPY_CHUNK_SIZE_BYTES);

    try {
      await sourceOpfs.open(sourceFile, false, false);
      await destOpfs.open(destFile, truncateDest);

      const size = await sourceOpfs.getSize();
      let offset = 0;
      while (offset < size) {
        const bytesToCopy = Math.min(chunkSize, size - offset);
        const chunk = new ArrayBuffer(bytesToCopy);
        await sourceOpfs.read(chunk, offset);
        await destOpfs.write(chunk, offset);
        offset += bytesToCopy;
      }
    } finally {
      sourceOpfs.close();
      destOpfs.close();
    }
  }

  private setSegmentsFromBuffer(buffer: ArrayBuffer, count: number) {
    if (count <= 0 || buffer.byteLength === 0) {
      this.vectorSegments = [];
      return;
    }
    this.vectorSegments = [
      {
        startIndex: 0,
        count,
        data: new Float32Array(buffer),
      },
    ];
  }

  private getSegmentForIndex(index: number): VectorSegment | null {
    let left = 0;
    let right = this.vectorSegments.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const segment = this.vectorSegments[mid];
      if (index < segment.startIndex) {
        right = mid - 1;
        continue;
      }
      if (index >= segment.startIndex + segment.count) {
        left = mid + 1;
        continue;
      }
      return segment;
    }
    return null;
  }

  private getVectorAt(index: number): Float32Array | null {
    const segment = this.getSegmentForIndex(index);
    if (!segment) return null;
    const localIndex = index - segment.startIndex;
    const offset = localIndex * VECTOR_DIMENSION;
    return segment.data.subarray(offset, offset + VECTOR_DIMENSION);
  }

  private normalizeCleanItems(items: VectorIndexMapEntry[]): VectorIndexMapEntry[] {
    return items
      .filter(
        (item) =>
          typeof item.id === "string" &&
          item.id.length > 0 &&
          Number.isInteger(item.vector_index) &&
          item.vector_index >= 0
      )
      .sort((a, b) => a.vector_index - b.vector_index);
  }

  private async copyCleanVectorRangesInProcess(payload: {
    sourceFile: string;
    destFile: string;
    cleanItems: VectorIndexMapEntry[];
    destStartIndex: number;
  }): Promise<CopyCleanVectorsWorkerResult> {
    const cleanItems = this.normalizeCleanItems(payload.cleanItems);
    if (cleanItems.length === 0) {
      return { newIndexMap: [], appendedCount: 0 };
    }

    const sourceOpfs = new OpfsHandler();
    const destOpfs = new OpfsHandler();
    await sourceOpfs.open(payload.sourceFile, false, false);
    await destOpfs.open(payload.destFile);

    const vectorSizeBytes = VECTOR_DIMENSION * 4;
    const newIndexMap: VectorIndexMapEntry[] = [];
    let appendedCount = 0;

    try {
      let cursor = 0;
      while (cursor < cleanItems.length) {
        let runEnd = cursor + 1;
        while (
          runEnd < cleanItems.length &&
          cleanItems[runEnd].vector_index === cleanItems[runEnd - 1].vector_index + 1
        ) {
          runEnd += 1;
        }

        const run = cleanItems.slice(cursor, runEnd);
        const runCount = run.length;
        const runBytes = runCount * vectorSizeBytes;
        const buffer = new ArrayBuffer(runBytes);

        const sourceOffset = this.HEADER_SIZE + run[0].vector_index * vectorSizeBytes;
        const destOffset = this.HEADER_SIZE + (payload.destStartIndex + appendedCount) * vectorSizeBytes;

        await sourceOpfs.read(buffer, sourceOffset);
        await destOpfs.write(buffer, destOffset);

        for (let i = 0; i < run.length; i++) {
          newIndexMap.push({
            id: run[i].id,
            vector_index: payload.destStartIndex + appendedCount + i,
          });
        }

        appendedCount += runCount;
        cursor = runEnd;
      }
    } finally {
      sourceOpfs.close();
      destOpfs.close();
    }

    return { newIndexMap, appendedCount };
  }

  private async copyCleanVectors(payload: {
    sourceFile: string;
    destFile: string;
    cleanItems: VectorIndexMapEntry[];
    destStartIndex: number;
  }): Promise<CopyCleanVectorsWorkerResult> {
    const normalized = this.normalizeCleanItems(payload.cleanItems);
    if (normalized.length === 0) {
      return { newIndexMap: [], appendedCount: 0 };
    }

    try {
      return await this.compactionWorker.copyCleanVectors({
        sourceFile: payload.sourceFile,
        destFile: payload.destFile,
        cleanItems: normalized,
        destStartIndex: payload.destStartIndex,
        vectorDimension: VECTOR_DIMENSION,
        headerSize: this.HEADER_SIZE,
      });
    } catch (error) {
      console.warn(
        "[VectorStore] Compaction worker unavailable, falling back to in-process clean vector copy.",
        error
      );
      return this.copyCleanVectorRangesInProcess({
        sourceFile: payload.sourceFile,
        destFile: payload.destFile,
        cleanItems: normalized,
        destStartIndex: payload.destStartIndex,
      });
    }
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.opfsHandler.open("vectors.bin");
    const fileSize = await this.opfsHandler.getSize();

    if (fileSize < this.HEADER_SIZE) {
      await this.createNewVectorFile();
    } else {
      await this.loadVectorFile(fileSize);
    }
    this.isInitialized = true;
    console.log(
      `VectorStoreService Initialized. Count: ${this.vectorCount}, Buffer size: ${this.vectorBuffer?.byteLength}`
    );
  }

  public async createNewVectorFile(fileName = "vectors.bin"): Promise<void> {
    console.log(`Creating new vector file: ${fileName}`);
    const opfsHandler = new OpfsHandler();
    await opfsHandler.open(fileName, true); // Truncate if exists

    const header = new ArrayBuffer(this.HEADER_SIZE);
    const headerView = new DataView(header);
    headerView.setUint32(0, this.MAGIC_NUMBER, true);
    headerView.setUint32(4, this.VERSION, true);
    headerView.setUint32(8, VECTOR_DIMENSION, true);
    headerView.setUint32(12, 0, true); // Always 0 for a new file
    await opfsHandler.write(header, 0);
    opfsHandler.close();

    // If we are creating the main file, reset the in-memory state
    if (fileName === "vectors.bin") {
      this.vectorCount = 0;
      this.vectorBuffer = new ArrayBuffer(0);
      this.vectorSegments = [];
    }
  }

  private async loadVectorFile(fileSize: number): Promise<void> {
    console.log("Loading existing vector file.");
    const header = new ArrayBuffer(this.HEADER_SIZE);
    await this.opfsHandler.read(header, 0);
    const headerView = new DataView(header);

    if (headerView.getUint32(0, true) !== this.MAGIC_NUMBER)
      throw new Error("Invalid file format.");
    if (headerView.getUint32(8, true) !== VECTOR_DIMENSION) {
      console.warn("Vector dimension mismatch. Resetting file.");
      return this.createNewVectorFile();
    }

    this.vectorCount = headerView.getUint32(12, true);
    const bodySize = this.vectorCount * VECTOR_DIMENSION * 4;
    if (fileSize - this.HEADER_SIZE !== bodySize) {
      console.error("File is corrupt. Resetting file.");
      return this.createNewVectorFile();
    }

    this.vectorBuffer = new ArrayBuffer(bodySize);
    if (bodySize > 0) {
      await this.opfsHandler.read(this.vectorBuffer, this.HEADER_SIZE);
    }
    this.setSegmentsFromBuffer(this.vectorBuffer, this.vectorCount);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lockPromise.then(fn, fn);
    this.lockPromise = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Appends a new set of vectors to the end of the `vectors.bin` file.
   * This is an "append-only" operation, used for adding new or updated items
   * quickly without rebuilding the entire file. This operation is protected by a lock
   * to prevent race conditions with the rebuild process.
   */
  private async addVectors(newVectorsBuffer: Float32Array): Promise<EmbeddingAppendResult> {
    return this.withLock(async () => {
      const newVectorCount = Math.floor(newVectorsBuffer.length / VECTOR_DIMENSION);
      if (!Number.isFinite(newVectorCount) || newVectorCount <= 0) {
        return {
          startIndex: this.vectorCount,
          appendedCount: 0,
          totalCount: this.vectorCount,
        };
      }
      if (newVectorCount * VECTOR_DIMENSION !== newVectorsBuffer.length) {
        throw new Error("Invalid vector payload length for append.");
      }

      const startIndex = this.vectorCount;
      const appendOffset = this.HEADER_SIZE + this.vectorCount * VECTOR_DIMENSION * 4;
      await this.opfsHandler.write(this.toArrayBuffer(newVectorsBuffer), appendOffset);

      const newTotalCount = this.vectorCount + newVectorCount;
      const countBuffer = new ArrayBuffer(4);
      new DataView(countBuffer).setUint32(0, newTotalCount, true);
      await this.opfsHandler.write(countBuffer, 12);

      const appended = new Float32Array(newVectorsBuffer);
      this.vectorSegments.push({
        startIndex: this.vectorCount,
        count: newVectorCount,
        data: appended,
      });
      this.vectorBuffer = null;
      this.vectorCount = newTotalCount;

      return {
        startIndex,
        appendedCount: newVectorCount,
        totalCount: newTotalCount,
      };
    });
  }

  // --- Public Service Methods ---

  private getClockNow(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  private getQueryEmbeddingCacheKey(query: string): string {
    return query.trim().toLowerCase();
  }

  private normalizeQueryEmbeddingInput(query: string): string {
    const composed = composeQueryEmbeddingText(query || "");
    const normalized = composed.trim();
    if (normalized) {
      return normalized;
    }
    return (query || "").trim();
  }

  private readCachedQueryEmbedding(key: string): Float32Array | null {
    const cached = this.queryEmbeddingCache.get(key);
    if (!cached) return null;
    this.queryEmbeddingCache.delete(key);
    this.queryEmbeddingCache.set(key, cached);
    return cached;
  }

  private cacheQueryEmbedding(key: string, embedding: Float32Array) {
    this.queryEmbeddingCache.set(key, embedding);
    while (this.queryEmbeddingCache.size > this.QUERY_EMBEDDING_CACHE_LIMIT) {
      const oldestKey = this.queryEmbeddingCache.keys().next().value;
      if (!oldestKey) break;
      this.queryEmbeddingCache.delete(oldestKey);
    }
  }

  private async getQueryEmbedding(query: string): Promise<Float32Array> {
    const normalizedQuery = this.normalizeQueryEmbeddingInput(query);
    const key = this.getQueryEmbeddingCacheKey(normalizedQuery);
    const cached = this.readCachedQueryEmbedding(key);
    if (cached) return cached;
    const generated = await embeddingService.generateEmbeddings({ sentences: [normalizedQuery] });
    const snapshot = new Float32Array(generated);
    this.cacheQueryEmbedding(key, snapshot);
    return snapshot;
  }

  public getVectorCount = async (): Promise<number> => {
    await this.initialize();
    return this.vectorCount;
  };

  public getAllVectors = async (): Promise<string | null> => {
    await this.initialize();
    if (this.vectorCount <= 0) return null;
    const bodySize = this.vectorCount * VECTOR_DIMENSION * 4;
    const body = new ArrayBuffer(bodySize);
    await this.opfsHandler.read(body, this.HEADER_SIZE);
    return arrayBufferToBase64(body);
  };

  public downloadFile = async (): Promise<string | null> => {
    await this.initialize();
    const fileSize = await this.opfsHandler.getSize();
    if (fileSize > 0) {
      const fileBuffer = new ArrayBuffer(fileSize);
      await this.opfsHandler.read(fileBuffer, 0);
      return arrayBufferToBase64(fileBuffer);
    }
    return null;
  };

  public clearStorage = async (): Promise<void> => {
    await this.opfsHandler.deleteSelf();
    this.isInitialized = false;
    this.vectorBuffer = null;
    this.vectorSegments = [];
    this.vectorCount = 0;
    await this.initialize();
  };

  public generateAndStoreEmbeddings = async (payload: {
    sentences: string[];
  }): Promise<EmbeddingAppendResult> => {
    await this.initialize();
    const embeddings = await embeddingService.generateEmbeddings(payload);
    return this.addVectors(embeddings);
  };

  /**
   * Rebuilds the vector store from scratch. It re-embeds dirty items and copies
   * vectors for clean items into a new, compacted file. This is a key part of the
   * garbage collection process. This operation is protected by a lock to prevent
   * race conditions with the append-only `addVectors` operation.
   */
  public rebuildVectors = async (
    destFile: string,
    dirtyItems: Array<
      Pick<ItemDocType, "id" | "title" | "textContent" | "url" | "source" | "authorUsername" | "media">
    >,
    cleanItems: { id: string; vector_index: number }[]
  ): Promise<{ newIndexMap: VectorIndexMapEntry[] }> => {
    return this.withLock(async () => {
      const newIndexMap: VectorIndexMapEntry[] = [];
      let newVectorCount = 0;
      const vectorSizeBytes = VECTOR_DIMENSION * 4;

      // Re-embed dirty items
      if (dirtyItems.length > 0) {
        const sentences = dirtyItems.map((item) => composeEmbeddingText(item));
        const embeddings = await embeddingService.generateEmbeddings({ sentences });
        const destOpfs = new OpfsHandler();
        await destOpfs.open(destFile);
        const destOffset = this.HEADER_SIZE + newVectorCount * vectorSizeBytes;
        await destOpfs.write(this.toArrayBuffer(embeddings), destOffset);
        destOpfs.close();
        for (let i = 0; i < dirtyItems.length; i++) {
          newIndexMap.push({ id: dirtyItems[i].id, vector_index: newVectorCount });
          newVectorCount++;
        }
      }

      // Copy clean vectors (worker-first with in-process fallback)
      if (cleanItems.length > 0) {
        const copied = await this.copyCleanVectors({
          sourceFile: "vectors.bin",
          destFile,
          cleanItems,
          destStartIndex: newVectorCount,
        });
        if (copied.newIndexMap.length > 0) {
          newIndexMap.push(...copied.newIndexMap);
          newVectorCount += copied.appendedCount;
        }
      }

      // Write the new count to the header
      const destOpfs = new OpfsHandler();
      await destOpfs.open(destFile);
      const countBuffer = new ArrayBuffer(4);
      new DataView(countBuffer).setUint32(0, newVectorCount, true);
      await destOpfs.write(countBuffer, 12);
      destOpfs.close();

      return { newIndexMap };
    });
  };

  public copyFile = async (
    sourceFile: string,
    destFile: string,
    options?: { truncateDest?: boolean; chunkSizeBytes?: number }
  ): Promise<void> => {
    await this.withLock(() => this.copyFileUnlocked(sourceFile, destFile, options));
  };

  public fileExists = async (fileName: string): Promise<boolean> => {
    const opfs = new OpfsHandler();
    try {
      await opfs.open(fileName, false, false);
      return true;
    } catch {
      return false;
    } finally {
      opfs.close();
    }
  };

  public renameFile = async (oldName: string, newName: string): Promise<void> => {
    await this.withLock(async () => {
      if (oldName === newName) {
        return;
      }
      // OPFS doesn't have a direct rename. We have to copy and delete.
      await this.copyFileUnlocked(oldName, newName, { truncateDest: true });

      await this.deleteFileUnlocked(oldName);

      if (newName === "vectors.bin") {
        this.opfsHandler.close();
        this.isInitialized = false;
        this.vectorBuffer = null;
        this.vectorSegments = [];
        this.vectorCount = 0;
      }
    });
  };

  public deleteFile = async (fileName: string): Promise<void> => {
    await this.withLock(() => this.deleteFileUnlocked(fileName));
  };

  public search = async (payload: {
    query: string;
    topK: number;
    candidateIndices?: number[];
  }): Promise<VectorSearchResponse> => {
    await this.initialize();
    if (this.vectorCount <= 0) {
      return {
        results: [],
        timings: {
          embeddingMs: 0,
          scanMs: 0,
          totalMs: 0,
          scannedCount: 0,
        },
      };
    }

    const query = (payload.query || "").trim();
    const topK = Math.max(1, Math.floor(payload.topK || 20));
    if (!query) {
      return {
        results: [],
        timings: {
          embeddingMs: 0,
          scanMs: 0,
          totalMs: 0,
          scannedCount: 0,
        },
      };
    }
    const startedAt = this.getClockNow();

    // 1. Generate and normalize query vector
    const embeddingStartedAt = this.getClockNow();
    const queryVector = await this.getQueryEmbedding(query);
    const embeddingMs = this.getClockNow() - embeddingStartedAt;

    const indicesToSearch =
      payload.candidateIndices && payload.candidateIndices.length > 0
        ? Array.from(
            new Set(
              payload.candidateIndices.filter(
                (index) => Number.isInteger(index) && index >= 0 && index < this.vectorCount
              )
            )
          )
        : null;

    // 2. Compare with requested vectors (or all stored vectors)
    const heap = new TopKMinHeap(topK);
    const scanStartedAt = this.getClockNow();
    let scannedCount = 0;

    if (indicesToSearch && indicesToSearch.length > 0) {
      for (const i of indicesToSearch) {
        const storedVector = this.getVectorAt(i);
        if (!storedVector) continue;
        const score = dotProduct(queryVector, storedVector);
        heap.push({ index: i, score });
        scannedCount += 1;
      }
    } else {
      for (const segment of this.vectorSegments) {
        for (let localIndex = 0; localIndex < segment.count; localIndex++) {
          const offset = localIndex * VECTOR_DIMENSION;
          const storedVector = segment.data.subarray(offset, offset + VECTOR_DIMENSION);
          const score = dotProduct(queryVector, storedVector);
          heap.push({ index: segment.startIndex + localIndex, score });
          scannedCount += 1;
        }
      }
    }
    const scanMs = this.getClockNow() - scanStartedAt;
    const totalMs = this.getClockNow() - startedAt;

    // 3. Return top K in descending order
    return {
      results: heap.toSortedDesc(),
      timings: {
        embeddingMs,
        scanMs,
        totalMs,
        scannedCount,
      },
    };
  };
}

export const vectorStoreService = new VectorStoreService();
