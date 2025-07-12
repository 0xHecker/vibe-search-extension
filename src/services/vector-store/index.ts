import { SearchResult } from "@src/common/types";
import { OpfsHandler } from "./opfs-handler";
import { dotProduct } from "./dot-product";
import { MinHeap } from "@src/utils/min-heap";

const VECTOR_DIMENSION = 384; // As per jina-embeddings-v2-small-en
const BYTES_PER_VECTOR = VECTOR_DIMENSION * 4; // Float32 takes 4 bytes

// The public VectorStore class and interface
export interface VectorStore {
  // Lifecycle
  initialize(): Promise<void>;

  // Search (operates on a subset of indices)
  search(queryVec: Float32Array, candidateIndices: Set<number>, topK: number): SearchResult[];

  // Data Manipulation
  add(id: string, vec: Float32Array): Promise<number>; // Returns the new vector_index
  update(vectorIndex: number, vec: Float32Array): Promise<void>;

  // Utilities
  getVectorCount(): number;
  getBuffer(): ArrayBuffer | null;
}

class VectorStoreImpl implements VectorStore {
  private vectorBuffer: ArrayBuffer | null = null;
  private vectorView: Float32Array | null = null;
  private vectorCount = 0;
  private opfsHandler = new OpfsHandler();

  async initialize(): Promise<void> {
    await this.opfsHandler.open("vectors.bin");
    const fileSize = this.opfsHandler.getSize();
    this.vectorBuffer = new ArrayBuffer(fileSize);
    this.vectorView = new Float32Array(this.vectorBuffer);
    if (fileSize > 0) {
      this.opfsHandler.read(this.vectorView.buffer, 0);
    }
    this.vectorCount = fileSize / BYTES_PER_VECTOR;
    console.log(`VectorStore initialized with ${this.vectorCount} vectors.`);
  }

  search(queryVec: Float32Array, candidateIndices: Set<number>, topK: number): SearchResult[] {
    if (!this.vectorView) {
      throw new Error("Vector store not initialized");
    }

    const heap = new MinHeap<SearchResult>(
      topK,
      (a: SearchResult, b: SearchResult) => a.score - b.score
    );

    for (const index of candidateIndices) {
      const offset = index * VECTOR_DIMENSION;
      const vectorToCompare = this.vectorView.subarray(offset, offset + VECTOR_DIMENSION);
      const score = dotProduct(queryVec, vectorToCompare);

      if (heap.size() < topK || score > heap.peek()!.score) {
        heap.insert({ id: index.toString(), score }); // Using index as ID for now
      }
    }

    return heap.getSorted((a: SearchResult, b: SearchResult) => b.score - a.score);
  }

  async add(id: string, vec: Float32Array): Promise<number> {
    if (!this.vectorView || !this.vectorBuffer) {
      throw new Error("Vector store not initialized");
    }
    // This needs a resize strategy for production
    const newIndex = this.vectorCount;
    const byteOffset = newIndex * BYTES_PER_VECTOR;

    this.vectorView.set(vec, newIndex * VECTOR_DIMENSION);
    this.opfsHandler.write(vec.buffer, byteOffset);
    this.opfsHandler.flush();

    this.vectorCount++;
    return newIndex;
  }

  async update(vectorIndex: number, vec: Float32Array): Promise<void> {
    if (!this.vectorView) {
      throw new Error("Vector store not initialized");
    }
    const offset = vectorIndex * VECTOR_DIMENSION;
    this.vectorView.set(vec, offset);
    this.opfsHandler.write(vec.buffer, vectorIndex * BYTES_PER_VECTOR);
    this.opfsHandler.flush();
  }

  getVectorCount(): number {
    return this.vectorCount;
  }

  getBuffer(): ArrayBuffer | null {
    return this.vectorBuffer;
  }
}

export const vectorStore = new VectorStoreImpl();
