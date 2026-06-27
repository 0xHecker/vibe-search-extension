/**
 * Preserves caller-supplied order and appends available IDs that were not
 * supplied. A Set is used only for membership, so duplicate/unknown supplied
 * IDs retain the same observable behavior as the prior Array.includes logic.
 */
export const appendUnorderedIds = (
  orderedIds: readonly string[],
  availableIds: readonly string[]
): string[] => {
  const suppliedIds = new Set(orderedIds);
  return [...orderedIds, ...availableIds.filter((id) => !suppliedIds.has(id))];
};
