import { useState, useRef, useEffect } from "react";
import { Button } from "@components/ui/button";
import { PlusLargeIcon } from "@icons/plus-large";
import { Input } from "@components/ui/input";
import { cn } from "@src/lib/utils";
import { resolveToastErrorMessage, withToast } from "@src/utils/toast-feedback";
import { inferSource } from "@src/utils/infer-source";

export const AddTabButton = ({ folderId }: { folderId: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed || isAdding) return;
    setIsAdding(true);
    try {
      await withToast({
        loading: "Adding tab...",
        success: "Tab added.",
        error: (err) => resolveToastErrorMessage(err, "Failed to add tab."),
        action: async () => {
          // Insert the item immediately - metadata will be fetched asynchronously
          // by the addToFolder method which triggers FETCH_METADATA
          const response = await chrome.runtime.sendMessage({
            service: "items",
            type: "addToFolder",
            target: "offscreen",
            payload: {
              folderId,
              url: trimmed,
              userId: "user1",
              source: inferSource(trimmed),
            },
          });
          if (response?.success === false || response?.payload?.success === false) {
            throw new Error(response?.error || response?.payload?.error || "Failed to add tab.");
          }
        },
      });
      setUrl("");
      setIsExpanded(false);
    } catch (e) {
      console.error("Failed to add tab", e);
    } finally {
      setIsAdding(false);
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
        disabled={isAdding}
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
        disabled={isAdding}
        className={cn(
          "flex-grow w-full bg-transparent pl-0 py-1 placeholder:text-sm text-sm border-none outline-none hover:bg-transparent focus:bg-transparent hover:shadow-none focus:shadow-none transition-opacity duration-300",
          isExpanded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
};
