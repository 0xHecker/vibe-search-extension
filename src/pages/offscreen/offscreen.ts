import { pipeline, FeatureExtractionPipeline } from "@xenova/transformers";
import { OpfsHandler } from "@src/services/vector-store/opfs-handler";
import { VECTOR_DIMENSION } from "@src/common/constants";

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

// --- State for Embedding Pipeline ---
let embeddingPipeline: FeatureExtractionPipeline | null = null;
let embeddingPromise: Promise<void> | null = null;

// --- State for OPFS Vector Store ---
const opfsHandler = new OpfsHandler();
const MAGIC_NUMBER = 0x56494245; // "VIBE"
const VERSION = 1;
const HEADER_SIZE = 16;

let opfsIsInitialized = false;
let vectorDimension = 0;
let vectorCount = 0;
let vectorBuffer: ArrayBuffer | null = null;
let generationPromise: Promise<number> | null = null;

// --- Initialization Logic ---

const initializeEmbeddingPipeline = async () => {
  console.log("Initializing embedding pipeline...");
  embeddingPipeline = await pipeline("feature-extraction", "Xenova/jina-embeddings-v2-small-en", {
    quantized: false,
    // @ts-ignore
    useWorker: false,
  });
  console.log("Embedding pipeline initialized.");
};

const initializeOpfs = async () => {
  await opfsHandler.open("vectors.bin");
  const fileSize = await opfsHandler.getSize();

  if (fileSize < HEADER_SIZE) {
    console.log("Creating new vector file.");
    vectorDimension = VECTOR_DIMENSION;
    vectorCount = 0;
    const header = new ArrayBuffer(HEADER_SIZE);
    const headerView = new DataView(header);
    headerView.setUint32(0, MAGIC_NUMBER, true);
    headerView.setUint32(4, VERSION, true);
    headerView.setUint32(8, vectorDimension, true);
    headerView.setUint32(12, vectorCount, true);
    await opfsHandler.write(header, 0);
    vectorBuffer = new ArrayBuffer(0);
  } else {
    console.log("Loading existing vector file.");
    const header = new ArrayBuffer(HEADER_SIZE);
    await opfsHandler.read(header, 0);
    const headerView = new DataView(header);
    const magic = headerView.getUint32(0, true);
    if (magic !== MAGIC_NUMBER) throw new Error("Invalid file format.");

    const fileDimension = headerView.getUint32(8, true);
    if (fileDimension !== VECTOR_DIMENSION) {
      console.warn(
        `Vector dimension mismatch. Expected ${VECTOR_DIMENSION}, found ${fileDimension}. Resetting file.`
      );
      await opfsHandler.open("vectors.bin", true); // Truncate by reopening
      return initializeOpfs(); // Re-initialize
    }
    vectorDimension = fileDimension;
    vectorCount = headerView.getUint32(12, true);
    const bodySize = vectorCount * vectorDimension * 4;
    if (fileSize - HEADER_SIZE !== bodySize) {
      console.error("File is corrupt. Mismatched size. Resetting file.");
      await opfsHandler.open("vectors.bin", true); // Truncate
      return initializeOpfs();
    }

    vectorBuffer = new ArrayBuffer(bodySize);
    if (bodySize > 0) {
      await opfsHandler.read(vectorBuffer, HEADER_SIZE);
    }
  }
  opfsIsInitialized = true;
};

// --- Vector Store Operations ---

