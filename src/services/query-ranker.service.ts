import type {
  RankQueryWorkerPayload,
  RankQueryWorkerRequest,
  RankQueryWorkerResponse,
  RankQueryWorkerResult,
} from "@src/search-core/contracts";

export const RANK_REQUEST_SUPERSEDED = "RANK_REQUEST_SUPERSEDED";
export const RANK_WORKER_EXECUTION_ERROR = "RANK_WORKER_EXECUTION_ERROR";

export class SupersededRankRequestError extends Error {
  constructor() {
    super(RANK_REQUEST_SUPERSEDED);
    this.name = RANK_REQUEST_SUPERSEDED;
  }
}

export class RankWorkerExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = RANK_WORKER_EXECUTION_ERROR;
  }
}

type PendingRequest = {
  resolve: (value: RankQueryWorkerResult) => void;
  reject: (error: Error) => void;
};

class QueryRankerService {
  private worker: Worker | null = null;
  private warmWorker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private readonly BASE_TIMEOUT_MS = 2200;
  private readonly MAX_TIMEOUT_MS = 8000;

  private createWorker(): Worker {
    const worker = new Worker(new URL("./workers/query-ranker.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.addEventListener("message", (event: MessageEvent<RankQueryWorkerResponse>) => {
      const message = event.data;
      if (!message || message.type !== "RANK_QUERY_RESULT") return;
      const request = this.pending.get(message.requestId);
      if (!request) return;
      this.pending.delete(message.requestId);
      request.resolve(message.payload);
    });

    worker.addEventListener("error", (event) => {
      const error = new RankWorkerExecutionError(
        event?.message || "Query rank worker failed while processing request."
      );
      const wasActive = this.worker === worker;

      if (wasActive) {
        this.rejectPending(error);
      }

      this.disposeWorker(worker);
      this.promoteWarmWorker();
      this.ensureWarmWorker();
    });

    return worker;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.promoteWarmWorker();
      if (!this.worker) {
        this.worker = this.createWorker();
      }
    }
    this.ensureWarmWorker();
    return this.worker;
  }

  private ensureWarmWorker() {
    if (this.warmWorker) return;
    this.warmWorker = this.createWorker();
  }

  private promoteWarmWorker() {
    if (!this.worker && this.warmWorker) {
      this.worker = this.warmWorker;
      this.warmWorker = null;
    }
  }

  private disposeWorker(target: Worker) {
    try {
      target.terminate();
    } catch {}
    if (this.worker === target) {
      this.worker = null;
    }
    if (this.warmWorker === target) {
      this.warmWorker = null;
    }
  }

  private rejectPending(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private rotateActiveWorkerAndRejectSuperseded() {
    if (this.pending.size === 0) return;
    const error = new SupersededRankRequestError();
    this.rejectPending(error);
    if (!this.worker) return;
    this.disposeWorker(this.worker);
    this.promoteWarmWorker();
    this.ensureWarmWorker();
  }

  private resolveTimeoutMs(payload: RankQueryWorkerPayload): number {
    const computed = this.BASE_TIMEOUT_MS + payload.items.length * 0.35;
    return Math.max(this.BASE_TIMEOUT_MS, Math.min(this.MAX_TIMEOUT_MS, Math.round(computed)));
  }

  private terminateWorkerIfCurrent(worker: Worker) {
    if (this.worker !== worker) return;
    this.disposeWorker(worker);
    this.promoteWarmWorker();
    this.ensureWarmWorker();
  }

  prewarm() {
    if (!this.warmWorker && !this.worker) {
      this.warmWorker = this.createWorker();
    }
  }

  async rank(payload: RankQueryWorkerPayload): Promise<RankQueryWorkerResult> {
    this.rotateActiveWorkerAndRejectSuperseded();
    const worker = this.ensureWorker();
    this.requestId += 1;
    const requestId = this.requestId;
    const timeoutMs = this.resolveTimeoutMs(payload);

    return new Promise<RankQueryWorkerResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.reject(
          new RankWorkerExecutionError(
            `Query rank worker timed out after ${timeoutMs}ms.`
          )
        );
        this.terminateWorkerIfCurrent(worker);
      }, timeoutMs);

      const clear = () => {
        clearTimeout(timeoutId);
      };

      const wrappedResolve = (value: RankQueryWorkerResult) => {
        clear();
        resolve(value);
      };
      const wrappedReject = (error: Error) => {
        clear();
        reject(error);
      };

      this.pending.set(requestId, { resolve: wrappedResolve, reject: wrappedReject });
      const request: RankQueryWorkerRequest = {
        type: "RANK_QUERY",
        requestId,
        payload,
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        this.pending.delete(requestId);
        wrappedReject(
          error instanceof Error
            ? error
            : new RankWorkerExecutionError("Failed to post rank request to worker.")
        );
      }
    });
  }
}

export const queryRankerService = new QueryRankerService();
