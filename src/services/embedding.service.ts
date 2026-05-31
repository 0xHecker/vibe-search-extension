import { pipeline, FeatureExtractionPipeline } from "@xenova/transformers";
import { VECTOR_DIMENSION } from "@src/common/constants";

class EmbeddingService {
  [key: string]: any;
  private pipeline: FeatureExtractionPipeline | null = null;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
  private consecutiveInitFailures = 0;
  private initCircuitOpenUntil = 0;
  private readonly MODEL_ID = "Xenova/jina-embeddings-v2-small-en";
  private readonly INIT_ATTEMPTS = [
    { quantized: false, label: "primary" },
    { quantized: false, label: "retry" },
    { quantized: true, label: "quantized-fallback" },
  ] as const;
  private readonly INIT_RETRY_BASE_DELAY_MS = 500;
  private readonly INIT_CIRCUIT_OPEN_MS = 30_000;

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async initializeWithRetry(): Promise<FeatureExtractionPipeline> {
    let lastError: unknown = null;

    for (let i = 0; i < this.INIT_ATTEMPTS.length; i++) {
      const attempt = this.INIT_ATTEMPTS[i];
      try {
        console.log(`Initializing embedding pipeline (${attempt.label})...`);
        const model = (await pipeline("feature-extraction", this.MODEL_ID, {
          quantized: attempt.quantized,
          // @ts-ignore
          useWorker: false,
        })) as FeatureExtractionPipeline;
        this.pipeline = model;
        this.consecutiveInitFailures = 0;
        this.initCircuitOpenUntil = 0;
        console.log("Embedding pipeline initialized.");
        return model;
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : "unknown initialization error";
        console.warn(
          `[EmbeddingService] Initialization attempt ${i + 1}/${this.INIT_ATTEMPTS.length} failed (${attempt.label}): ${errorMessage}`
        );
        if (i < this.INIT_ATTEMPTS.length - 1) {
          const delay = this.INIT_RETRY_BASE_DELAY_MS * (i + 1);
          await this.sleep(delay);
        }
      }
    }

    this.consecutiveInitFailures += 1;
    if (this.consecutiveInitFailures >= 2) {
      this.initCircuitOpenUntil = Date.now() + this.INIT_CIRCUIT_OPEN_MS;
    }

    throw new Error(
      `Failed to initialize embedding pipeline after ${this.INIT_ATTEMPTS.length} attempts: ${
        lastError instanceof Error ? lastError.message : "unknown error"
      }`
    );
  }

  private async initialize(): Promise<FeatureExtractionPipeline> {
    if (this.pipeline) {
      return this.pipeline;
    }

    if (Date.now() < this.initCircuitOpenUntil) {
      const retryInMs = this.initCircuitOpenUntil - Date.now();
      throw new Error(
        `Embedding model is temporarily unavailable. Retry in ${Math.ceil(retryInMs / 1000)}s.`
      );
    }

    if (!this.pipelinePromise) {
      this.pipelinePromise = this.initializeWithRetry().finally(() => {
        this.pipelinePromise = null;
      });
    }

    return this.pipelinePromise;
  }

  public generateEmbeddings = async (payload: { sentences: string[] }): Promise<Float32Array> => {
    const { sentences } = payload;
    if (sentences.length === 0) {
      return new Float32Array();
    }
    const embeddingPipeline = await this.initialize();

    console.log(`Embedding a batch of ${sentences.length} sentences...`);

    const embeddings = await embeddingPipeline(sentences, {
      pooling: "mean",
      normalize: true,
    });

    console.log("Embeddings generated.");
    // The result is a single Tensor, so we can just return its data.
    const data = embeddings.data as Float32Array;
    const expectedLength = sentences.length * VECTOR_DIMENSION;
    if (data.length !== expectedLength) {
      throw new Error(
        `Embedding output shape mismatch. Expected ${expectedLength}, received ${data.length}.`
      );
    }
    return data;
  };
}

export const embeddingService = new EmbeddingService();
