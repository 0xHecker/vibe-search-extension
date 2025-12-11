import { useState } from "react";
import {
  FolderPlus,
  FolderInput,
  Tag,
  Trash2,
  Copy,
  ExternalLink,
  MoreHorizontal,
  X,
  RefreshCw,
  TagsIcon,
  Check,
  Minus,
  ChevronDown,
} from "lucide-react";
import { cn } from "@src/lib/utils";
import { Button } from "@components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@components/ui/dropdown-menu";
import { ConfirmDialog } from "@components/ui/confirm-dialog";
import { TagEditorDialog } from "@components/TabGroups/TagEditorDialog";
import { ItemDocType } from "@src/schemas/item_schema";
import { FolderDocType } from "@src/schemas/folder_schema";
import { useSelection } from "./SelectionContext";
import { OpenInCurrent } from "@icons/open-in-current";
import { OpenInTabgroup } from "@icons/open-in-tabgroup";
import { OpenInWindow } from "@icons/open-in-window";
import {
  openUrlsInCurrentWindow,
  openUrlsInNewTabGroup,
  openUrlsInNewWindow,
} from "@src/utils/chromeTabs";

interface BulkActionsBarProps {
  items: ItemDocType[];
  folders: FolderDocType[];
  currentFolderId: string;
}

