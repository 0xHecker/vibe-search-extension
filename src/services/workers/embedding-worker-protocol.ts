export type EmbeddingRequestPriority = "interactive" | "background";

export type EmbeddingWorkerRequest = {
  type: "EMBEDDING_REQUEST";
  requestId: number;
  priority: EmbeddingRequestPriority;
  payload: {
    sentences: string[];
  };
};

export type EmbeddingWorkerResponse =
  | {
      type: "EMBEDDING_RESULT";
      requestId: number;
      payload: {
        buffer: ArrayBuffer;
      };
    }
  | {
      type: "EMBEDDING_ERROR";
      requestId: number;
      error: string;
    };
