// The dimension of the vectors produced by the embedding model.
// Model: onnx-community/mdbr-leaf-ir-ONNX (MongoDB/mdbr-leaf-ir).
// The ONNX graph bakes in mean pooling + a 384->768 Dense projection + L2
// normalization and exposes a `sentence_embedding` output, so the final
// embedding is 768-dimensional. Changing this value triggers an automatic
// reset of the on-disk vector store (see VectorStoreService.loadVectorFile,
// which compares this against the dimension stored in the file header).
export const VECTOR_DIMENSION = 768;
