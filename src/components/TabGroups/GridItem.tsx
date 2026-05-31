import { ItemDocType } from "@src/schemas/item_schema";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImportIcon } from "@icons/import";
import { DotsVertical } from "@icons/dots-vertical";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { EyeOpen } from "@components/icons/eye-open";
import { DeleteIcon } from "../icons/delete";
import { cn } from "@src/lib/utils";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@components/ui/context-menu";
import { TagEditorDialog } from "@components/TabGroups/TagEditorDialog";
import { useSelection } from "./SelectionContext";
import { WebsitePreview } from "./WebsitePreview";
import { ItemMediaPreview } from "./ItemMediaPreview";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SpaceMoveOption } from "./TabGroups";
import type { QueryRankDebugScore } from "@src/search-core/contracts";
import { resolveToastErrorMessage, withToast } from "@src/utils/toast-feedback";

export const GridItem = ({
  item,
  spaces,
  debugScore,
  showDebugScore = false,
  onCopy,
}: {
  item: ItemDocType;
  spaces: SpaceMoveOption[];
  debugScore?: QueryRankDebugScore;
  showDebugScore?: boolean;
  onCopy: (item: ItemDocType) => void;
}) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [heights, setHeights] = useState({ collapsed: 0, expanded: 0 });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<"current" | "all">("current");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { isSelectionMode, isSelected, toggleItem, selectItem, selectedIds } = useSelection();
  const itemIsSelected = isSelected(item.id);
  const isLoading = !item.isMetaFetched || isRefreshing;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: item.id,
      data: {
        type: "item",
        item,
        folderId: item.folderId,
        selectedIds: isSelectionMode ? Array.from(selectedIds) : [item.id],
      },
    });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleMenuOpenChange = (open: boolean) => {
    setIsMenuOpen(open);
  };

  const handleSelect = () => {
    selectItem(item.id);
  };

  const handleToggleSelect = () => {
    toggleItem(item.id);
  };

  const renderMenu = () => (
    <DropdownMenu open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="w-6 h-6"
          aria-label="Item actions"
          onClick={() => setIsMenuOpen(true)}
        >
          <DotsVertical size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={4} align="start" className="min-w-[170px]">
        <DropdownMenuItem onSelect={handleSelect}>Select</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            try {
              chrome.tabs.create({ url: item.url, active: true });
            } catch (error) {
              console.error("Failed to open tab", error);
            }
          }}
        >
          Open in New Tab
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setIsTagEditorOpen(true)}>Edit tags</DropdownMenuItem>
        <DropdownMenuItem onSelect={handleRefreshMetadata}>Refresh metadata</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setIsPreviewOpen(true)}>
          View in side panel
        </DropdownMenuItem>
        <DropdownMenuItem disabled>Edit</DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            setDeleteScope("current");
            setIsDeleteDialogOpen(true);
          }}
        >
          Delete from Current Tab Group
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            setDeleteScope("all");
            setIsDeleteDialogOpen(true);
          }}
        >
          Delete from All Tab Groups
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const recomputeHeights = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    const computedStyles = window.getComputedStyle(el);
    const lineHeight = parseFloat(computedStyles.lineHeight || "0") || 0;
    const collapsed = lineHeight > 0 ? lineHeight * 5 : el.clientHeight;
    const expanded = el.scrollHeight;
    setHeights({ collapsed, expanded });
    setIsOverflowing(expanded - collapsed > 6);
  }, []);

  useLayoutEffect(() => {
    recomputeHeights();
  }, [recomputeHeights, item.textContent]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(recomputeHeights);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [recomputeHeights]);

  useEffect(() => {
    setIsExpanded(false);
  }, [item.id]);

  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.runtime.sendMessage({
          service: "tags",
          type: "getTagsForItem",
          target: "offscreen",
          payload: { itemId: item.id },
        });
        if (res?.success) setTags(res.payload as any);
      } catch {}
    })();
  }, [item.id]);

  const displayHeight = useMemo(() => {
    if (!heights.expanded) return undefined;
    const target = isExpanded ? heights.expanded : heights.collapsed;
    return `${Math.ceil(target + 8)}px`;
  }, [heights, isExpanded]);

  const toggleExpansion = () => {
    if (!isOverflowing) return;
    setIsExpanded((prev) => !prev);
  };

  const handleRefreshMetadata = async () => {
    setIsRefreshing(true);
    try {
      await withToast({
        loading: "Refreshing metadata...",
        success: "Metadata refresh queued.",
        error: (err) => resolveToastErrorMessage(err, "Failed to refresh metadata."),
        action: async () => {
          await chrome.runtime.sendMessage({
            target: "background",
            type: "FETCH_METADATA",
            payload: { urls: [item.url], revalidate: true },
          });
        },
      });
      setTimeout(() => setIsRefreshing(false), 10000);
    } catch (error) {
      console.error("Failed to refresh metadata", error);
      setIsRefreshing(false);
    }
  };

  const handleMoveToSpace = async (targetSpaceId: string) => {
    try {
      await withToast({
        loading: "Moving tab to selected space...",
        success: "Tab moved to selected space.",
        error: (err) => resolveToastErrorMessage(err, "Failed to move tab to selected space."),
        action: async () => {
          const response = await chrome.runtime.sendMessage({
            service: "items",
            type: "moveToSpace",
            target: "offscreen",
            payload: {
              targetSpaceId,
              itemIds: [item.id],
            },
          });
          if (response?.success === false || response?.payload?.success === false) {
            throw new Error(
              response?.error || response?.payload?.error || "Failed to move tab to selected space."
            );
          }
        },
      });
    } catch (error) {
      console.error("Failed to move tab to selected space", error);
    }
  };

  const moveSpaceOptions = spaces.filter((space) => space.id !== item.spaceId);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "group/card max-w-[350px] rounded-semi shadow-card relative transition-all duration-200",
            isLoading && "opacity-80",
            itemIsSelected ? "bg-violet-500/10 ring-2 ring-violet-500/40" : "bg-platinum",
            isDragging && "ring-2 ring-accent/50 shadow-2xl shadow-black/20 scale-[1.01]",
            isOver &&
              !isDragging &&
              "ring-1 ring-accent/40 shadow-md shadow-black/10 bg-background-neutral"
          )}
          data-observe="item"
          data-url={item.url}
          {...attributes}
          {...listeners}
        >
          {/* Selection checkbox - visible on hover or in selection mode */}
          <div
            className={cn(
              "absolute left-4 top-4 z-20 transition-opacity duration-200",
              isSelectionMode || itemIsSelected
                ? "opacity-100"
                : "opacity-0 group-hover/card:opacity-100"
            )}
          >
            <div className="relative">
              <Checkbox
                className={cn(
                  "size-4 rounded-[6px] bg-background-neutral text-foreground-neutral shadow-sm transition-all duration-200",
                  "border border-border-neutral-faded cursor-pointer shadow-sm",
                  "data-[state=checked]:border-accent-secondary data-[state=checked]:bg-accent-secondary data-[state=checked]:text-background-neutral",
                  "focus-visible:ring-2 focus-visible:ring-border-neutral/80 focus-visible:ring-offset-1"
                )}
                checked={itemIsSelected}
                onCheckedChange={() => handleToggleSelect()}
                aria-label="Select tab card"
              />
              {/* Invisible expanded click area for better UX */}
              <div
                className="absolute -left-1 -top-1 -right-4 -bottom-4 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleSelect();
                }}
                aria-label="Select tab card"
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div
            className={cn(
              "absolute right-3 top-3 z-20 flex items-center gap-2 text-foreground-tertiary transition-all duration-200",
              "opacity-0 group-hover/card:opacity-100"
            )}
          >
            <Button
              variant={"ghost"}
              className="size-5 p-1"
              aria-label="Preview tab"
              onClick={() => setIsPreviewOpen(true)}
            >
              <EyeOpen size={20} />
            </Button>
            <Button
              variant={"ghost"}
              className="size-5 p-1"
              aria-label="Delete tab"
              onClick={() => {
                setDeleteScope("current");
                setIsDeleteDialogOpen(true);
              }}
            >
              <DeleteIcon size={20} />
            </Button>
          </div>

          <div className="flex flex-col gap-1 p-3 rounded-semi overflow-hidden bg-background-neutral">
            <ItemMediaPreview item={item} />
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <h3
                  title={item.title}
                  className="text-foreground-neutral text-2xl leading-7 font-medium font-serif italic break-all line-clamp-2"
                >
                  {item.title}
                </h3>
                {showDebugScore && debugScore && (
                  <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
                    <span className="rounded border border-border-neutral-faded px-1 text-foreground-tertiary">
                      #{debugScore.rank}
                    </span>
                    <span className="rounded border border-border-neutral-faded px-1 text-foreground-tertiary">
                      L {debugScore.lexicalScore.toFixed(3)}
                    </span>
                    <span className="rounded border border-border-neutral-faded px-1 text-foreground-tertiary">
                      V {debugScore.vectorScore.toFixed(3)}
                    </span>
                    <span className="rounded border border-border-neutral-faded px-1 text-foreground-secondary">
                      F {debugScore.fusedScore.toFixed(3)}
                    </span>
                  </div>
                )}
                <div className="relative">
                  <p
                    ref={textRef}
                    className="font-sans text-xs text-foreground-secondary leading-relaxed transition-[max-height] duration-500 ease-out overflow-hidden"
                    style={{ maxHeight: displayHeight }}
                  >
                    {item.textContent}
                  </p>
                  {!isExpanded && isOverflowing && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent via-background-neutral/60 to-background-neutral" />
                  )}
                </div>
                {isOverflowing && (
                  <button
                    type="button"
                    onClick={toggleExpansion}
                    className="self-start flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] cursor-pointer text-foreground-neutral hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground/40 transition-colors"
                  >
                    {isExpanded ? "Show less" : "Show more"}
                    <span
                      className={`inline-block h-[1px] w-6 transition-transform duration-500 ease-out ${
                        isExpanded ? "scale-x-50" : "scale-x-100"
                      } bg-current`}
                    />
                  </button>
                )}
                <span className="text-xs text-foreground-secondary">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex flex-row items-center justify-between gap-1 text-left cursor-pointer hover:text-foreground hover:underline-offset-2 leading-none"
                        onClick={() => {
                          try {
                            chrome.tabs.create({ url: item.url, active: true });
                          } catch (error) {
                            console.error("Failed to open url", error);
                          }
                        }}
                      >
                        {item.iconUrl && (
                          <img
                            src={item.iconUrl}
                            alt=""
                            className="h-3 w-3 rounded-sm object-contain flex-shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                        <div>
                          {(() => {
                            try {
                              return new URL(item.url).hostname;
                            } catch {
                              return item.url;
                            }
                          })()}
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs break-words">{item.url}</TooltipContent>
                  </Tooltip>
                </span>
              </div>

              <div className="flex flex-row items-center justify-between gap-2">
                <div className="flex flex-row items-center gap-2">
                  <div
                    className={cn(
                      "flex flex-row gap-1 w-fit px-2 py-0.5 rounded-md font-sans text-xs items-center",
                      isLoading ? "bg-amber-100 animate-pulse" : "bg-tea-green"
                    )}
                  >
                    <div>
                      <ImportIcon size={16} />
                    </div>
                    <span className="text-foreground-secondary">
                      {isLoading ? "loading..." : "imported"}
                    </span>
                  </div>

                  <span className="text-foreground-secondary font-sans font-medium text-xs whitespace-nowrap">
                    {new Intl.DateTimeFormat(undefined, {
                      day: "numeric",
                      month: "short",
                    }).format(new Date(item.createdAt))}
                    {", "}
                    {new Intl.DateTimeFormat(undefined, {
                      hour: "numeric",
                      minute: "numeric",
                    }).format(new Date(item.createdAt))}
                  </span>
                </div>
                {renderMenu()}
              </div>
            </div>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-row flex-wrap gap-1 rounded-semi px-2 py-1">
              {tags.map((t) => (
                <div
                  key={t.id}
                  className="rounded-md w-fit px-2 bg-gray-10 hover:bg-gray-40 transition-all cursor-pointer text-xs text-foreground-secondary"
                >
                  {t.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-[170px]">
        <ContextMenuItem onSelect={handleSelect}>Select</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            try {
              chrome.tabs.create({ url: item.url, active: true });
            } catch (error) {
              console.error("Failed to open tab", error);
            }
          }}
        >
          Open in New Tab
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setIsTagEditorOpen(true)}>Edit tags</ContextMenuItem>
        <ContextMenuItem onSelect={handleRefreshMetadata}>Refresh metadata</ContextMenuItem>
        <ContextMenuItem onSelect={() => setIsPreviewOpen(true)}>
          View in side panel
        </ContextMenuItem>
        {moveSpaceOptions.length > 0 && <ContextMenuSeparator />}
        {moveSpaceOptions.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to space</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {moveSpaceOptions.map((space) => {
                const isLocked = space.isPrivate && !space.access?.isUnlocked;
                return (
                  <ContextMenuItem
                    key={space.id}
                    disabled={isLocked}
                    onSelect={() => {
                      void handleMoveToSpace(space.id);
                    }}
                  >
                    {space.name}
                    {isLocked ? " (Locked)" : ""}
                  </ContextMenuItem>
                );
              })}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuItem disabled>Edit</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            setDeleteScope("current");
            setIsDeleteDialogOpen(true);
          }}
          variant="destructive"
        >
          Delete from Current Tab Group
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            setDeleteScope("all");
            setIsDeleteDialogOpen(true);
          }}
          variant="destructive"
        >
          Delete from All Tab Groups
        </ContextMenuItem>
      </ContextMenuContent>
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={
          deleteScope === "all" ? "Delete this tab everywhere?" : "Delete from this tab group?"
        }
        description={
          deleteScope === "all"
            ? `This will delete "${item.title}" from every tab group. This action cannot be undone.`
            : `This will remove "${item.title}" from this tab group. You can't undo this action.`
        }
        confirmLabel={deleteScope === "all" ? "Delete from all groups" : "Delete tab"}
        variant="danger"
        onConfirm={async () => {
          await withToast({
            loading: "Deleting tab...",
            success:
              deleteScope === "all" ? "Tab deleted from all groups." : "Tab deleted from group.",
            error: (err) => resolveToastErrorMessage(err, "Failed to delete tab."),
            action: async () => {
              const response = await chrome.runtime.sendMessage({
                service: "items",
                type: "delete",
                target: "offscreen",
                payload: { id: item.id, scope: deleteScope },
              });

              if (response?.success === false || response?.payload?.success === false) {
                throw new Error(
                  response?.error ||
                    response?.payload?.error ||
                    "Failed to delete tab. Please try again."
                );
              }
            },
          });
        }}
      />
      <TagEditorDialog
        itemId={item.id}
        open={isTagEditorOpen}
        onOpenChange={setIsTagEditorOpen}
        onTagsUpdate={setTags}
      />
      <WebsitePreview
        url={item.url}
        title={item.title}
        open={isPreviewOpen}
        onOpenChange={setIsPreviewOpen}
      />
    </ContextMenu>
  );
};
