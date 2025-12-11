import { useEffect, useState, useRef, useCallback } from "react";
import { X, Plus, Tag, Sparkles, Check, ChevronsUpDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@components/ui/command";
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
    }
  }, [open, load, loadAllTags]);

  // Filter suggestions - exclude already added tags
  const availableTags = allTags.filter((t) => !tags.some((existing) => existing.id === t.id));

  // Check if current search value matches an existing tag
  const canCreateNew =
    searchValue.trim().length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === searchValue.trim().toLowerCase());

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
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Search or create tag..."
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                <CommandList>
                  <CommandEmpty>
                    {searchValue.trim() ? (
                      <div className="py-2 text-foreground-tertiary">No tags found</div>
                    ) : (
                      <div className="py-2 text-foreground-tertiary">
                        Start typing to search tags
                      </div>
                    )}
                  </CommandEmpty>

                  {/* Available tags */}
                  {availableTags.length > 0 && (
                    <CommandGroup heading="Available Tags">
                      {availableTags
                        .filter(
                          (t) =>
                            !searchValue.trim() ||
                            t.name.toLowerCase().includes(searchValue.trim().toLowerCase())
                        )
                        .slice(0, 10)
                        .map((tag) => (
                          <CommandItem
                            key={tag.id}
                            value={tag.name}
                            onSelect={() => addTag(tag.name)}
                          >
                            <Tag size={14} className="text-foreground-tertiary" />
                            <span className="flex-1 truncate">{tag.name}</span>
                            <Check size={14} className="opacity-0" />
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  )}

                  {/* Create new tag option */}
                  {canCreateNew && (
                    <>
                      {availableTags.length > 0 && <CommandSeparator />}
                      <CommandGroup>
                        <CommandItem
                          value={`create-${searchValue.trim()}`}
                          onSelect={() => addTag(searchValue.trim())}
                          className="text-violet-600"
                        >
                          <Plus size={14} />
                          <span>Create "{searchValue.trim()}"</span>
                          <Sparkles size={12} className="ml-auto opacity-60" />
                        </CommandItem>
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
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
