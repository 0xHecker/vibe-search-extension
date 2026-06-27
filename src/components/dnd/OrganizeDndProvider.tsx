import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ItemDocType } from "@src/schemas/item_schema";
import type { FolderDocType } from "@src/schemas/folder_schema";
import { ConfirmDialog, type ConfirmDialogVariant } from "@src/components/ui/confirm-dialog";

/**
 * Unified drag-and-drop hub. Full rules: docs/drag-and-drop.md.
 *
 * Key rule: a tab group dropped ONTO another tab group MERGES into it — on both
 * the main results area and the sidebar. We never nest tab groups by drag,
 * because the main view renders groups flat and a drag-created hierarchy would
 * only show in the sidebar (confusing). Row edges reorder; the center
 * merges/moves/joins. High-impact drops (>20 tabs, cross-space, or any merge)
 * route through requestConfirmation (one shared confirm dialog).
 */

/**
 * A drop resolver inspects a finished drag and either handles it (returning
 * true) or passes (returning false) so another registered resolver can try.
 * Each draggable surface (main results area, sidebar, …) registers one.
 */
export type DragResolver = (event: DragEndEvent) => boolean;

/**
 * Prefer the droppable directly under the pointer — precise for the small,
 * scrollable sidebar rows and for nested/overlapping regions. Fall back to
 * closest-corners only when the pointer isn't inside any droppable (e.g.
 * dropping into a gap between rows).
 */
const organizeCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};

type ActiveDragData =
  | { type: "item"; item: ItemDocType; folderId: string; selectedIds?: string[] }
  | { type: "folder"; folder: FolderDocType }
  | ({ type: string } & Record<string, unknown>)
  | null;

export type ConfirmRequest = {
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: ConfirmDialogVariant;
  onConfirm: () => void | Promise<void>;
};

interface OrganizeDndApi {
  /** Register a drop resolver. Returns an unregister function. */
  registerResolver: (resolver: DragResolver) => () => void;
  /** Ask the user to confirm a high-impact drop before it runs. */
  requestConfirmation: (request: ConfirmRequest) => void;
}

const OrganizeDndContext = createContext<OrganizeDndApi | null>(null);

export const useOrganizeDnd = (): OrganizeDndApi => {
  const ctx = useContext(OrganizeDndContext);
  if (!ctx) {
    throw new Error("useOrganizeDnd must be used within an OrganizeDndProvider");
  }
  return ctx;
};

interface SpringExpandApi {
  /** True while a collapsed container is spring-loaded open during a drag. */
  isSpringOpen: (id: string) => boolean;
}

// Separate context so spring state (which changes mid-drag) only re-renders the
// container rows that read it — not every useOrganizeDnd consumer.
const SpringExpandContext = createContext<SpringExpandApi>({ isSpringOpen: () => false });

export const useSpringExpand = (): SpringExpandApi => useContext(SpringExpandContext);

/**
 * Hosts the single, app-wide dnd-kit context so that drags can travel between
 * the main results area and the sidebar. Surfaces register their own drop
 * logic via {@link useOrganizeDnd}; this provider owns the sensors, the
 * collision strategy, and the floating drag overlay.
 */