async function addVectors(newVectorsBuffer: Float32Array) {
  if (!vectorBuffer || !opfsIsInitialized) throw new Error("OPFS not initialized.");
  if (newVectorsBuffer.length % vectorDimension !== 0) {
    throw new Error(`Invalid buffer size for adding vectors.`);
  }

  const newVectorCount = newVectorsBuffer.length / vectorDimension;
  const bytesPerVector = vectorDimension * 4;
  const appendOffset = HEADER_SIZE + vectorCount * bytesPerVector;

  await opfsHandler.write(newVectorsBuffer.buffer as ArrayBuffer, appendOffset);

  const newTotalCount = vectorCount + newVectorCount;
  const countBuffer = new ArrayBuffer(4);
  new DataView(countBuffer).setUint32(0, newTotalCount, true);
  await opfsHandler.write(countBuffer, 12); // Update count in header

  // Update in-memory cache
  const newTotalBufferSize = (vectorCount + newVectorCount) * bytesPerVector;
  const newCacheBuffer = new ArrayBuffer(newTotalBufferSize);
  new Uint8Array(newCacheBuffer).set(new Uint8Array(vectorBuffer));
  new Uint8Array(newCacheBuffer).set(
    new Uint8Array(newVectorsBuffer.buffer),
    vectorBuffer.byteLength
  );
  vectorBuffer = newCacheBuffer;
  vectorCount = newTotalCount;
}

// --- Embedding Generation ---

const generateAndStoreEmbeddings = async (sentences: string[]) => {
  if (!embeddingPipeline) {
    if (!embeddingPromise) {
      embeddingPromise = initializeEmbeddingPipeline();
    }
    await embeddingPromise;
  }
  if (!embeddingPipeline) throw new Error("Embedding pipeline failed to initialize.");

  console.log(`Embedding ${sentences.length} sentences...`);
  const combinedVectorArray = new Float32Array(sentences.length * VECTOR_DIMENSION);
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const embedding = await embeddingPipeline(sentence, {
      pooling: "mean",
      normalize: true,
    });
    // @ts-ignore
    combinedVectorArray.set(embedding.data, i * VECTOR_DIMENSION);
  }

  console.log("Embeddings generated. Writing to OPFS...");
  await addVectors(combinedVectorArray);
  return vectorCount;
};

// --- Message Handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, target, payload } = message;

  if (target !== "offscreen") {
    return; // Not for us, return false or undefined
  }

  (async () => {
    try {
      if (!opfsIsInitialized) {
        await initializeOpfs();
      }

      switch (type) {
        case "GENERATE_EMBEDDINGS":
          if (!generationPromise) {
            // If no generation is in progress, start one and store the promise.
            generationPromise = generateAndStoreEmbeddings(payload.sentences).finally(() => {
              // Once finished (successfully or not), clear the promise for the next run.
              generationPromise = null;
            });
          }
          // Whether we just started it or it was already running, wait for the result.
          try {
            const count = await generationPromise;
            sendResponse({
              success: true,
              type: "ADD_VECTORS_COMPLETE",
              count,
            });
          } catch (e) {
            sendResponse({ success: false, error: (e as Error).message });
          }
          break;

        case "GET_VECTOR_COUNT":
          sendResponse({ success: true, type: "GET_VECTOR_COUNT_COMPLETE", count: vectorCount });
          break;

        case "GET_ALL_VECTORS":
          if (vectorBuffer) {
            const payloadBase64 = arrayBufferToBase64(vectorBuffer);
            sendResponse({
              success: true,
              type: "GET_ALL_VECTORS_COMPLETE",
              payload: payloadBase64,
            });
          } else {
            sendResponse({
              success: true,
              type: "GET_ALL_VECTORS_COMPLETE",
              payload: null,
            });
          }
          break;

        case "CLEAR_STORAGE":
          await opfsHandler.deleteSelf();
          opfsIsInitialized = false;
          vectorBuffer = null;
          vectorCount = 0;
          await initializeOpfs();
          sendResponse({ success: true, type: "CLEAR_COMPLETE" });
          break;

        case "DOWNLOAD_FILE":
          const fileSize = await opfsHandler.getSize();
          if (fileSize > 0) {
            const fileBuffer = new ArrayBuffer(fileSize);
            await opfsHandler.read(fileBuffer, 0);
            sendResponse({ success: true, type: "DOWNLOAD_COMPLETE", payload: fileBuffer });
          } else {
            sendResponse({ success: true, type: "DOWNLOAD_COMPLETE", payload: null });
          }
          break;

        default:
          console.warn("Unknown message type received in offscreen document:", type);
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (error) {
      console.error(`Error processing ${type}:`, error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
      sendResponse({ success: false, error: errorMessage });
    }
  })();

  return true; // Indicate async response
});
