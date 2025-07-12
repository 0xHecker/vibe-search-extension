import { OpfsHandler } from "@src/services/vector-store/opfs-handler";

const opfsHandler = new OpfsHandler();
let isInitialized = false;

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  // Initialize on the first message
  if (!isInitialized) {
    try {
      await opfsHandler.open("embeddings.json");
      isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize OPFS handler in worker:", error);
      self.postMessage({ success: false, error: "Initialization failed" });
      return;
    }
  }

  try {
    switch (type) {
      case "WRITE": {
        const jsonString = JSON.stringify(payload);
        const textEncoder = new TextEncoder();
        const buffer = textEncoder.encode(jsonString).buffer;
        opfsHandler.write(buffer, 0);
        opfsHandler.flush();
        self.postMessage({ success: true, type: "WRITE_COMPLETE" });
        break;
      }
      case "READ": {
        const fileSize = opfsHandler.getSize();
        if (fileSize === 0) {
          self.postMessage({ success: true, type: "READ_COMPLETE", payload: [] });
          return;
        }
        const readBuffer = new ArrayBuffer(fileSize);
        opfsHandler.read(readBuffer, 0);
        const textDecoder = new TextDecoder();
        const readJsonString = textDecoder.decode(readBuffer);
        const opfsEmbeddings = JSON.parse(readJsonString);
        self.postMessage({
          success: true,
          type: "READ_COMPLETE",
          payload: opfsEmbeddings,
        });
        break;
      }
      default:
        console.warn("Unknown message type received in OPFS worker:", type);
        self.postMessage({ success: false, error: "Unknown message type" });
    }
  } catch (error) {
    console.error(`Error processing ${type} in OPFS worker:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    self.postMessage({ success: false, error: errorMessage });
  }
};
