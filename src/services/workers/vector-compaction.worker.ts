/// <reference lib="webworker" />
import { OpfsHandler } from "@src/services/vector-store/opfs-handler";

type VectorIndexMapEntry = { id: string; vector_index: number };

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

const normalizeCleanItems = (items: VectorIndexMapEntry[]): VectorIndexMapEntry[] =>
  items
    .filter(
      (item) =>
        typeof item.id === "string" &&
        item.id.length > 0 &&
        Number.isInteger(item.vector_index) &&
        item.vector_index >= 0
    )
    .sort((a, b) => a.vector_index - b.vector_index);

const copyCleanVectors = async (
  payload: CopyCleanVectorsWorkerPayload
): Promise<CopyCleanVectorsWorkerResult> => {
  const cleanItems = normalizeCleanItems(payload.cleanItems || []);
  if (cleanItems.length === 0) {
    return { newIndexMap: [], appendedCount: 0 };
  }

  const sourceOpfs = new OpfsHandler();
  const destOpfs = new OpfsHandler();
  await sourceOpfs.open(payload.sourceFile, false, false);
  await destOpfs.open(payload.destFile);

  const vectorSizeBytes = payload.vectorDimension * 4;
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

      const sourceOffset = payload.headerSize + run[0].vector_index * vectorSizeBytes;
      const destOffset = payload.headerSize + (payload.destStartIndex + appendedCount) * vectorSizeBytes;

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
};

self.onmessage = async (event: MessageEvent<CopyCleanVectorsWorkerRequest>) => {
  const message = event.data;
  if (!message || message.type !== "COPY_CLEAN_VECTORS") return;

  const payload = await copyCleanVectors(message.payload);
  const response: CopyCleanVectorsWorkerResponse = {
    type: "COPY_CLEAN_VECTORS_RESULT",
    requestId: message.requestId,
    payload,
  };
  self.postMessage(response);
};

export {};
