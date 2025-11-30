import { useEffect, useState, useRef } from "react";
import { XIcon } from "lucide-react";
import { Command } from "cmdk";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { Popover, PopoverContent, PopoverAnchor } from "@components/ui/popover";

export const TagEditorDialog = ({
  itemId,
  open,
  onOpenChange,
  onTagsUpdate,
}: {
  itemId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onTagsUpdate?: (tags: { id: string; name: string }[]) => void;
}) => {
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "getTagsForItem",
        target: "offscreen",
        payload: { itemId },
      });
      if (res?.success) setTags(res.payload as any);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open, itemId]);

  const fetchSuggestions = async (q: string) => {
    setIsLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "searchTags",
        target: "offscreen",
        payload: { query: q, limit: 10 },
      });
      if (res?.success) {
        const existingTagNames = new Set(tags.map((t) => t.name.toLowerCase()));
        const filtered = (res.payload as { id: string; name: string }[]).filter(
          (s) => !existingTagNames.has(s.name.toLowerCase())
        );
        setSuggestions(filtered);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const debounce = setTimeout(() => fetchSuggestions(q), 200);
    return () => clearTimeout(debounce);
  }, [input, tags]);

  const add = async (name?: string) => {
    const tagName = (name ?? input).trim();
    if (!tagName) return;
    setIsLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "addTagToItem",
        target: "offscreen",
        payload: { itemId, tagName },
      });
      if (res?.success) {
        const next = (res.payload as any).tags as { id: string; name: string }[];
        setTags(next);
        onTagsUpdate?.(next);
      }
      setInput("");
    } finally {
      setIsLoading(false);
    }
  };

  const remove = async (tagId: string) => {
    setIsLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "removeTagFromItem",
        target: "offscreen",
        payload: { itemId, tagId },
      });
      if (res?.success) {
        const next = (res.payload as any).tags as { id: string; name: string }[];
        setTags(next);
        onTagsUpdate?.(next);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const showSuggestions = input.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
        </DialogHeader>

        <Popover open={showSuggestions}>
          <Command>
            <PopoverAnchor>
              <Command.Input
                ref={inputRef}
                placeholder="Add or search tags..."
                value={input}
                onValueChange={setInput}
                className="w-full"
              />
            </PopoverAnchor>
            <PopoverContent
              className="p-0 w-[--radix-popover-trigger-width]"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Command.List>
                {isLoading && <Command.Loading>Loading...</Command.Loading>}
                {!isLoading && suggestions.length === 0 && (
                  <Command.Empty>Press Enter to add "{input}"</Command.Empty>
                )}
                {suggestions.map((s) => (
                  <Command.Item
                    key={s.id}
                    onSelect={() => {
                      add(s.name);
                    }}
                  >
                    {s.name}
                  </Command.Item>
                ))}
              </Command.List>
            </PopoverContent>
          </Command>
        </Popover>

        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-1.5 bg-background-neutral-faded text-foreground-secondary text-sm rounded-md px-2 py-1"
            >
              <span>{t.name}</span>
              <button
                type="button"
                className="text-foreground-tertiary hover:text-foreground-danger"
                onClick={() => remove(t.id)}
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              add();
            }}
          >
            Add
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
