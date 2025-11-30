import { ItemDocType } from "@src/schemas/item_schema";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImportIcon } from "@icons/import";
import { DotsVertical } from "@icons/dots-vertical";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
} from "@components/ui/context-menu";
import { TagEditorDialog } from "@components/TabGroups/TagEditorDialog";

export const GridItem = ({
  item,
  onCopy,
}: {
  item: ItemDocType;
  onCopy: (item: ItemDocType) => void;
}) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [heights, setHeights] = useState({ collapsed: 0, expanded: 0 });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<"current" | "all">("current");
  const [isSelected, setIsSelected] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isLoading = !item.isMetaFetched || isRefreshing;

  const handleMenuOpenChange = (open: boolean) => {
    setIsMenuOpen(open);
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
        <DropdownMenuItem disabled>View in side panel</DropdownMenuItem>
        <DropdownMenuItem disabled>Select item</DropdownMenuItem>
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
      await chrome.runtime.sendMessage({
        target: "background",
        type: "FETCH_METADATA",
        payload: { urls: [item.url], revalidate: true },
      });
      // The item will update via DB subscription, but add a timeout fallback
      setTimeout(() => setIsRefreshing(false), 10000);
    } catch (error) {
      console.error("Failed to refresh metadata", error);
      setIsRefreshing(false);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group/card max-w-[350px] bg-platinum rounded-semi shadow-card relative",
            isLoading && "opacity-80"
          )}
          data-observe="item"
          data-url={item.url}
        >
          <div className="absolute left-4 top-4 z-20">
            <div className="relative">
              <Checkbox
                className={cn(
                  "size-4 rounded-[6px] bg-background-neutral text-foreground-neutral shadow-sm transition-all duration-200",
                  "border border-border-neutral-faded cursor-pointer shadow-sm",
                  "data-[state=checked]:border-accent-secondary data-[state=checked]:bg-accent-secondary data-[state=checked]:text-background-neutral",
                  "group-hover/card:opacity-100",
                  isSelected ? "opacity-100" : "opacity-0",
                  "focus-visible:ring-2 focus-visible:ring-border-neutral/80 focus-visible:ring-offset-1"
                )}
                checked={isSelected}
                onCheckedChange={(checked) => {
                  setIsSelected(Boolean(checked));
                }}
                aria-label="Select tab card"
              />
              <div
                className="absolute -left-1 -top-1 -right-4 -bottom-4 cursor-pointer"
                onClick={() => setIsSelected(!isSelected)}
                aria-label="Select tab card"
                aria-hidden="true"
              />
            </div>
          </div>

          <div
            className={cn(
              "absolute right-3 top-3 z-20 flex items-center gap-2 text-foreground-tertiary transition-all duration-200",
              "opacity-0 group-hover/card:opacity-100"
            )}
          >
            <Button variant={"ghost"} className="size-5 p-1" aria-label="Preview tab">
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
            {item.displayImageUrl && (
              <img
                src={item.displayImageUrl}
                alt={item.title}
                className="w-full object-cover rounded-sm-semi"
                onError={(e) => {
                  // hide broken image
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <h3
                  title={item.title}
                  className="text-foreground-neutral text-2xl leading-7 font-medium font-serif italic break-all line-clamp-2"
                >
                  {item.title}
                </h3>
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
                            className="h-3 w-3 rounded-sm object-contain flex-shrink-0]" //[filter:grayscale(100%)
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
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-[170px]">
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
        <ContextMenuItem disabled>View in side panel</ContextMenuItem>
        <ContextMenuItem disabled>Select item</ContextMenuItem>
        <ContextMenuItem disabled>Edit</ContextMenuItem>
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
            : `This will remove "${item.title}" from this tab group. You can’t undo this action.`
        }
        confirmLabel={deleteScope === "all" ? "Delete from all groups" : "Delete tab"}
        variant="danger"
        onConfirm={async () => {
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
        }}
      />
      <TagEditorDialog
        itemId={item.id}
        open={isTagEditorOpen}
        onOpenChange={setIsTagEditorOpen}
        onTagsUpdate={setTags}
      />
    </ContextMenu>
  );
};
