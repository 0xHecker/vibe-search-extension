import type {
  EmbeddingRequestPriority,
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse,
} from "./workers/embedding-worker-protocol";

type PendingEmbedding = {
  request: EmbeddingWorkerRequest;
  resolve: (value: Float32Array) => void;
  reject: (reason: Error) => void;
};

type WorkerFactory = () => Worker;

const createEmbeddingWorker = (): Worker =>
  new Worker(new URL("./workers/embedding.worker.ts", import.meta.url), { type: "module" });

/**
 * Keeps inference out of the offscreen document and lets user-initiated search
 * run before queued import work. A single worker also avoids concurrent ONNX runs.
 */
export class EmbeddingWorkerClient {
  private worker: Worker | null = null;
  private active: PendingEmbedding | null = null;
  private interactiveQueue: PendingEmbedding[] = [];
  private backgroundQueue: PendingEmbedding[] = [];
  private requestId = 0;

  constructor(private readonly workerFactory: WorkerFactory = createEmbeddingWorker) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = this.workerFactory();
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleWorkerFailure);
    worker.addEventListener("messageerror", this.handleWorkerFailure);
    this.worker = worker;
    return worker;
  }

  private handleMessage = (event: MessageEvent<EmbeddingWorkerResponse>) => {
    const response = event.data;
    const active = this.active;
    if (!active || response?.requestId !== active.request.requestId) return;

    this.active = null;
    if (response.type === "EMBEDDING_RESULT" && response.payload.buffer instanceof ArrayBuffer) {
      active.resolve(new Float32Array(response.payload.buffer));
    } else {
      active.reject(new Error(response.type === "EMBEDDING_ERROR" ? response.error : "Invalid embedding response."));
    }
    this.pump();
  };

  private handleWorkerFailure = (event: ErrorEvent | MessageEvent) => {
    const message = "message" in event && typeof event.message === "string"
      ? event.message
      : "Embedding worker failed.";
    this.failAll(new Error(message));
  };

  private nextPending(): PendingEmbedding | null {
    return this.interactiveQueue.shift() || this.backgroundQueue.shift() || null;
  }

  private pump() {
    if (this.active) return;

    const next = this.nextPending();
    if (!next) return;

    this.active = next;
    try {
      this.ensureWorker().postMessage(next.request);
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error("Could not start embedding worker."));
    }
  }

  private failAll(error: Error) {
    this.worker?.terminate();
    this.worker = null;

    const pending = [this.active, ...this.interactiveQueue, ...this.backgroundQueue].filter(
      (entry): entry is PendingEmbedding => entry !== null
    );
    this.active = null;
    this.interactiveQueue = [];
    this.backgroundQueue = [];
    for (const entry of pending) entry.reject(error);
  }

  public embed(sentences: string[], priority: EmbeddingRequestPriority): Promise<Float32Array> {
    if (sentences.length === 0) return Promise.resolve(new Float32Array());

    this.requestId += 1;
    const request: EmbeddingWorkerRequest = {
      type: "EMBEDDING_REQUEST",
      requestId: this.requestId,
      priority,
      payload: { sentences },
    };

    return new Promise<Float32Array>((resolve, reject) => {
      const pending = { request, resolve, reject };
      if (priority === "interactive") {
        this.interactiveQueue.push(pending);
      } else {
        this.backgroundQueue.push(pending);
      }
      this.pump();
    });
  }
}
