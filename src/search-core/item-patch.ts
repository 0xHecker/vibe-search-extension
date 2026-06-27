import type { ItemDocType } from "@src/schemas/item_schema";

/**
 * Keep list order and untouched object identities stable when background work
 * enriches only a few visible items.
 */
export const mergeItemsById = (
  currentItems: readonly ItemDocType[],
  updatedItems: readonly ItemDocType[]
): ItemDocType[] => {
  if (currentItems.length === 0 || updatedItems.length === 0) return currentItems as ItemDocType[];

  const updatesById = new Map(updatedItems.map((item) => [item.id, item]));
  let changed = false;
  const nextItems = currentItems.map((item) => {
    const update = updatesById.get(item.id);
    if (!update) return item;
    changed = true;
    return update;
  });

  return changed ? nextItems : (currentItems as ItemDocType[]);
};
