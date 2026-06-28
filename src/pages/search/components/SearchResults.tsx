import { memo, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CornerUpRight, Globe2, Lock } from "lucide-react";
import { FlatItem } from "@components/TabGroups/FlatItem";
import { GridItem } from "@components/TabGroups/GridItem";
import { Masonry } from "react-plock";
import { ViewToggle } from "@components/TabGroups/ViewToggle";
import type { SpaceMoveOption } from "@components/TabGroups/TabGroups";
import { TooltipProvider } from "@components/ui/tooltip";
import { cn } from "@src/lib/utils";
import type { ItemDocType } from "@src/schemas/item_schema";
import type { QueryRankDebugScore } from "@src/search-core/contracts";

/** Spaces here carry their collection (space-group) link for the breadcrumb. */
export type SearchSpaceInfo = SpaceMoveOption & { spaceGroupId?: string | null };
export type SearchCollectionInfo = { id: string; name: string };
export type SearchFolderInfo = { id: string; name: string };

export type SearchResultsProps = {
  items: ItemDocType[];
  spaces: SearchSpaceInfo[];
  folders: SearchFolderInfo[];
  collections: SearchCollectionInfo[];
  onReveal: (item: ItemDocType) => void;
  onCopy: (item: ItemDocType) => void;
  debugScoresByItemId?: Record<string, QueryRankDebugScore>;
  showDebugScores?: boolean;
  page: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

const VIEW_STORAGE_KEY = "vibe-search-view-mode";

type ItemLocation = {
  isPrivate: boolean;
  segments: string[];
};

const SearchResultsComponent = ({
  items,
  spaces,
  folders,
  collections,
  onReveal,
  onCopy,
  debugScoresByItemId,
  showDebugScores = false,
  page,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: SearchResultsProps) => {
  // Shares the browse view's persisted preference so list/grid stays consistent
  // as the user crosses between browsing and searching.
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "grid" || stored === "list") return stored;
    } catch {}
    return "grid";
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    } catch {}
  }, [viewMode]);

  const spaceById = useMemo(() => new Map(spaces.map((space) => [space.id, space])), [spaces]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );
  const collectionById = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection.name])),
    [collections]
  );

  const locationFor = (item: ItemDocType): ItemLocation => {
    const space = spaceById.get(item.spaceId);
    const collectionName = space?.spaceGroupId
      ? collectionById.get(space.spaceGroupId)
      : undefined;
    const folderName = folderById.get(item.folderId);
    const segments = [collectionName, space?.name, folderName].filter(
      (segment): segment is string => !!segment
    );
    return { isPrivate: !!space?.isPrivate, segments };
  };

  const renderResult = (item: ItemDocType) => {
    const location = locationFor(item);
    const debugScore = debugScoresByItemId?.[item.id];
    return (
      <div
        key={item.id}
        data-search-item={item.id}
        className={cn(
          "group/result min-w-0 rounded-2xl border border-border-neutral-faded p-2.5 transition-[border-color,background-color,box-shadow] duration-150",
          "hover:border-border-neutral hover:bg-background-neutral/50 hover:shadow-sm"
        )}
      >
        {/* Location breadcrumb — quiet, aligned to the card, reveal on hover. */}
        <div className="mb-1 flex items-center justify-between gap-2 pl-1 pr-0.5">
          <button
            type="button"
            onClick={() => onReveal(item)}
            title={`Reveal in ${location.segments[location.segments.length - 1] || "space"}`}
            className="inline-flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-foreground-tertiary transition-colors hover:text-foreground-secondary"
          >
            {location.isPrivate ? (
              <Lock size={11} className="shrink-0" />
            ) : (
              <Globe2 size={11} className="shrink-0" />
            )}
            <span className="truncate">
              {location.segments.length > 0 ? location.segments.join(" › ") : "Unknown location"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onReveal(item)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-foreground-tertiary opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-background-neutral-faded hover:text-accent focus-visible:opacity-100 group-hover/result:opacity-100"
          >
            <CornerUpRight size={12} />
            Reveal
          </button>
        </div>

        {viewMode === "grid" ? (
          <GridItem
            item={item}
            spaces={spaces}
            onCopy={onCopy}
            debugScore={debugScore}
            showDebugScore={showDebugScores}
          />
        ) : (
          <FlatItem
            item={item}
            spaces={spaces}
            onCopy={onCopy}
            debugScore={debugScore}
            showDebugScore={showDebugScores}
          />
        )}
      </div>
    );
  };

  return (
    <TooltipProvider>
      <div className="w-full max-w-[1090px] mx-auto mt-1 pb-16">
        <div className="mb-3 flex items-center justify-end px-4">
          <ViewToggle view={viewMode} onViewChange={setViewMode} />
        </div>

        {viewMode === "grid" ? (
          <div className="px-1">
            <Masonry
              items={items}
              config={{ columns: [2, 3, 4], gap: [16, 16, 16], media: [640, 768, 1024] }}
              render={(item) => renderResult(item)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-1">{items.map((item) => renderResult(item))}</div>
        )}

        {(canPrev || canNext) && (
          <nav
            className="mt-7 flex items-center justify-center gap-3"
            aria-label="Search result pages"
          >
            <button
              type="button"
              disabled={!canPrev}
              onClick={onPrev}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border-neutral-faded px-3.5 text-[13px] font-medium text-foreground-secondary transition-colors hover:bg-background-neutral-faded hover:text-foreground-neutral disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={15} />
              Prev
            </button>
            <span className="min-w-[60px] text-center text-[12px] tabular-nums text-foreground-tertiary">
              Page {page}
            </span>
            <button
              type="button"
              disabled={!canNext}
              onClick={onNext}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border-neutral-faded px-3.5 text-[13px] font-medium text-foreground-secondary transition-colors hover:bg-background-neutral-faded hover:text-foreground-neutral disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Next
              <ChevronRight size={15} />
            </button>
          </nav>
        )}
      </div>
    </TooltipProvider>
  );
};

export const SearchResults = memo(SearchResultsComponent);
