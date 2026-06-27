import { expect, test } from "bun:test";
import {
  isEmbeddingStateOnlyItemChange,
  isMetadataEnrichmentItemChange,
} from "@src/services/item-change-classification";

const item = {
  id: "item-1",
  title: "Kept title",
  textContent: "Kept body",
  vector_index: -1,
  vector_indexes: [],
  isEmbedded: false,
  isDirty: true,
};

test("embedding state updates do not refresh the visible search or lexical index", () => {
  expect(
    isEmbeddingStateOnlyItemChange({
      events: [
        {
          operation: "UPDATE",
          previousDocumentData: item,
          documentData: {
            ...item,
            vector_index: 42,
            vector_indexes: [42],
            isEmbedded: true,
            isDirty: false,
          },
        },
      ],
    })
  ).toBe(true);
});

test("content edits remain visible to the search and lexical index", () => {
  expect(
    isEmbeddingStateOnlyItemChange({
      events: [
        {
          operation: "UPDATE",
          previousDocumentData: item,
          documentData: { ...item, title: "New title", isDirty: true },
        },
      ],
    })
  ).toBe(false);
});

test("metadata enrichment can patch visible rows without a complete query refresh", () => {
  expect(
    isMetadataEnrichmentItemChange({
      events: [
        {
          operation: "UPDATE",
          previousDocumentData: item,
          documentData: {
            ...item,
            title: "Fetched title",
            textContent: "Fetched description",
            isMetaFetched: true,
            updatedAt: 2,
          },
        },
      ],
    })
  ).toBe(true);
});

test("moves remain full content changes", () => {
  expect(
    isMetadataEnrichmentItemChange({
      operation: "UPDATE",
      previousDocumentData: { ...item, folderId: "folder-a" },
      documentData: { ...item, folderId: "folder-b" },
    })
  ).toBe(false);
});
