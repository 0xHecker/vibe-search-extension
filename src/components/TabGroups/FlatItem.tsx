import { useState, useEffect } from "react";
import { CopyIcon } from "@icons/copy";
import { Checkmark } from "@icons/checkmark";
import { OpenArrowIcon } from "@icons/open-arrow";
import { DeleteIcon } from "@icons/delete";
import { ItemDocType } from "@src/schemas/item_schema";
import { WebIcon } from "@icons/web";
import { EyeOpen } from "@components/icons/eye-open";
import { ConfirmDialog } from "@components/ui/confirm-dialog";
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
import { cn } from "@src/lib/utils";
import { useSelection } from "./SelectionContext";
import { Checkbox } from "@components/ui/checkbox";
import { WebsitePreview } from "./WebsitePreview";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SpaceMoveOption } from "./TabGroups";
import type { QueryRankDebugScore } from "@src/search-core/contracts";
import {
  resolveToastErrorMessage,
  showErrorToast,
  showSuccessToast,
  withToast,
} from "@src/utils/toast-feedback";

export const FlatItem = ({
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
  const [isCopied, setIsCopied] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);

  const { isSelectionMode, isSelected, toggleItem, selectItem, selectedIds } = useSelection();
  const itemIsSelected = isSelected(item.id);
  const isLoading = !item.isMetaFetched || isRefreshing;
  const primaryMediaType = item.media?.[0]?.type;
  const hasImagePreview = !!item.displayImageUrl;
  const mediaCount = (item.media || []).length > 0 ? (item.media || []).length : hasImagePreview ? 1 : 0;
  const extraMediaCount = Math.max(0, mediaCount - 1);
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

  // Fetch tags on mount
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setIsCopied(true);
      onCopy(item);
      setTimeout(() => setIsCopied(false), 5000);
      showSuccessToast("URL copied.", { tempo: "quick" });
    } catch (err) {
      console.error("Failed to copy URL:", err);
      showErrorToast(resolveToastErrorMessage(err, "Failed to copy URL."));
    }
  };

  const handleDelete = async () => {
    await withToast({
      loading: "Deleting tab...",
      success: "Tab deleted.",
      error: (err) => resolveToastErrorMessage(err, "Failed to delete tab."),
      action: async () => {
        const response = await chrome.runtime.sendMessage({
          service: "items",
          type: "delete",
          target: "offscreen",
          payload: { id: item.id },
        });

        if (response?.success === false || response?.payload?.success === false) {
          throw new Error(
            response?.error || response?.payload?.error || "Failed to delete tab. Please try again."
          );
        }
      },
    });
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

  const handleOpen = () => {
    try {
      chrome.tabs.create({ url: item.url, active: true });
    } catch (error) {
      console.error("Failed to open tab", error);
    }
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

  const handleSelect = () => {
    selectItem(item.id);
  };

  const handleToggleSelect = () => {
    toggleItem(item.id);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            className={cn(
              "flex flex-row gap-4 items-center group rounded-lg",
              isLoading && "opacity-70",
              isDragging && "ring-2 ring-accent/50 shadow-xl shadow-black/15 bg-background-neutral",
              isOver && !isDragging && "ring-1 ring-accent/40 bg-background-neutral/90 shadow-md",
              itemIsSelected && "bg-accent-faded/50"
            )}
            data-observe="item"
            data-url={item.url}
            {...attributes}
            {...listeners}
          >
            {/* Checkbox - only visible in selection mode */}
            {isSelectionMode && (
              <div
                className="flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleSelect();
                }}
              >
                <Checkbox
                  checked={itemIsSelected}
                  className={cn(
                    "h-4 w-4 cursor-pointer",
                    itemIsSelected &&
                      "border-accent-secondary bg-accent-secondary text-background-neutral"
                  )}
                />
              </div>
            )}

            <div
              className="flex flex-row gap-2 cursor-pointer flex-1 min-w-0"
              onClick={isSelectionMode ? handleToggleSelect : handleOpen}
            >
              <div
                className={cn(
                  hasImagePreview ? "w-8 h-8 rounded-md" : "w-5 h-5 rounded-sm",
                  "flex-shrink-0 overflow-hidden",
                  isLoading && "animate-pulse"
                )}
              >
                {hasImagePreview ? (
                  <div className="relative w-full h-full">
                    <img
                      src={item.displayImageUrl}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover rounded-md border border-border-neutral-faded"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    {extraMediaCount > 0 && (
                      <span className="absolute -right-1 -bottom-1 rounded-full bg-background-neutral/95 border border-border-neutral-faded px-1 text-[9px] font-medium text-foreground-secondary">
                        +{extraMediaCount}
                      </span>
                    )}
                  </div>
                ) : item.iconUrl ? (
                  <img
                    src={item.iconUrl}
                    alt={item.title}
                    className="w-5 h-5 rounded-sm"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <WebIcon className="w-5 h-5 rounded-sm text-foreground-icon" />
                )}
              </div>
              <span
                className={cn(
                  "text-foreground-secondary group-hover:text-foreground-neutral transition-colors duration-300 text-sm line-clamp-1",
                  isLoading && "animate-pulse"
                )}
              >
                {item.title}
              </span>
              {showDebugScore && debugScore && (
                <div className="flex items-center gap-1 flex-shrink-0 font-mono text-[10px]">
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
              {!hasImagePreview && primaryMediaType && (
                <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.08em] bg-gray-10 text-foreground-tertiary flex-shrink-0">
                  {primaryMediaType}
                  {extraMediaCount > 0 ? ` +${extraMediaCount}` : ""}
                </span>
              )}
              {tags.length > 0 && (
                <div className="flex flex-row gap-1 flex-shrink-0">
                  {tags.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-gray-10 text-foreground-tertiary"
                    >
                      {t.name}
                    </span>
                  ))}
                  {tags.length > 3 && (
                    <span className="text-[10px] text-foreground-tertiary">+{tags.length - 3}</span>
                  )}
                </div>
              )}
              {isLoading && (
                <span className="text-xs text-foreground-tertiary italic flex-shrink-0">
                  loading...
                </span>
              )}
            </div>

            {/* Action buttons - hidden in selection mode */}
            {!isSelectionMode && (
              <div className="flex flex-row gap-1 invisible group-hover:visible transition-opacity duration-300 opacity-0 group-hover:opacity-100 text-foreground-tertiary">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="cursor-pointer hover:text-foreground-secondary"
                  aria-label="Copy tab URL"
                >
                  {isCopied ? (
                    <Checkmark
                      size={20}
                      className="text-foreground-secondary animate-in fade-in-0 zoom-in-95"
                    />
                  ) : (
                    <CopyIcon size={20} />
                  )}
                </button>
                <button
                  type="button"
                  className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300"
                  aria-label="Preview"
                  onClick={() => setIsPreviewOpen(true)}
                >
                  <EyeOpen size={20} />
                </button>
                <button
                  type="button"
                  className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300"
                  aria-label="Open tab"
                  onClick={handleOpen}
                >
                  <OpenArrowIcon size={20} />
                </button>
                <button
                  type="button"
                  className="cursor-pointer hover:text-foreground-danger transition-colors duration-300"
                  aria-label="Delete tab"
                  onClick={() => setIsDeleteDialogOpen(true)}
                >
                  <DeleteIcon size={20} />
                </button>
              </div>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="min-w-[170px]">
          <ContextMenuItem onSelect={handleSelect}>Select</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleCopy}>Copy URL</ContextMenuItem>
          <ContextMenuItem onSelect={handleOpen}>Open in New Tab</ContextMenuItem>
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
          <ContextMenuSeparator />
          <ContextMenuItem disabled>Edit</ContextMenuItem>
          <ContextMenuItem onSelect={() => setIsDeleteDialogOpen(true)} variant="destructive">
            Delete from Current Tab Group
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

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

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete this tab?"
        description={`This will remove "${item.title}" from this tab group. You can't undo this action.`}
        confirmLabel="Delete tab"
        onConfirm={handleDelete}
        variant="danger"
      />
    </>
  );
};
