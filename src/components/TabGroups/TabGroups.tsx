import { TabGroup } from "@components/TabGroups/TabGroup";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";
import { TooltipProvider } from "../ui/tooltip";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ViewToggle } from "./ViewToggle";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { QueryRankDebugScore } from "@src/search-core/contracts";

export type SpaceMoveOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  access?: {
    isUnlocked?: boolean;
  };
};

interface TabGroupsProps {
  folders: FolderDocType[];
  items: ItemDocType[];
  spaces: SpaceMoveOption[];
  preserveInputOrder?: boolean;
  debugScoresByItemId?: Record<string, QueryRankDebugScore>;
  showDebugScores?: boolean;
}

const VIEW_STORAGE_KEY = "vibe-search-view-mode";

const TabGroupsComponent = ({
  folders,
  items,
  spaces,
  preserveInputOrder = false,
  debugScoresByItemId,
  showDebugScores = false,
}: TabGroupsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sentForFetch, setSentForFetch] = useState(new Set<string>());
  const [itemsState, setItemsState] = useState<ItemDocType[]>(items);
  const [foldersState, setFoldersState] = useState<FolderDocType[]>(folders);
  const [activeDrag, setActiveDrag] = useState<
    | { type: "item"; ids: string[]; item: ItemDocType; sourceFolderId: string }
    | { type: "folder"; folder: FolderDocType }
    | null
  >(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  // Initialize from localStorage
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "grid" || stored === "list") return stored;
    } catch {}
    return "list";
  });

  // Persist view mode to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    } catch {}
  }, [viewMode]);

  useEffect(() => {
    setItemsState(items);
  }, [items]);

  const itemsNeedingMeta = useMemo(() => {
    return new Set(items.filter((i) => !i.isMetaFetched).map((i) => i.url));
  }, [items]);

  const sortFolders = (list: FolderDocType[]) =>
    [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.createdAt - b.createdAt;
    });

  useEffect(() => {
    setFoldersState(sortFolders(folders));
  }, [folders]);

  const orderedFolders = useMemo(() => sortFolders(foldersState), [foldersState]);

  const orderedItemsForFolder = (folderId: string, sourceItems: ItemDocType[] = itemsState) => {
    const folderItems = sourceItems.filter((i) => i.folderId === folderId);
    if (preserveInputOrder) {
      return folderItems;
    }
    return [...folderItems].sort((a, b) => {
      const ao = a.chunkOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.chunkOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return b.createdAt - a.createdAt;
    });
  };

  // Use ref to track sent URLs to avoid effect re-runs causing observer churn
  const sentForFetchRef = useRef(sentForFetch);
  sentForFetchRef.current = sentForFetch;

  useEffect(() => {
    const root = containerRef.current || null;
    if (itemsNeedingMeta.size === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisible: string[] = [];
        for (const entry of entries) {
          const url = (entry.target as HTMLElement).dataset["url"];
          if (!url) continue;

          // Check if the item needs metadata and hasn't been sent for fetching yet.
          if (
            entry.isIntersecting &&
            itemsNeedingMeta.has(url) &&
            !sentForFetchRef.current.has(url)
          ) {
            newlyVisible.push(url);
          }
        }

        if (newlyVisible.length > 0) {
          // Optimistically mark as sent to prevent re-sending.
          setSentForFetch((prev) => new Set([...prev, ...newlyVisible]));
          try {
            chrome.runtime.sendMessage({
              target: "background",
              type: "FETCH_METADATA",
              payload: { urls: newlyVisible },
            });
          } catch (e) {
            console.warn(
              "Failed to send metadata fetch request, will retry on next visibility.",
              e
            );
            // If sending fails, remove from the sent set so it can be picked up again.
            setSentForFetch((prev) => {
              const next = new Set(prev);
              newlyVisible.forEach((u) => next.delete(u));
              return next;
            });
          }
        }
      },
      { root: root, rootMargin: "600px 0px", threshold: 0.01 }
    );

    const nodes = (root || document).querySelectorAll<HTMLElement>('[data-observe="item"]');
    nodes.forEach((n) => observer.observe(n));

    return () => observer.disconnect();
  }, [itemsNeedingMeta]); // Removed sentForFetch from deps to prevent observer churn

  const handleFolderReorder = async (activeId: string, overId: string) => {
    let nextIds: string[] = [];
    let spaceId: string | undefined;
    setFoldersState((prev) => {
      const uniqueSpaceIds = new Set(prev.map((folder) => folder.spaceId));
      if (uniqueSpaceIds.size > 1) return prev;
      const ids = prev.map((f) => f.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      nextIds = arrayMove(ids, oldIndex, newIndex);
      const lookup = new Map(prev.map((f) => [f.id, f]));
      const first = prev[0];
      spaceId = first?.spaceId;
      return nextIds.map((id) => lookup.get(id)!).filter(Boolean);
    });
    if (nextIds.length > 0) {
      try {
        await chrome.runtime.sendMessage({
          service: "folders",
          type: "reorder",
          target: "offscreen",
          payload: { orderedIds: nextIds, spaceId },
        });
      } catch (e) {
        console.error("Failed to persist folder order", e);
      }
    }
  };

  const persistItemOrder = async (
    foldersToUpdate: { folderId: string; orderedIds: string[] }[]
  ) => {
    if (foldersToUpdate.length === 0) return;
    try {
      await chrome.runtime.sendMessage({
        service: "items",
        type: "reorder",
        target: "offscreen",
        payload: { folders: foldersToUpdate },
      });
    } catch (e) {
      console.error("Failed to persist item order", e);
    }
  };

  const reorderWithinFolder = async (folderId: string, activeId: string, overId: string) => {
    let nextIds: string[] = [];
    setItemsState((prev) => {
      const list = orderedItemsForFolder(folderId, prev);
      const ids = list.map((i) => i.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      nextIds = arrayMove(ids, oldIndex, newIndex);
      const orderMap = new Map<string, { folderId: string; chunkOrder: number }>();
      nextIds.forEach((id, idx) => orderMap.set(id, { folderId, chunkOrder: idx }));
      return prev.map((item) => {
        const update = orderMap.get(item.id);
        return update ? { ...item, ...update } : item;
      });
    });
    if (nextIds.length > 0) {
      persistItemOrder([{ folderId, orderedIds: nextIds }]);
    }
  };

  const moveItems = async (
    ids: string[],
    sourceFolderId: string,
    targetFolderId: string,
    overId?: string
  ) => {
    let sourceIds: string[] = [];
    let targetIds: string[] = [];
    setItemsState((prev) => {
      const sourceList = orderedItemsForFolder(sourceFolderId, prev).map((i) => i.id);
      const targetList = orderedItemsForFolder(targetFolderId, prev).map((i) => i.id);
      sourceIds = sourceList.filter((id) => !ids.includes(id));
      targetIds = targetList.filter((id) => !ids.includes(id));
      const insertionIndex =
        overId && targetIds.includes(overId) ? targetIds.indexOf(overId) : targetIds.length;
      targetIds.splice(insertionIndex, 0, ...ids);

      const updates = new Map<string, { folderId: string; chunkOrder: number }>();
      sourceIds.forEach((id, idx) =>
        updates.set(id, { folderId: sourceFolderId, chunkOrder: idx })
      );
      targetIds.forEach((id, idx) =>
        updates.set(id, { folderId: targetFolderId, chunkOrder: idx })
      );

      return prev.map((item) => {
        const update = updates.get(item.id);
        return update ? { ...item, ...update } : item;
      });
    });

    persistItemOrder([
      { folderId: sourceFolderId, orderedIds: sourceIds },
      { folderId: targetFolderId, orderedIds: targetIds },
    ]);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as any;
    if (data?.type === "folder") {
      setActiveDrag({ type: "folder", folder: data.folder as FolderDocType });
      return;
    }
    if (data?.type === "item") {
      const selectedIds: string[] =
        data?.selectedIds && Array.isArray(data.selectedIds) && data.selectedIds.length > 0
          ? Array.from(new Set(data.selectedIds))
          : [data.item.id];
      setActiveDrag({
        type: "item",
        ids: selectedIds,
        item: data.item as ItemDocType,
        sourceFolderId: data.folderId as string,
      });
    }
  };

  const resolveTargetFolder = (over: DragEndEvent["over"]) => {
    if (!over) return null;
    const overData = over.data.current as any;
    if (overData?.type === "item") return overData.folderId as string;
    if (overData?.type === "folder-drop") return overData.folderId as string;
    if (overData?.type === "folder") return overData.folder.id as string;
    return null;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      setActiveDrag(null);
      return;
    }
    const activeData = active.data.current as any;
    const overData = over.data.current as any;

    if (activeData?.type === "folder" && overData?.type === "folder") {
      handleFolderReorder(active.id as string, over.id as string);
      setActiveDrag(null);
      return;
    }

    if (activeData?.type === "item") {
      const targetFolderId = resolveTargetFolder(over);
      const sourceFolderId = activeData.folderId as string;
      if (!targetFolderId) {
        setActiveDrag(null);
        return;
      }
      const idsToMove =
        activeDrag?.type === "item" && activeDrag.ids.length > 0
          ? activeDrag.ids
          : [activeData.item.id];

      if (targetFolderId === sourceFolderId && overData?.type === "item") {
        reorderWithinFolder(sourceFolderId, active.id as string, over.id as string);
      } else {
        moveItems(
          idsToMove,
          sourceFolderId,
          targetFolderId,
          overData?.type === "item" ? (over.id as string) : undefined
        );
      }
    }
    setActiveDrag(null);
  };

  const handleDragCancel = () => setActiveDrag(null);

  return (
    <TooltipProvider>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div ref={containerRef} className="w-full h-fit max-w-[1090px] mx-auto mt-14 pb-14">
          {/* Master view toggle at top right */}
          <div className="flex justify-end mb-4 px-4">
            <ViewToggle view={viewMode} onViewChange={setViewMode} />
          </div>

          <SortableContext
            items={orderedFolders.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-4">
              {orderedFolders.map((folder) => {
                const folderItems = orderedItemsForFolder(folder.id);
                return (
                  <TabGroup
                    key={folder.id}
                    folder={folder}
                    items={folderItems}
                    allFolders={orderedFolders}
                    spaces={spaces}
                    viewMode={viewMode}
                    debugScoresByItemId={debugScoresByItemId}
                    showDebugScores={showDebugScores}
                  />
                );
              })}
            </div>
          </SortableContext>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag?.type === "item" && activeDrag.item ? (
            <div className="min-w-[260px] max-w-[360px] rounded-xl bg-background-neutral shadow-2xl shadow-black/20 border border-border-neutral-faded p-3">
              <p className="text-sm font-semibold text-foreground-neutral line-clamp-2">
                {activeDrag.ids.length > 1
                  ? `${activeDrag.ids.length} tabs selected`
                  : activeDrag.item.title}
              </p>
              <p className="text-xs text-foreground-secondary line-clamp-1 mt-1">
                {activeDrag.item.url}
              </p>
            </div>
          ) : activeDrag?.type === "folder" ? (
            <div className="min-w-[320px] rounded-xl bg-background-neutral shadow-2xl shadow-black/25 border border-border-neutral-faded px-4 py-3">
              <div className="text-lg font-semibold text-foreground-neutral">
                {activeDrag.folder.name}
              </div>
              <div className="text-xs text-foreground-secondary">
                {activeDrag.folder.isPinned ? "Pinned group" : "Tab group"}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </TooltipProvider>
  );
};

export const TabGroups = memo(TabGroupsComponent);
