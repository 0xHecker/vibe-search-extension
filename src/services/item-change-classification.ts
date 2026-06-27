const EMBEDDING_STATE_FIELDS = new Set(["vector_index", "vector_indexes", "isEmbedded", "isDirty"]);
const METADATA_ENRICHMENT_FIELDS = new Set([
  "title",
  "textContent",
  "iconUrl",
  "displayImageUrl",
  "source",
  "authorUsername",
  "media",
  "isMetaFetched",
  "isDirty",
  "isEmbedded",
  "ocrText",
  "ocrStatus",
  "ocrError",
  "ocrModelVersion",
  "ocrSourceHash",
  "ocrUpdatedAt",
  "ocrConfidence",
  "ocrLineCount",
]);
const RXDB_INTERNAL_FIELDS = new Set(["_attachments", "_deleted", "_meta", "_rev"]);
const PERSISTED_TIMESTAMP_FIELD = "updatedAt";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const areEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => areEqual(value, right[index]));
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && areEqual(left[key], right[key]))
    );
  }

  return false;
};

const isEmbeddingStateOnlyUpdate = (event: unknown): boolean => {
  if (!isRecord(event) || event.operation !== "UPDATE") return false;

  const previous = event.previousDocumentData;
  const current = event.documentData;
  if (!isRecord(previous) || !isRecord(current)) return false;

  let hasEmbeddingStateChange = false;
  const fields = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const field of fields) {
    if (RXDB_INTERNAL_FIELDS.has(field) || areEqual(previous[field], current[field])) continue;
    if (!EMBEDDING_STATE_FIELDS.has(field)) return false;
    hasEmbeddingStateChange = true;
  }

  return hasEmbeddingStateChange;
};

const isMetadataEnrichmentUpdate = (event: unknown): boolean => {
  if (!isRecord(event) || event.operation !== "UPDATE") return false;

  const previous = event.previousDocumentData;
  const current = event.documentData;
  if (!isRecord(previous) || !isRecord(current)) return false;

  let hasMetadataChange = false;
  const fields = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const field of fields) {
    if (
      RXDB_INTERNAL_FIELDS.has(field) ||
      field === PERSISTED_TIMESTAMP_FIELD ||
      areEqual(previous[field], current[field])
    ) {
      continue;
    }
    if (!METADATA_ENRICHMENT_FIELDS.has(field)) return false;
    hasMetadataChange = true;
  }

  return hasMetadataChange;
};

const isOnlyStateFieldUpdate = (event: unknown, stateField: string): boolean => {
  if (!isRecord(event) || event.operation !== "UPDATE") return false;

  const previous = event.previousDocumentData;
  const current = event.documentData;
  if (!isRecord(previous) || !isRecord(current)) return false;

  let changedStateField = false;
  const fields = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const field of fields) {
    if (RXDB_INTERNAL_FIELDS.has(field) || field === PERSISTED_TIMESTAMP_FIELD) continue;
    if (areEqual(previous[field], current[field])) continue;
    if (field !== stateField) return false;
    changedStateField = true;
  }

  return changedStateField;
};

const isOnlyCollapsedStateChange = (changeEvent: unknown): boolean => {
  if (!isRecord(changeEvent)) return false;
  const events = Array.isArray(changeEvent.events) ? changeEvent.events : [changeEvent];
  return events.length > 0 && events.every((event) => isOnlyStateFieldUpdate(event, "isCollapsed"));
};

/**
 * Vector bookkeeping does not change any content indexed by FlexSearch or shown
 * in the grid, so its RxDB events should stay out of the UI refresh path.
 */
export const isEmbeddingStateOnlyItemChange = (changeEvent: unknown): boolean => {
  if (!isRecord(changeEvent)) return false;

  const events = Array.isArray(changeEvent.events) ? changeEvent.events : [changeEvent];
  return events.length > 0 && events.every(isEmbeddingStateOnlyUpdate);
};

/**
 * Metadata and OCR enrich an existing item without changing its space,
 * folder, or deletion state. The UI can patch visible rows instead of
 * replacing the entire query result.
 */
export const isMetadataEnrichmentItemChange = (changeEvent: unknown): boolean => {
  if (!isRecord(changeEvent)) return false;
  const events = Array.isArray(changeEvent.events) ? changeEvent.events : [changeEvent];
  return events.length > 0 && events.every(isMetadataEnrichmentUpdate);
};

/**
 * Collapse is presentation state. It must not invalidate folder contents,
 * search results, tags, or metadata work.
 */
export const isFolderCollapseOnlyChange = isOnlyCollapsedStateChange;

/**
 * Space-group collapse only changes sidebar presentation. Avoid turning its
 * persistence write into a complete search-page refresh.
 */
export const isSpaceGroupCollapseOnlyChange = isOnlyCollapsedStateChange;
