import { useState, useRef, useEffect } from "react";
import { CopyIcon } from "@icons/copy";
import { Checkmark } from "@icons/checkmark";
import { OpenArrowIcon } from "@icons/open-arrow";
import { DeleteIcon } from "@icons/delete";
import { Button } from "@components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu";
import { SearchThickIcon } from "@icons/search-thick";
import { Input } from "@components/ui/input";
import { cn } from "@src/lib/utils";
import { ChevronRight } from "@icons/chevron-right";
import { DotIcon } from "@icons/dot";
import { LockShadowIcon } from "@icons/lock";
import { PinShadowIcon } from "@icons/pin";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";
import { ExpandingButton } from "@components/TabGroups/ExpandingButton";
import { AddTabButton } from "@components/TabGroups/AddTabButton";
import { FlatItem } from "@components/TabGroups/FlatItem";
import { GridItem } from "./GridItem";
import { Masonry } from "react-plock";
import {
  openUrlsInCurrentWindow,
  openUrlsInNewTabGroup,
  openUrlsInNewWindow,
} from "@src/utils/chromeTabs";
import { ConfirmDialog } from "@components/ui/confirm-dialog";
import { OpenInCurrent } from "@icons/open-in-current";
import { OpenInTabgroup } from "@icons/open-in-tabgroup";
import { OpenInWindow } from "@icons/open-in-window";

interface TabGroupProps {
  folder: FolderDocType;
  items: ItemDocType[];
}

