import { useEffect, useState, useCallback } from "react";
import { X, Plus, Tag, Sparkles, ChevronsUpDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { cn } from "@src/lib/utils";

interface TagType {
  id: string;
  name: string;
}

export const TagEditorDialog = ({
  itemId,
  itemIds,
  open,
  onOpenChange,
  onTagsUpdate,
}: {
  itemId?: string;
  itemIds?: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onTagsUpdate?: (tags: TagType[]) => void;
}) => {
  const [tags, setTags] = useState<TagType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Use itemId if provided, otherwise use first itemId from array for loading
  const primaryItemId = itemId || itemIds?.[0];
  const isBulkMode = !itemId && itemIds && itemIds.length > 1;

  const load = useCallback(async () => {
    if (!primaryItemId) return;
    setIsLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "getTagsForItem",
        target: "offscreen",
        payload: { itemId: primaryItemId },
      });
      if (res?.success) setTags(res.payload as TagType[]);
    } finally {
      setIsLoading(false);
    }
  }, [primaryItemId]);

  // Load all tags once when dialog opens
  const loadAllTags = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "searchTags",
        target: "offscreen",
        payload: { query: "", limit: 50 },
      });
      if (res?.success) {
        setAllTags(res.payload as TagType[]);
      }
    } catch (e) {
      console.error("Failed to load all tags", e);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      loadAllTags();
    } else {
      setSearchValue("");
      setComboboxOpen(false);
      setHighlightedIndex(-1);
    }
  }, [open, load, loadAllTags]);

  // Filter suggestions - exclude already added tags and filter by search
  const filteredTags = allTags
    .filter((t) => !tags.some((existing) => existing.id === t.id))
    .filter(
      (t) => !searchValue.trim() || t.name.toLowerCase().includes(searchValue.trim().toLowerCase())
    )
    .slice(0, 10);

  // Check if current search value matches an existing tag
  const canCreateNew =
    searchValue.trim().length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === searchValue.trim().toLowerCase());

  // Total selectable items (for keyboard navigation)
  const totalItems = filteredTags.length + (canCreateNew ? 1 : 0);

  const addTag = async (name: string) => {
    const tagName = name.trim();
    if (!tagName) return;
    setIsLoading(true);
    try {
      // If bulk mode, add to all items
      const targetIds = isBulkMode ? itemIds : [primaryItemId];
      for (const id of targetIds || []) {
        await chrome.runtime.sendMessage({
          service: "tags",
          type: "addTagToItem",
          target: "offscreen",
          payload: { itemId: id, tagName },
        });
      }
      // Reload tags from primary item
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "getTagsForItem",
        target: "offscreen",
        payload: { itemId: primaryItemId },
      });
      if (res?.success) {
        const next = res.payload as TagType[];
        setTags(next);
        onTagsUpdate?.(next);
      }
      // Reload all tags to include newly created ones
      await loadAllTags();
      setSearchValue("");
      setHighlightedIndex(-1);
      setComboboxOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  const removeTag = async (tagId: string) => {
    setIsLoading(true);
    try {
      const targetIds = isBulkMode ? itemIds : [primaryItemId];
      for (const id of targetIds || []) {
        await chrome.runtime.sendMessage({
          service: "tags",
          type: "removeTagFromItem",
          target: "offscreen",
          payload: { itemId: id, tagId },
        });
      }
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "getTagsForItem",
        target: "offscreen",
        payload: { itemId: primaryItemId },
      });
      if (res?.success) {
        const next = res.payload as TagType[];
        setTags(next);
        onTagsUpdate?.(next);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      if (highlightedIndex < filteredTags.length) {
        addTag(filteredTags[highlightedIndex].name);
      } else if (canCreateNew) {
        addTag(searchValue.trim());
      }
    } else if (e.key === "Escape") {
      setComboboxOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md p-0 gap-0 overflow-hidden bg-gradient-to-b from-background-neutral to-background-page-secondary"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border-neutral-faded">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-600">
              <Tag size={20} />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground-neutral">
                {isBulkMode ? `Edit tags for ${itemIds?.length} items` : "Edit tags"}
              </DialogTitle>
              <p className="text-xs text-foreground-tertiary mt-0.5">
                Add tags to organize and find items faster
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Combobox for adding tags */}
        <div className="px-5 py-4">
          <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={comboboxOpen}
                className={cn(
                  "w-full justify-between h-10 px-3",
                  "bg-background-neutral border-border-neutral-faded",
                  "text-foreground-secondary hover:text-foreground-neutral",
                  "hover:bg-background-neutral hover:border-violet-500/50",
                  "focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50",
                  "transition-all duration-200"
                )}
                disabled={isLoading}
              >
                <span className="flex items-center gap-2">
                  <Plus size={16} className="text-foreground-tertiary" />
                  <span>Add a tag...</span>
                </span>
                <ChevronsUpDown size={16} className="text-foreground-tertiary shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <div className="flex flex-col">
                {/* Search input */}
                <div className="flex items-center gap-2 px-3 h-11 border-b border-border-neutral-faded">
                  <Search size={16} className="text-foreground-tertiary shrink-0" />
                  <input
                    type="text"
                    value={searchValue}
                    onChange={(e) => {
                      setSearchValue(e.target.value);
                      setHighlightedIndex(-1);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Search or create tag..."
                    className={cn(
                      "flex-1 h-full bg-transparent text-sm",
                      "text-foreground-neutral caret-violet-500",
                      "placeholder:text-foreground-tertiary",
                      "outline-none border-none"
                    )}
                    autoFocus
                  />
                </div>

                {/* Results */}
                <div className="max-h-[200px] overflow-y-auto">
                  {filteredTags.length === 0 && !canCreateNew ? (
                    <div className="py-6 text-center text-sm text-foreground-tertiary">
                      {searchValue.trim() ? "No tags found" : "No tags available"}
                    </div>
                  ) : (
                    <div className="p-1">
                      {/* Available tags section */}
                      {filteredTags.length > 0 && (
                        <div>
                          <div className="px-2 py-1.5 text-xs font-medium text-foreground-tertiary uppercase tracking-wider">
                            Available Tags
                          </div>
                          {filteredTags.map((tag, index) => (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => addTag(tag.name)}
                              onMouseEnter={() => setHighlightedIndex(index)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm",
                                "text-foreground-secondary cursor-pointer",
                                "transition-colors duration-100",
                                highlightedIndex === index
                                  ? "bg-violet-500/10 text-violet-700"
                                  : "hover:bg-background-page-secondary"
                              )}
                            >
                              <Tag size={14} className="text-foreground-tertiary shrink-0" />
                              <span className="flex-1 truncate text-left">{tag.name}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Create new option */}
                      {canCreateNew && (
                        <>
                          {filteredTags.length > 0 && (
                            <div className="h-px bg-border-neutral-faded my-1 -mx-1" />
                          )}
                          <button
                            type="button"
                            onClick={() => addTag(searchValue.trim())}
                            onMouseEnter={() => setHighlightedIndex(filteredTags.length)}
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm",
                              "text-violet-600 cursor-pointer",
                              "transition-colors duration-100",
                              highlightedIndex === filteredTags.length
                                ? "bg-violet-500/10"
                                : "hover:bg-violet-500/5"
                            )}
                          >
                            <Plus size={14} className="shrink-0" />
                            <span className="flex-1 truncate text-left">
                              Create "{searchValue.trim()}"
                            </span>
                            <Sparkles size={12} className="opacity-60 shrink-0" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 mt-3 text-sm text-foreground-tertiary">
              <div className="w-4 h-4 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
              <span>Updating tags...</span>
            </div>
          )}
        </div>

        {/* Current tags */}
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-medium text-foreground-tertiary uppercase tracking-wider">
              Current Tags
            </span>
            {tags.length > 0 && (
              <span className="text-xs text-foreground-tertiary bg-background-page-secondary px-1.5 py-0.5 rounded-md">
                {tags.length}
              </span>
            )}
          </div>

          {tags.length === 0 ? (
            <div className="py-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-background-page-secondary mb-3">
                <Tag size={20} className="text-foreground-tertiary" />
              </div>
              <p className="text-sm text-foreground-secondary">No tags yet</p>
              <p className="text-xs text-foreground-tertiary mt-1">
                Click the button above to add your first tag
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className={cn(
                    "group flex items-center gap-1.5 px-3 py-1.5 rounded-full",
                    "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
                    "border border-violet-500/20",
                    "text-sm text-violet-700 font-medium",
                    "transition-all duration-200 hover:shadow-sm hover:border-violet-500/40"
                  )}
                >
                  <span>{tag.name}</span>
                  <button
                    type="button"
                    onClick={() => removeTag(tag.id)}
                    className={cn(
                      "p-0.5 rounded-full -mr-1",
                      "text-violet-400 hover:text-white hover:bg-violet-500",
                      "transition-all duration-150",
                      "opacity-60 group-hover:opacity-100"
                    )}
                    disabled={isLoading}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-neutral-faded bg-background-page-secondary/50 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-foreground-secondary hover:text-foreground-neutral"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