export const OrganizeDndProvider = ({ children }: { children: ReactNode }) => {
  // Resolvers are kept in a ref so registering one never re-renders the tree.
  const resolversRef = useRef<Set<DragResolver>>(new Set());
  const [activeData, setActiveData] = useState<ActiveDragData>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmRequest | null>(null);
  const [springOpenIds, setSpringOpenIds] = useState<Set<string>>(new Set());
  const springOpenIdsRef = useRef(springOpenIds);
  springOpenIdsRef.current = springOpenIds;
  const springTimerRef = useRef<number | null>(null);
  const springHoverIdRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const registerResolver = useCallback((resolver: DragResolver) => {
    resolversRef.current.add(resolver);
    return () => {
      resolversRef.current.delete(resolver);
    };
  }, []);

  const requestConfirmation = useCallback((request: ConfirmRequest) => {
    setPendingConfirm(request);
  }, []);

  const clearSpringTimer = useCallback(() => {
    if (springTimerRef.current !== null) {
      window.clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
    }
    springHoverIdRef.current = null;
  }, []);

  // Revert every container we auto-opened back to its prior collapsed state.
  const resetSpring = useCallback(() => {
    clearSpringTimer();
    setSpringOpenIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [clearSpringTimer]);

  const handleDragStart = (event: DragStartEvent) => {
    resetSpring();
    setActiveData((event.active.data.current as ActiveDragData) ?? null);
  };

  // Spring-loaded open: hovering a collapsed container (drop data carries
  // collapsed:true + a springId) for ~500ms expands it so you can drop inside.
  // Anything opened this way is reverted on drop/cancel via resetSpring.
  const handleDragOver = (event: DragOverEvent) => {
    const data = event.over?.data.current as { springId?: string; collapsed?: boolean } | undefined;
    const springId = data?.springId;
    if (!springId || data?.collapsed !== true || springOpenIdsRef.current.has(springId)) {
      clearSpringTimer();
      return;
    }
    if (springHoverIdRef.current === springId) return;
    clearSpringTimer();
    springHoverIdRef.current = springId;
    springTimerRef.current = window.setTimeout(() => {
      setSpringOpenIds((prev) => {
        const next = new Set(prev);
        next.add(springId);
        return next;
      });
      springTimerRef.current = null;
      springHoverIdRef.current = null;
    }, 500);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    for (const resolver of resolversRef.current) {
      try {
        if (resolver(event)) break;
      } catch (error) {
        console.error("[OrganizeDnd] drop resolver threw", error);
      }
    }
    setActiveData(null);
    resetSpring();
  };

  const handleDragCancel = () => {
    setActiveData(null);
    resetSpring();
  };

  // Context value is stable (only the registrar) so consumers never re-render
  // mid-drag. The overlay is driven by local state inside this provider.
  const api = useMemo<OrganizeDndApi>(
    () => ({ registerResolver, requestConfirmation }),
    [registerResolver, requestConfirmation]
  );

  const springApi = useMemo<SpringExpandApi>(
    () => ({ isSpringOpen: (id: string) => springOpenIds.has(id) }),
    [springOpenIds]
  );

  const itemData =
    activeData?.type === "item"
      ? (activeData as Extract<ActiveDragData, { type: "item" }>)
      : null;
  const folderData =
    activeData?.type === "folder"
      ? (activeData as Extract<ActiveDragData, { type: "folder" }>)
      : null;
  const selectedCount = itemData?.selectedIds?.length ?? 1;
  const sidebarData =
    activeData && (activeData as { surface?: string }).surface === "sidebar"
      ? (activeData as { kind?: string; name?: string })
      : null;
  const sidebarKindLabel =
    sidebarData?.kind === "folder"
      ? "Tab group"
      : sidebarData?.kind === "space"
        ? "Space"
        : sidebarData?.kind === "spaceGroup"
          ? "Space group"
          : "";

  return (
    <OrganizeDndContext.Provider value={api}>
      <SpringExpandContext.Provider value={springApi}>
      <DndContext
        sensors={sensors}
        collisionDetection={organizeCollisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        <DragOverlay dropAnimation={null} className="opacity-80">
          {itemData ? (
            <div className="min-w-[260px] max-w-[360px] rounded-xl bg-background-neutral shadow-2xl shadow-black/20 border border-border-neutral-faded p-3">
              <p className="text-sm font-semibold text-foreground-neutral line-clamp-2">
                {selectedCount > 1 ? `${selectedCount} tabs selected` : itemData.item.title}
              </p>
              <p className="text-xs text-foreground-secondary line-clamp-1 mt-1">
                {itemData.item.url}
              </p>
            </div>
          ) : folderData ? (
            <div className="min-w-[320px] rounded-xl bg-background-neutral shadow-2xl shadow-black/25 border border-border-neutral-faded px-4 py-3">
              <div className="text-lg font-semibold text-foreground-neutral">
                {folderData.folder.name}
              </div>
              <div className="text-xs text-foreground-secondary">
                {folderData.folder.isPinned ? "Pinned group" : "Tab group"}
              </div>
            </div>
          ) : sidebarData && sidebarKindLabel ? (
            <div className="rounded-xl bg-background-neutral shadow-2xl shadow-black/25 border border-border-neutral-faded px-4 py-2.5">
              <div className="text-sm font-semibold text-foreground-neutral line-clamp-1">
                {sidebarData.name ?? sidebarKindLabel}
              </div>
              <div className="text-xs text-foreground-secondary">{sidebarKindLabel}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <ConfirmDialog
        open={!!pendingConfirm}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Move"}
        cancelLabel="Cancel"
        variant={pendingConfirm?.variant ?? "warning"}
        onConfirm={async () => {
          await pendingConfirm?.onConfirm();
        }}
      />
      </SpringExpandContext.Provider>
    </OrganizeDndContext.Provider>
  );
};
