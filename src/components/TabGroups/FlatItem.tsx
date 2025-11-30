import { useState } from "react";
import { CopyIcon } from "@icons/copy";
import { Checkmark } from "@icons/checkmark";
import { OpenArrowIcon } from "@icons/open-arrow";
import { DeleteIcon } from "@icons/delete";
import { ItemDocType } from "@src/schemas/item_schema";
import { WebIcon } from "@icons/web";
import { ConfirmDialog } from "@components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@components/ui/context-menu";
import { TagEditorDialog } from "@components/TabGroups/TagEditorDialog";
import { cn } from "@src/lib/utils";

export const FlatItem = ({
  item,
  onCopy,
}: {
  item: ItemDocType;
  onCopy: (item: ItemDocType) => void;
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isLoading = !item.isMetaFetched || isRefreshing;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setIsCopied(true);
      onCopy(item);
      setTimeout(() => setIsCopied(false), 5000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  const handleDelete = async () => {
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
  };

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
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn("flex flex-row gap-4 items-center group", isLoading && "opacity-70")}
            data-observe="item"
            data-url={item.url}
          >
            <div className="flex flex-row gap-2 cursor-pointer" onClick={handleOpen}>
              <div className={cn("w-5 h-5 rounded-sm", isLoading && "animate-pulse")}>
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt={item.title} className="w-5 h-5 rounded-sm" />
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
              {isLoading && (
                <span className="text-xs text-foreground-tertiary italic">loading...</span>
              )}
            </div>

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
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="min-w-[170px]">
          <ContextMenuItem onSelect={handleCopy}>Copy URL</ContextMenuItem>
          <ContextMenuItem onSelect={handleOpen}>Open in New Tab</ContextMenuItem>
          <ContextMenuItem onSelect={() => setIsTagEditorOpen(true)}>Edit tags</ContextMenuItem>
          <ContextMenuItem onSelect={handleRefreshMetadata}>Refresh metadata</ContextMenuItem>
          <ContextMenuItem disabled>Edit</ContextMenuItem>
          <ContextMenuItem onSelect={() => setIsDeleteDialogOpen(true)} variant="destructive">
            Delete from Current Tab Group
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <TagEditorDialog itemId={item.id} open={isTagEditorOpen} onOpenChange={setIsTagEditorOpen} />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete this tab?"
        description={`This will remove "${item.title}" from this tab group. You can’t undo this action.`}
        confirmLabel="Delete tab"
        onConfirm={handleDelete}
        variant="danger"
      />
    </>
  );
};