export const TabGroup = ({ folder, items }: TabGroupProps) => {
  const [isCollapsed, setIsCollapsed] = useState(folder.isCollapsed ?? false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(folder.name);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copiedFolderId, setCopiedFolderId] = useState<string | null>(null);
  const [isUpdatingPinned, setIsUpdatingPinned] = useState(false);
  const [isUpdatingLocked, setIsUpdatingLocked] = useState(false);
  const [isPinned, setIsPinned] = useState(folder.isPinned ?? false);
  const [isLocked, setIsLocked] = useState(folder.isLocked ?? false);
  const [isOpenMenu, setIsOpenMenu] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditingTitle]);

  const handleCopyFolderUrls = async () => {
    const urls = items.map((item) => item.url).join("\n");
    try {
      await navigator.clipboard.writeText(urls);
      setCopiedFolderId(folder.id);
      setTimeout(() => setCopiedFolderId(null), 5000);
    } catch (err) {
      console.error("Failed to copy URLs:", err);
    }
  };

  const handleRefreshAllMetadata = async () => {
    const urls = items.map((item) => item.url);
    if (urls.length === 0) return;
    try {
      await chrome.runtime.sendMessage({
        target: "background",
        type: "FETCH_METADATA",
        payload: { urls, revalidate: true },
      });
    } catch (error) {
      console.error("Failed to refresh metadata for folder", error);
    }
  };

  const togglePinned = async () => {
    if (isUpdatingPinned) return;
    const next = !isPinned;
    setIsPinned(next);
    setIsUpdatingPinned(true);
    try {
      const response = await chrome.runtime.sendMessage({
        service: "folders",
        type: "setPinned",
        target: "offscreen",
        payload: { id: folder.id, value: next },
      });
      if (response?.success === false || response?.payload?.success === false) {
        throw new Error(
          response?.error || response?.payload?.error || "Failed to update pin state"
        );
      }
    } catch (error) {
      console.error("Failed to toggle pin", error);
      setIsPinned(!next);
    } finally {
      setIsUpdatingPinned(false);
    }
  };

  const toggleLocked = async () => {
    if (isUpdatingLocked) return;
    const next = !isLocked;
    setIsLocked(next);
    setIsUpdatingLocked(true);
    try {
      const response = await chrome.runtime.sendMessage({
        service: "folders",
        type: "setLocked",
        target: "offscreen",
        payload: { id: folder.id, value: next },
      });
      if (response?.success === false || response?.payload?.success === false) {
        throw new Error(
          response?.error || response?.payload?.error || "Failed to update lock state"
        );
      }
    } catch (error) {
      console.error("Failed to toggle lock", error);
      setIsLocked(!next);
    } finally {
      setIsUpdatingLocked(false);
    }
  };

  const commitTitle = async () => {
    const trimmed = title.trim().slice(0, 80);
    setTitle(trimmed);
    const response = await chrome.runtime.sendMessage({
      service: "folders",
      type: "rename",
      target: "offscreen",
      payload: { id: folder.id, name: trimmed },
    });
    if (response?.success === false || response?.payload?.success === false) {
      console.error("Failed to rename folder", response?.error);
    }
  };

  useEffect(() => {
    setTitle(folder.name);
    setIsCollapsed(folder.isCollapsed ?? false);
  }, [folder.name, folder.isCollapsed]);

  useEffect(() => {
    if (!isUpdatingPinned) {
      setIsPinned(folder.isPinned ?? false);
    }
  }, [folder.isPinned, isUpdatingPinned]);

  useEffect(() => {
    if (!isUpdatingLocked) {
      setIsLocked(folder.isLocked ?? false);
    }
  }, [folder.isLocked, isUpdatingLocked]);

  const handleToggleCollapse = async () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    try {
      const response = await chrome.runtime.sendMessage({
        service: "folders",
        type: "setCollapsed",
        target: "offscreen",
        payload: { id: folder.id, value: next },
      });
      if (response?.success === false || response?.payload?.success === false) {
        throw new Error(
          response?.error || response?.payload?.error || "Failed to update collapsed state"
        );
      }
    } catch (error) {
      console.error("Failed to toggle collapse", error);
      setIsCollapsed(!next);
    }
  };

  const maybeDeleteFolderAfterOpen = async () => {
    if (isLocked) return;
    try {
      const response = await chrome.runtime.sendMessage({
        service: "folders",
        type: "delete",
        target: "offscreen",
        payload: { id: folder.id, alsoDeleteItems: true },
      });
      if (response?.success === false || response?.payload?.success === false) {
        console.error(
          "Failed to delete folder after open",
          response?.error || response?.payload?.error
        );
      }
    } catch (e) {
      console.error("Error deleting folder after open", e);
    }
  };

  const handleDeleteGroup = async () => {
    const response = await chrome.runtime.sendMessage({
      service: "folders",
      type: "delete",
      target: "offscreen",
      payload: { id: folder.id, alsoDeleteItems: true },
    });

    if (response?.success === false || response?.payload?.success === false) {
      throw new Error(
        response?.error ||
          response?.payload?.error ||
          "Failed to delete tab group. Please try again."
      );
    }
  };

  const handleOpenInNewWindow = async () => {
    const urls = items.map((i) => i.url);
    try {
      await openUrlsInNewWindow(urls);
      await maybeDeleteFolderAfterOpen();
    } finally {
      setIsOpenMenu(false);
    }
  };

  const handleOpenInCurrentWindow = async () => {
    const urls = items.map((i) => i.url);
    try {
      await openUrlsInCurrentWindow(urls);
      await maybeDeleteFolderAfterOpen();
    } finally {
      setIsOpenMenu(false);
    }
  };

  const handleOpenInNewTabGroup = async () => {
    const urls = items.map((i) => i.url);
    try {
      await openUrlsInNewTabGroup(urls, title || folder.name);
      await maybeDeleteFolderAfterOpen();
    } finally {
      setIsOpenMenu(false);
    }
  };

  return (
    <div className="group/tabgroup flex relative flex-col">
      <div
        className={cn(
          "absolute right-4 transition-all duration-300 flex flex-row gap-1",
          isCollapsed ? "top-2" : "top-5.5",
          isPinned || isLocked ? "opacity-100" : "opacity-0 group-hover/tabgroup:opacity-100"
        )}
      >
        <div
          onClick={toggleLocked}
          className={cn(
            "cursor-pointer transition-all duration-300",
            isLocked
              ? "text-foreground-icon"
              : "text-foreground-tertiary/60 hover:text-foreground-tertiary",
            isUpdatingLocked && "opacity-60 pointer-events-none"
          )}
        >
          <LockShadowIcon size={28} className="transition-all duration-300" />
        </div>
        <div
          onClick={togglePinned}
          className={cn(
            "cursor-pointer transition-all duration-300",
            isPinned
              ? "text-foreground-icon"
              : "text-foreground-tertiary/60 hover:text-foreground-tertiary",
            isUpdatingPinned && "opacity-60 pointer-events-none"
          )}
        >
          <PinShadowIcon size={28} className="transition-all duration-300" />
        </div>
      </div>

      <div
        className={cn(
          "flex flex-row items-center px-4 py-2 transition-colors duration-300 border border-transparent rounded-semi",
          isCollapsed ? "bg-background-page-secondary border-border-neutral-faded shadow-sm" : ""
        )}
      >
        <Button
          size="icon"
          variant="outline"
          className={cn("h-6 w-6 rounded-semi")}
          onClick={handleToggleCollapse}
        >
          <ChevronRight
            size={16}
            className={cn(
              "transition-all duration-300 text-foreground-tertiary hover:text-foreground-icon",
              !isCollapsed && "rotate-90"
            )}
          />
        </Button>

        {isEditingTitle ? (
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setIsEditingTitle(false);
              commitTitle();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setIsEditingTitle(false);
                commitTitle();
              }
            }}
            className="text-foreground-neutral font-semibold text-xl w-fit max-w-[50%] ml-4 h-auto px-2 py-0 transition-transform shadow-none focus-visible:border-2 focus-visible:border-border-neutral bg-transparent"
          />
        ) : (
          <span
            className="text-foreground-neutral font-semibold text-xl max-w-[50%] truncate ml-4 cursor-text"
            onClick={() => setIsEditingTitle(true)}
          >
            {title.length > 40 ? `${title.slice(0, 40)}…` : title}
          </span>
        )}

        <div className="text-foreground-tertiary">
          <DotIcon size={20} />
        </div>

        <span className="text-foreground-secondary text-xs">{items.length} tabs</span>

        <div className="text-foreground-tertiary">
          <DotIcon size={20} />
        </div>

        <span className="text-foreground-secondary text-xs">
          {new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(new Date(folder.createdAt))}{" "}
          at{" "}
          {new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "numeric",
          }).format(new Date(folder.createdAt))}
        </span>

        {/** Will add created at and last updated at in future */}
        <div className="flex flex-row gap-2 text-foreground-tertiary ml-4">
          <div
            onClick={handleCopyFolderUrls}
            className="cursor-pointer hover:text-foreground-secondary transition-all duration-300"
          >
            {copiedFolderId === folder.id ? (
              <Checkmark
                size={24}
                className="text-foreground-secondary animate-in fade-in-0 zoom-in-95"
              />
            ) : (
              <CopyIcon />
            )}
          </div>
          <DropdownMenu open={isOpenMenu} onOpenChange={setIsOpenMenu}>
            <DropdownMenuTrigger asChild>
              <div
                className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setIsOpenMenu(true);
                }}
              >
                <OpenArrowIcon />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={8} className="min-w-[200px]">
              <DropdownMenuItem
                className="flex items-center gap-2"
                onClick={handleOpenInCurrentWindow}
              >
                <OpenInCurrent />
                <span>Open in current window</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-2"
                onClick={handleOpenInNewTabGroup}
              >
                <OpenInTabgroup size={20} />
                <span>Open in new tab group</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex items-center gap-2" onClick={handleOpenInNewWindow}>
                <OpenInWindow size={20} />
                <span>Open in new window</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-2"
                onClick={handleRefreshAllMetadata}
              >
                <span>Refresh all metadata</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className={cn(
              "cursor-pointer transition-colors duration-300",
              isLocked
                ? "text-foreground-tertiary/70 cursor-not-allowed"
                : "text-foreground-tertiary hover:text-foreground-danger"
            )}
            aria-label={isLocked ? "Unlock to delete" : "Delete tab group"}
            disabled={isLocked}
            onClick={() => {
              if (isLocked) return;
              setIsDeleteDialogOpen(true);
            }}
          >
            <DeleteIcon />
          </button>
        </div>
      </div>
      <div
        className={cn(
          "transition-[max-height,opacity] ease-in-out duration-300 overflow-hidden",
          isCollapsed ? "max-h-0 opacity-0" : "opacity-100"
        )}
      >
        <div className="flex flex-col gap-2 bg-background-page-secondary w-full h-fit mx-auto rounded-semi shadow-sm shadow-foreground-muted/60 pt-2 px-4 pb-4">
          <div className="flex flex-row gap-2">
            <ExpandingButton
              icon={<SearchThickIcon size={16} />}
              placeholder="Search in this tab group"
            />
            <AddTabButton folderId={folder.id} />
          </div>

          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <FlatItem
                key={item.id}
                item={item}
                onCopy={(itemToCopy) => {
                  setCopiedItemId(itemToCopy.id);
                  setTimeout(() => setCopiedItemId(null), 5000);
                }}
              />
            ))}
            <Masonry
              items={items}
              config={{
                columns: [2, 3, 4],
                gap: [16, 16, 16],
                media: [640, 768, 1024],
              }}
              render={(item) => (
                <GridItem
                  key={item.id}
                  item={item}
                  onCopy={(itemToCopy) => {
                    setCopiedItemId(itemToCopy.id);
                    setTimeout(() => setCopiedItemId(null), 5000);
                  }}
                />
              )}
            />
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={isLocked ? "Tab group is locked" : "Delete this tab group?"}
        description={
          isLocked
            ? "Unlock this group before deleting it."
            : `All ${items.length} tabs saved in "${title}" will be permanently removed. This action cannot be undone.`
        }
        confirmLabel={isLocked ? "Close" : "Delete tab group"}
        cancelLabel={isLocked ? undefined : "Cancel"}
        variant={isLocked ? "warning" : "danger"}
        isConfirmDisabled={isLocked}
        onConfirm={handleDeleteGroup}
      />
    </div>
  );
};
