import { EmbeddingWorkerClient } from "./embedding-worker-client";
import type { EmbeddingRequestPriority } from "./workers/embedding-worker-protocol";

class EmbeddingService {
  private worker = new EmbeddingWorkerClient();

  public generateEmbeddings = async (payload: {
    sentences: string[];
    priority?: EmbeddingRequestPriority;
  }): Promise<Float32Array> => {
    return this.worker.embed(payload.sentences, payload.priority || "background");
  };
}

export const embeddingService = new EmbeddingService();
