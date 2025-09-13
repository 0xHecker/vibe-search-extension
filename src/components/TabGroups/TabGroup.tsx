import { useState, useRef, useEffect } from "react";
import { CopyIcon } from "@icons/copy";
import { Checkmark } from "@icons/checkmark";
import { OpenArrowIcon } from "@icons/open-arrow";
import { DeleteIcon } from "@icons/delete";
import { Button } from "@components/ui/button";
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

interface TabGroupProps {
  folder: FolderDocType;
  items: ItemDocType[];
}

export const TabGroup = ({ folder, items }: TabGroupProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(folder.name);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copiedFolderId, setCopiedFolderId] = useState<string | null>(null);
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

  const togglePinned = async () => {
    await chrome.runtime.sendMessage({
      service: "folders",
      type: "setPinned",
      target: "offscreen",
      payload: { id: folder.id, value: !folder.isPinned },
    });
  };

  const toggleLocked = async () => {
    await chrome.runtime.sendMessage({
      service: "folders",
      type: "setLocked",
      target: "offscreen",
      payload: { id: folder.id, value: !folder.isLocked },
    });
  };

  const commitTitle = async () => {
    const trimmed = title.trim().slice(0, 80);
    setTitle(trimmed);
    await chrome.runtime.sendMessage({
      service: "folders",
      type: "rename",
      target: "offscreen",
      payload: { id: folder.id, name: trimmed },
    });
  };

  useEffect(() => {
    setTitle(folder.name);
  }, [folder.name]);

  return (
    <div className="group/tabgroup flex relative flex-col">
      <div
        className={cn(
          "absolute right-4 transition-all duration-300 flex flex-row gap-1",
          isCollapsed ? "top-2" : "top-5.5",
          folder.isPinned || folder.isLocked
            ? "opacity-100"
            : "opacity-0 group-hover/tabgroup:opacity-100"
        )}
      >
        <div
          onClick={toggleLocked}
          className={cn(
            "cursor-pointer",
            folder.isLocked
              ? "text-foreground-icon"
              : "text-foreground-tertiary/60 hover:text-foreground-tertiary"
          )}
        >
          <LockShadowIcon size={28} className="transition-all duration-300" />
        </div>
        <div
          onClick={togglePinned}
          className={cn(
            "cursor-pointer",
            folder.isPinned
              ? "text-foreground-icon"
              : "text-foreground-tertiary/60 hover:text-foreground-tertiary"
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
          className={cn("h-6 w-6 rounded-semi ")}
          onClick={() => setIsCollapsed((p) => !p)}
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
          <div className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300">
            <OpenArrowIcon />
          </div>
          <div className="cursor-pointer hover:text-foreground-danger transition-colors duration-300">
            <DeleteIcon />
          </div>
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
          </div>
        </div>
      </div>
    </div>
  );
};
