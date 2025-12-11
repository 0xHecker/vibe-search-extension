import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { ItemDocType } from "@src/schemas/item_schema";

interface SelectionContextType {
  selectedIds: Set<string>;
  isSelectionMode: boolean;
  selectItem: (id: string) => void;
  deselectItem: (id: string) => void;
  toggleItem: (id: string) => void;
  selectAll: (items: ItemDocType[]) => void;
  deselectAll: () => void;
  toggleSelectAll: (items: ItemDocType[]) => void;
  isSelected: (id: string) => boolean;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  selectedCount: number;
  getSelectedItems: (allItems: ItemDocType[]) => ItemDocType[];
}

const SelectionContext = createContext<SelectionContextType | null>(null);

export const useSelection = () => {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return context;
};

export const SelectionProvider = ({ children }: { children: ReactNode }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const selectItem = useCallback((id: string) => {
    setSelectedIds((prev) => new Set([...prev, id]));
    setIsSelectionMode(true);
  }, []);

  const deselectItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      if (next.size === 0) {
        setIsSelectionMode(false);
      }
      return next;
    });
  }, []);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 0) {
        setIsSelectionMode(false);
      } else {
        setIsSelectionMode(true);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((items: ItemDocType[]) => {
    setSelectedIds(new Set(items.map((item) => item.id)));
    setIsSelectionMode(true);
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const toggleSelectAll = useCallback((items: ItemDocType[]) => {
    setSelectedIds((prev) => {
      const allSelected = items.every((item) => prev.has(item.id));
      if (allSelected) {
        setIsSelectionMode(false);
        return new Set();
      } else {
        setIsSelectionMode(true);
        return new Set(items.map((item) => item.id));
      }
    });
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const getSelectedItems = useCallback(
    (allItems: ItemDocType[]) => {
      return allItems.filter((item) => selectedIds.has(item.id));
    },
    [selectedIds]
  );

  return (
    <SelectionContext.Provider
      value={{
        selectedIds,
        isSelectionMode,
        selectItem,
        deselectItem,
        toggleItem,
        selectAll,
        deselectAll,
        toggleSelectAll,
        isSelected,
        enterSelectionMode,
        exitSelectionMode,
        selectedCount: selectedIds.size,
        getSelectedItems,
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
};
