import { pipeline, FeatureExtractionPipeline } from "@xenova/transformers";
import { VECTOR_DIMENSION } from "@src/common/constants";

class EmbeddingService {
  [key: string]: any;
  private pipeline: FeatureExtractionPipeline | null = null;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  private async initialize(): Promise<FeatureExtractionPipeline> {
    if (this.pipeline) {
      return this.pipeline;
    }
    if (!this.pipelinePromise) {
      console.log("Initializing embedding pipeline...");
      this.pipelinePromise = pipeline("feature-extraction", "Xenova/jina-embeddings-v2-small-en", {
        quantized: false,
        // @ts-ignore
        useWorker: false,
      }) as Promise<FeatureExtractionPipeline>;
    }
    this.pipeline = await this.pipelinePromise;
    console.log("Embedding pipeline initialized.");
    return this.pipeline;
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
    return embeddings.data as Float32Array;
  };
}

export const embeddingService = new EmbeddingService();
