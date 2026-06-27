import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { ItemDocType } from "@src/schemas/item_schema";

interface SelectionContextType {
  selectedIds: Set<string>;
  isSelectionMode: boolean;
  selectItem: (item: ItemDocType) => void;
  deselectItem: (id: string) => void;
  toggleItem: (item: ItemDocType) => void;
  toggleSelectAll: (items: ItemDocType[]) => void;
  deselectAll: () => void;
  isSelected: (id: string) => boolean;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  selectedCount: number;
  getSelectedItems: () => ItemDocType[];
}

const SelectionContext = createContext<SelectionContextType | null>(null);

export const useSelection = () => {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return context;
};

/**
 * App-level selection store. It keeps the full selected item objects (not just
 * ids) so the floating bulk-actions bar can act on tabs even after you navigate
 * to a different space — the selection persists across spaces and space groups
 * until you clear it, reload, or close.
 */
export const SelectionProvider = ({ children }: { children: ReactNode }) => {
  const [selected, setSelected] = useState<Map<string, ItemDocType>>(new Map());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const selectItem = useCallback((item: ItemDocType) => {
    setSelected((prev) => {
      if (prev.has(item.id)) return prev;
      const next = new Map(prev);
      next.set(item.id, item);
      return next;
    });
    setIsSelectionMode(true);
  }, []);

  const deselectItem = useCallback((id: string) => {
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      if (next.size === 0) setIsSelectionMode(false);
      return next;
    });
  }, []);

  const toggleItem = useCallback((item: ItemDocType) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, item);
      }
      setIsSelectionMode(next.size > 0);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((items: ItemDocType[]) => {
    setSelected((prev) => {
      const allSelected = items.length > 0 && items.every((it) => prev.has(it.id));
      const next = new Map(prev);
      if (allSelected) {
        for (const it of items) next.delete(it.id);
      } else {
        for (const it of items) next.set(it.id, it);
      }
      setIsSelectionMode(next.size > 0);
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelected(new Map());
    setIsSelectionMode(false);
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const enterSelectionMode = useCallback(() => setIsSelectionMode(true), []);

  const exitSelectionMode = useCallback(() => {
    setSelected(new Map());
    setIsSelectionMode(false);
  }, []);

  const getSelectedItems = useCallback(() => Array.from(selected.values()), [selected]);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);

  const value = useMemo<SelectionContextType>(
    () => ({
      selectedIds,
      isSelectionMode,
      selectItem,
      deselectItem,
      toggleItem,
      toggleSelectAll,
      deselectAll,
      isSelected,
      enterSelectionMode,
      exitSelectionMode,
      selectedCount: selected.size,
      getSelectedItems,
    }),
    [
      selectedIds,
      isSelectionMode,
      selectItem,
      deselectItem,
      toggleItem,
      toggleSelectAll,
      deselectAll,
      isSelected,
      enterSelectionMode,
      exitSelectionMode,
      selected.size,
      getSelectedItems,
    ]
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
};
