import { expect, test } from "bun:test";
import { EmbeddingWorkerClient } from "@src/services/embedding-worker-client";

type Listener = (event: any) => void;

class FakeEmbeddingWorker {
  public sent: Array<{ requestId: number; priority: string }> = [];
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener) {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  postMessage(message: { requestId: number; priority: string }) {
    this.sent.push(message);
  }

  terminate() {}

  respond(requestId: number, vector: Float32Array) {
    for (const listener of this.listeners.get("message") || []) {
      listener({
        data: {
          type: "EMBEDDING_RESULT",
          requestId,
          payload: { buffer: vector.buffer },
        },
      });
    }
  }
}

test("EmbeddingWorkerClient serves an interactive query before queued background batches", async () => {
  const worker = new FakeEmbeddingWorker();
  const client = new EmbeddingWorkerClient(() => worker as unknown as Worker);

  const firstBackground = client.embed(["first"], "background");
  const queuedBackground = client.embed(["second"], "background");
  const interactive = client.embed(["search"], "interactive");

  expect(worker.sent.map((request) => request.priority)).toEqual(["background"]);

  worker.respond(1, new Float32Array([1]));
  await firstBackground;
  expect(worker.sent.map((request) => request.priority)).toEqual(["background", "interactive"]);

  worker.respond(3, new Float32Array([3]));
  await interactive;
  expect(worker.sent.map((request) => request.priority)).toEqual([
    "background",
    "interactive",
    "background",
  ]);

  worker.respond(2, new Float32Array([2]));
  await expect(queuedBackground).resolves.toEqual(new Float32Array([2]));
});
