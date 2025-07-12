import { OpfsHandler } from "./vector-store/opfs-handler";
import { VECTOR_DIMENSION } from "@src/common/constants";
import { embeddingService } from "./embedding.service";
import { dotProduct } from "./vector-store/dot-product";

interface SearchResult {
  index: number;
  score: number;
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
  private isInitialized = false;
  private generationPromise: Promise<any> | null = null;

  // Vector file properties
  private vectorBuffer: ArrayBuffer | null = null;
  private vectorCount = 0;
  private readonly MAGIC_NUMBER = 0x56494245; // "VIBE"
  private readonly VERSION = 1;
  private readonly HEADER_SIZE = 16;

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

  private async createNewVectorFile(): Promise<void> {
    console.log("Creating new vector file.");
    this.vectorCount = 0;
    const header = new ArrayBuffer(this.HEADER_SIZE);
    const headerView = new DataView(header);
    headerView.setUint32(0, this.MAGIC_NUMBER, true);
    headerView.setUint32(4, this.VERSION, true);
    headerView.setUint32(8, VECTOR_DIMENSION, true);
    headerView.setUint32(12, this.vectorCount, true);
    await this.opfsHandler.write(header, 0);
    this.vectorBuffer = new ArrayBuffer(0);
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
  }

  private async addVectors(newVectorsBuffer: Float32Array): Promise<void> {
    if (!this.vectorBuffer) throw new Error("Vector buffer not initialized.");

    const newVectorCount = newVectorsBuffer.length / VECTOR_DIMENSION;
    const appendOffset = this.HEADER_SIZE + this.vectorBuffer.byteLength;
    await this.opfsHandler.write(newVectorsBuffer.buffer as ArrayBuffer, appendOffset);

    const newTotalCount = this.vectorCount + newVectorCount;
    const countBuffer = new ArrayBuffer(4);
    new DataView(countBuffer).setUint32(0, newTotalCount, true);
    await this.opfsHandler.write(countBuffer, 12);

    // Update in-memory cache
    const newCacheBuffer = new ArrayBuffer(
      this.vectorBuffer.byteLength + newVectorsBuffer.byteLength
    );
    new Uint8Array(newCacheBuffer).set(new Uint8Array(this.vectorBuffer));
    new Uint8Array(newCacheBuffer).set(
      new Uint8Array(newVectorsBuffer.buffer),
      this.vectorBuffer.byteLength
    );

    this.vectorBuffer = newCacheBuffer;
    this.vectorCount = newTotalCount;
  }

  // --- Public Service Methods ---

  public getVectorCount = async (): Promise<number> => {
    await this.initialize();
    return this.vectorCount;
  };

  public getAllVectors = async (): Promise<string | null> => {
    await this.initialize();
    if (this.vectorBuffer) {
      return arrayBufferToBase64(this.vectorBuffer);
    }
    return null;
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
    this.vectorCount = 0;
    await this.initialize();
  };

  public generateAndStoreEmbeddings = async (payload: { sentences: string[] }): Promise<number> => {
    await this.initialize();
    if (!this.generationPromise) {
      const generationTask = async () => {
        const embeddings = await embeddingService.generateEmbeddings(payload);
        await this.addVectors(embeddings);
        return this.vectorCount;
      };
      this.generationPromise = generationTask().finally(() => {
        this.generationPromise = null;
      });
    }
    return this.generationPromise;
  };

  public search = async (payload: { query: string; topK: number }): Promise<SearchResult[]> => {
    await this.initialize();
    if (!this.vectorBuffer) return [];

    const { query, topK } = payload;

    // 1. Generate and normalize query vector
    const rawQueryVector = await embeddingService.generateEmbeddings({ sentences: [query] });
    const queryVector = rawQueryVector;

    // 2. Compare with all stored vectors
    const vectorView = new Float32Array(this.vectorBuffer);
    const results: SearchResult[] = [];

    for (let i = 0; i < this.vectorCount; i++) {
      const offset = i * VECTOR_DIMENSION;
      // Normalize each stored vector before comparison
      const storedVector = vectorView.subarray(offset, offset + VECTOR_DIMENSION);
      const score = dotProduct(queryVector, storedVector);
      results.push({ index: i, score });
    }

    // 3. Sort and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  };
}

export const vectorStoreService = new VectorStoreService();
