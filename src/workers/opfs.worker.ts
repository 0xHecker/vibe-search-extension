import { OpfsHandler } from "@src/services/vector-store/opfs-handler";
import { VECTOR_DIMENSION } from "@src/common/constants";

const opfsHandler = new OpfsHandler();

// File structure constants
const MAGIC_NUMBER = 0x56494245;
const VERSION = 1;
const HEADER_SIZE = 16;

// Worker state
let isInitialized = false;
let vectorDimension = 0;
let vectorCount = 0;
let vectorBuffer: ArrayBuffer | null = null;

async function initialize() {
  await opfsHandler.open("vectors.bin");
  const fileSize = opfsHandler.getSize();

  if (fileSize < HEADER_SIZE) {
    vectorDimension = VECTOR_DIMENSION;
    vectorCount = 0;
    const header = new ArrayBuffer(HEADER_SIZE);
    const headerView = new DataView(header);
    headerView.setUint32(0, MAGIC_NUMBER, true);
    headerView.setUint32(4, VERSION, true);
    headerView.setUint32(8, vectorDimension, true);
    headerView.setUint32(12, vectorCount, true);
    opfsHandler.write(header, 0);
    opfsHandler.flush();
    vectorBuffer = new ArrayBuffer(0);
  } else {
    const header = new ArrayBuffer(HEADER_SIZE);
    opfsHandler.read(header, 0);
    const headerView = new DataView(header);
    const magic = headerView.getUint32(0, true);
    if (magic !== MAGIC_NUMBER) throw new Error("Invalid file format.");

    const fileDimension = headerView.getUint32(8, true);
    if (fileDimension !== VECTOR_DIMENSION) {
      opfsHandler.truncate();
      return initialize();
    }
    vectorDimension = fileDimension;
    vectorCount = headerView.getUint32(12, true);
    const bodySize = vectorCount * vectorDimension * 4;
    if (fileSize - HEADER_SIZE !== bodySize) throw new Error("File corrupt.");

    vectorBuffer = new ArrayBuffer(bodySize);
    if (bodySize > 0) {
      opfsHandler.read(vectorBuffer, HEADER_SIZE);
    }
  }
  isInitialized = true;
  console.log(`OPFS Worker Initialized. Dimension: ${vectorDimension}, Count: ${vectorCount}`);
}

async function addVectors(newVectorsBuffer: Float32Array) {
  if (!vectorBuffer) throw new Error("Vector buffer not initialized.");
  if (newVectorsBuffer.length % vectorDimension !== 0) {
    throw new Error(`Invalid buffer size.`);
  }

  const newVectorCount = newVectorsBuffer.length / vectorDimension;
  const bytesPerVector = vectorDimension * 4;
  const appendOffset = HEADER_SIZE + vectorCount * bytesPerVector;

  opfsHandler.write(newVectorsBuffer.buffer, appendOffset);
  opfsHandler.flush();

  const newTotalCount = vectorCount + newVectorCount;
  const countBuffer = new ArrayBuffer(4);
  new DataView(countBuffer).setUint32(0, newTotalCount, true);
  opfsHandler.write(countBuffer, 12);
  opfsHandler.flush();

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

self.onmessage = async (event: MessageEvent) => {
  try {
    if (!isInitialized) {
      await initialize();
    }

    const { type, payload } = event.data;

    switch (type) {
      case "ADD_VECTORS":
        await addVectors(payload);
        self.postMessage({ success: true, type: "ADD_VECTORS_COMPLETE", count: vectorCount });
        break;
      case "GET_VECTOR_COUNT":
        self.postMessage({ success: true, type: "GET_VECTOR_COUNT_COMPLETE", count: vectorCount });
        break;
      case "CLEAR_STORAGE":
        await opfsHandler.deleteSelf();
        isInitialized = false;
        await initialize();
        self.postMessage({ success: true, type: "CLEAR_COMPLETE" });
        break;
      case "DOWNLOAD_FILE":
        const fileSize = opfsHandler.getSize();
        if (fileSize > 0) {
          const fileBuffer = new ArrayBuffer(fileSize);
          opfsHandler.read(fileBuffer, 0);
          self.postMessage(
            { success: true, type: "DOWNLOAD_COMPLETE", payload: fileBuffer },
            { transfer: [fileBuffer] }
          );
        } else {
          self.postMessage({ success: true, type: "DOWNLOAD_COMPLETE", payload: null });
        }
        break;
      case "GET_ALL_VECTORS":
        const bufferCopy = vectorBuffer?.slice(0);
        self.postMessage(
          { success: true, type: "GET_ALL_VECTORS_COMPLETE", payload: bufferCopy },
          { transfer: [bufferCopy as ArrayBuffer] }
        );
        break;
      default:
        self.postMessage({ success: false, error: "Unknown message type" });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    self.postMessage({ success: false, error: errorMessage });
  }
};
