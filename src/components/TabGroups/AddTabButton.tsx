import { useState, useRef, useEffect } from "react";
import { Button } from "@components/ui/button";
import { PlusLargeIcon } from "@icons/plus-large";
import { Input } from "@components/ui/input";
import { cn } from "@src/lib/utils";

export const AddTabButton = ({ folderId }: { folderId: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      await chrome.runtime.sendMessage({
        service: "items",
        type: "addToFolder",
        target: "offscreen",
        payload: {
          folderId,
          url: trimmed,
          userId: "user1",
          source: "web",
        },
      });
      setUrl("");
      setIsExpanded(false);
    } catch (e) {
      console.error("Failed to add tab", e);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center bg-background-neutral rounded-full shadow-sm shadow-foreground-muted/60 hover:shadow-md hover:shadow-foreground-muted/80 active:shadow-sm active:shadow-foreground-muted/60 transition-all duration-300 ease-in-out",
        isExpanded ? "w-64 h-6" : "w-6 h-6"
      )}
    >
      <Button
        size="icon"
        variant="secondary"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex-shrink-0 h-6 w-6",
          isExpanded ? "shadow-none hover:bg-background-neutral hover:shadow-none" : ""
        )}
      >
        <PlusLargeIcon size={16} />
      </Button>
      <Input
        ref={inputRef}
        type="url"
        placeholder="Add a new tab URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
        }}
        onBlur={() => setIsExpanded(false)}
        className={cn(
          "flex-grow w-full bg-transparent pl-0 py-1 placeholder:text-sm text-sm border-none outline-none hover:bg-transparent focus:bg-transparent hover:shadow-none focus:shadow-none transition-opacity duration-300",
          isExpanded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
};