export const BulkActionsBar = ({ items, folders, currentFolderId }: BulkActionsBarProps) => {
  const {
    selectedIds,
    selectedCount,
    isSelectionMode,
    toggleSelectAll,
    exitSelectionMode,
    getSelectedItems,
  } = useSelection();

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isOpenMenuOpen, setIsOpenMenuOpen] = useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  if (!isSelectionMode) return null;

  const selectedItems = getSelectedItems(items);
  const allSelected = selectedCount === items.length;
  const someSelected = selectedCount > 0 && selectedCount < items.length;

  const handleCopy = async () => {
    const urls = selectedItems.map((item) => item.url).join("\n");
    try {
      await navigator.clipboard.writeText(urls);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URLs:", err);
    }
  };

  const handleDelete = async () => {
    for (const item of selectedItems) {
      await chrome.runtime.sendMessage({
        service: "items",
        type: "delete",
        target: "offscreen",
        payload: { id: item.id },
      });
    }
    exitSelectionMode();
  };

  const handleMoveToFolder = async (targetFolderId: string) => {
    // For now, we'll implement move as delete + add to new folder
    // A proper implementation would need a moveToFolder method in the controller
    for (const item of selectedItems) {
      // Delete from current location
      await chrome.runtime.sendMessage({
        service: "items",
        type: "delete",
        target: "offscreen",
        payload: { id: item.id },
      });
      // Add to new folder
      await chrome.runtime.sendMessage({
        service: "items",
        type: "addToFolder",
        target: "offscreen",
        payload: {
          folderId: targetFolderId,
          url: item.url,
          title: item.title,
          iconUrl: item.iconUrl,
          textContent: item.textContent,
          source: item.source,
        },
      });
    }
    exitSelectionMode();
    setIsMoveMenuOpen(false);
  };

  const handleCreateNewFolder = async () => {
    const folderName = `${selectedCount} tabs - ${new Date().toLocaleDateString()}`;
    const response = await chrome.runtime.sendMessage({
      service: "folders",
      type: "create",
      target: "offscreen",
      payload: { name: folderName, userId: "user1" },
    });
    if (response?.success) {
      const newFolder = response.payload as FolderDocType;
      await handleMoveToFolder(newFolder.id);
    }
  };

  const handleOpenInCurrentWindow = async () => {
    const urls = selectedItems.map((i) => i.url);
    await openUrlsInCurrentWindow(urls);
    setIsOpenMenuOpen(false);
  };

  const handleOpenInNewWindow = async () => {
    const urls = selectedItems.map((i) => i.url);
    await openUrlsInNewWindow(urls);
    setIsOpenMenuOpen(false);
  };

  const handleOpenInNewTabGroup = async () => {
    const urls = selectedItems.map((i) => i.url);
    await openUrlsInNewTabGroup(urls, `${selectedCount} tabs`);
    setIsOpenMenuOpen(false);
  };

  const handleRefreshMetadata = async () => {
    const urls = selectedItems.map((item) => item.url);
    await chrome.runtime.sendMessage({
      target: "background",
      type: "FETCH_METADATA",
      payload: { urls, revalidate: true },
    });
    setIsMoreMenuOpen(false);
  };

  const handleDeleteTags = async () => {
    // This would need a bulk delete tags endpoint
    // For now, we'll remove all tags from selected items
    for (const item of selectedItems) {
      const res = await chrome.runtime.sendMessage({
        service: "tags",
        type: "getTagsForItem",
        target: "offscreen",
        payload: { itemId: item.id },
      });
      if (res?.success) {
        const tags = res.payload as { id: string; name: string }[];
        for (const tag of tags) {
          await chrome.runtime.sendMessage({
            service: "tags",
            type: "removeTagFromItem",
            target: "offscreen",
            payload: { itemId: item.id, tagId: tag.id },
          });
        }
      }
    }
    setIsMoreMenuOpen(false);
  };

  const otherFolders = folders.filter((f) => f.id !== currentFolderId);

  return (
    <>
      <div
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
          "flex items-center gap-1 px-2 py-2",
          "bg-foreground-neutral/95 backdrop-blur-md",
          "rounded-2xl shadow-2xl shadow-black/20",
          "border border-white/10",
          "animate-in slide-in-from-bottom-4 fade-in-0 duration-300"
        )}
      >
        {/* Selection indicator with toggle */}
        <button
          type="button"
          onClick={() => toggleSelectAll(items)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-xl",
            "text-white/90 hover:bg-white/10 transition-colors",
            "cursor-pointer"
          )}
        >
          <div
            className={cn(
              "w-5 h-5 rounded-md flex items-center justify-center",
              "border-2 transition-colors",
              allSelected
                ? "bg-white border-white text-foreground-neutral"
                : someSelected
                ? "bg-white/50 border-white text-foreground-neutral"
                : "border-white/40"
            )}
          >
            {allSelected && <Check size={12} strokeWidth={3} />}
            {someSelected && !allSelected && <Minus size={12} strokeWidth={3} />}
          </div>
          <span className="text-sm font-medium tabular-nums">{selectedCount} selected</span>
        </button>

        <div className="w-px h-6 bg-white/20 mx-1" />

        {/* Move actions */}
        <DropdownMenu open={isMoveMenuOpen} onOpenChange={setIsMoveMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/90 hover:text-white hover:bg-white/10 gap-1.5"
            >
              <FolderInput size={16} />
              <span className="hidden sm:inline">Move</span>
              <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuItem onClick={handleCreateNewFolder} className="gap-2">
              <FolderPlus size={16} />
              <span>Move to new folder</span>
            </DropdownMenuItem>
            {otherFolders.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-foreground-tertiary">
                  Move to existing folder
                </div>
                {otherFolders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => handleMoveToFolder(folder.id)}
                    className="gap-2"
                  >
                    <FolderInput size={16} className="text-foreground-tertiary" />
                    <span className="flex-1 truncate">{folder.name}</span>
                    <span className="text-xs text-foreground-tertiary">
                      {items.filter((i) => i.folderId === folder.id).length}
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Add tags */}
        <Button
          variant="ghost"
          size="sm"
          className="text-white/90 hover:text-white hover:bg-white/10 gap-1.5"
          onClick={() => setIsTagEditorOpen(true)}
        >
          <Tag size={16} />
          <span className="hidden sm:inline">Tags</span>
        </Button>

        {/* Delete */}
        <Button
          variant="ghost"
          size="sm"
          className="text-white/90 hover:text-red-400 hover:bg-red-500/10 gap-1.5"
          onClick={() => setIsDeleteDialogOpen(true)}
        >
          <Trash2 size={16} />
          <span className="hidden sm:inline">Delete</span>
        </Button>

        {/* Copy */}
        <Button
          variant="ghost"
          size="sm"
          className="text-white/90 hover:text-white hover:bg-white/10 gap-1.5"
          onClick={handleCopy}
        >
          {isCopied ? <Check size={16} /> : <Copy size={16} />}
          <span className="hidden sm:inline">{isCopied ? "Copied!" : "Copy"}</span>
        </Button>

        {/* Open dropdown */}
        <DropdownMenu open={isOpenMenuOpen} onOpenChange={setIsOpenMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/90 hover:text-white hover:bg-white/10 gap-1.5"
            >
              <ExternalLink size={16} />
              <span className="hidden sm:inline">Open</span>
              <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            <DropdownMenuItem onClick={handleOpenInCurrentWindow} className="gap-2">
              <OpenInCurrent />
              <span>Open in current window</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenInNewTabGroup} className="gap-2">
              <OpenInTabgroup size={20} />
              <span>Open in new tab group</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenInNewWindow} className="gap-2">
              <OpenInWindow size={20} />
              <span>Open in new window</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-6 bg-white/20 mx-1" />

        {/* More options */}
        <DropdownMenu open={isMoreMenuOpen} onOpenChange={setIsMoreMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-white/90 hover:text-white hover:bg-white/10 h-8 w-8"
            >
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem onClick={handleRefreshMetadata} className="gap-2">
              <RefreshCw size={16} />
              <span>Refresh metadata</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDeleteTags} className="gap-2 text-foreground-danger">
              <TagsIcon size={16} />
              <span>Remove all tags</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Cancel */}
        <Button
          variant="ghost"
          size="icon"
          className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8 ml-1"
          onClick={exitSelectionMode}
        >
          <X size={16} />
        </Button>
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={`Delete ${selectedCount} item${selectedCount !== 1 ? "s" : ""}?`}
        description={`This will permanently remove ${selectedCount} tab${
          selectedCount !== 1 ? "s" : ""
        } from this group. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
      />

      {/* Tag editor dialog */}
      <TagEditorDialog
        itemIds={Array.from(selectedIds)}
        open={isTagEditorOpen}
        onOpenChange={setIsTagEditorOpen}
      />
    </>
  );
};
