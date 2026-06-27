import type { ItemDocType } from "@src/schemas/item_schema";

type VectorReferenceSource = Pick<ItemDocType, "vector_index" | "vector_indexes">;

export const getVectorIndexes = (item: VectorReferenceSource): number[] => {
  const indexes = Array.isArray(item.vector_indexes) ? item.vector_indexes : [];
  const validIndexes = indexes.filter(
    (index): index is number => Number.isInteger(index) && index >= 0
  );
  const fallbackIndex = item.vector_index;
  if (
    validIndexes.length === 0 &&
    typeof fallbackIndex === "number" &&
    Number.isInteger(fallbackIndex) &&
    fallbackIndex >= 0
  ) {
    validIndexes.push(fallbackIndex);
  }
  return Array.from(new Set(validIndexes));
};

export const hasVectorReference = (item: VectorReferenceSource): boolean => getVectorIndexes(item).length > 0;

export const hasEmbeddableText = (
  item: Pick<ItemDocType, "title" | "textContent" | "ocrText" | "url">
): boolean =>
  [item.title, item.textContent, item.ocrText, item.url].some(
    (value) => typeof value === "string" && value.trim().length > 0
  );

/**
 * Metadata completion is the shared admission gate for item embeddings. Imports
 * may fill data differently, but none may embed before this is true.
 */
export const isMetadataReadyForEmbedding = (item: Pick<ItemDocType, "isMetaFetched">): boolean =>
  item.isMetaFetched === true;
