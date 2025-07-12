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
    const embeddingPipeline = await this.initialize();

    console.log(`Embedding ${sentences.length} sentences...`);
    const combinedVectorArray = new Float32Array(sentences.length * VECTOR_DIMENSION);

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const embedding = await embeddingPipeline(sentence, {
        pooling: "mean",
        normalize: true,
      });
      combinedVectorArray.set(embedding.data as Float32Array, i * VECTOR_DIMENSION);
    }

    console.log("Embeddings generated.");
    return combinedVectorArray;
  };
}

export const embeddingService = new EmbeddingService();
