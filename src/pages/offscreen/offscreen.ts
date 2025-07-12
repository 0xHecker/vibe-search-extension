import { pipeline, FeatureExtractionPipeline } from "@xenova/transformers";

// A single, top-level promise to manage the initialization state.
let initializationPromise: Promise<any> | null = null;
let embeddingPipeline: FeatureExtractionPipeline | null = null;

const sentences = [
  "The quick brown fox jumps over the lazy dog.",
  "A stitch in time saves nine.",
  "Actions speak louder than words.",
  "All that glitters is not gold.",
  "The early bird catches the worm.",
  "An apple a day keeps the doctor away.",
  "Beauty is in the eye of the beholder.",
  "Don't count your chickens before they hatch.",
  "Every cloud has a silver lining.",
  "Fortune favors the bold.",
  "Honesty is the best policy.",
  "If it ain't broke, don't fix it.",
  "Laughter is the best medicine.",
  "The pen is mightier than the sword.",
  "There's no place like home.",
  "Two heads are better than one.",
  "When in Rome, do as the Romans do.",
  "You can't judge a book by its cover.",
  "Practice makes perfect.",
  "Where there's a will, there's a way.",
];

const initialize = async () => {
  // This function will only be executed once.
  console.log("Initializing Offscreen Document...");

  // 1. Initialize the embedding pipeline first.
  embeddingPipeline = await pipeline("feature-extraction", "Xenova/jina-embeddings-v2-small-en", {
    progress_callback: undefined,
    config: {
      quantized: false,
      useWorker: false,
    },
  });

  const generatedEmbeddings = await embedSentences();
  console.log("Generated embeddings:", generatedEmbeddings);
  return generatedEmbeddings;
};

const embedSentences = async () => {
  if (!embeddingPipeline) {
    throw new Error("Embedding pipeline not ready");
  }
  console.log("Embedding sentences...");
  const embeddings = [];
  for (const sentence of sentences) {
    const embedding = await embeddingPipeline(sentence, {
      pooling: "mean",
      normalize: true,
    });
    const vector = Array.from(embedding.data as Float32Array);
    embeddings.push({
      sentence,
      vector,
    });
  }
  return embeddings;
};

// The main message handler for the offscreen document
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, target } = message;

  if (target !== "offscreen") {
    return;
  }

  (async () => {
    try {
      switch (type) {
        case "INITIALIZE":
          if (!initializationPromise) {
            initializationPromise = initialize();
          }
          const embeddings = await initializationPromise;
          sendResponse({
            success: true,
            type: "INITIALIZED",
            payload: embeddings,
          });
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

  // Return true to indicate that the response will be sent asynchronously.
  return true;
});
