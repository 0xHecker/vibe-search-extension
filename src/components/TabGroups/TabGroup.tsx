import React, { useState, useRef, useEffect } from "react";
import { CopyIcon } from "@icons/copy";
import { OpenArrowIcon } from "@icons/open-arrow";
import { DeleteIcon } from "@icons/delete";
import { Button } from "@components/ui/button";
import { PlusLargeIcon } from "@icons/plus-large";
import { SearchThickIcon } from "@icons/search-thick";
import { Input } from "@components/ui/input";
import { cn } from "@src/lib/utils";
import { ChevronRight } from "@icons/chevron-right";
import { DotIcon } from "@icons/dot";
import { LockShadowIcon } from "@icons/lock";
import { PinShadowIcon } from "@icons/pin";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";

interface TabGroupProps {
  folder: FolderDocType;
  items: ItemDocType[];
}

export const TabGroup = ({ folder, items }: TabGroupProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditingTitle]);

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
          onClick={() => setIsLocked((p) => !p)}
          className={cn(
            "cursor-pointer",
            isLocked
              ? "text-foreground-icon"
              : "text-foreground-tertiary/60 hover:text-foreground-tertiary"
          )}
        >
          <LockShadowIcon size={28} className="transition-all duration-300" />
        </div>
        <div
          onClick={() => setIsPinned((p) => !p)}
          className={cn(
            "cursor-pointer",
            isPinned
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
            onBlur={() => setIsEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setIsEditingTitle(false);
              }
            }}
            className="text-foreground-neutral font-semibold text-xl w-fit max-w-[50%] ml-4 h-auto px-2 py-0 transition-transform shadow-none focus-visible:border-2 focus-visible:border-border-neutral bg-transparent"
          />
        ) : (
          <span
            className="text-foreground-neutral font-semibold text-xl max-w-[50%] line-clamp-1 ml-4 cursor-text"
            onClick={() => setIsEditingTitle(true)}
          >
            {title}
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
          {new Date(folder.createdAt).toLocaleString()}
        </span>
        {/** Will add created at and last updated at in future */}
        <div className="flex flex-row gap-2 text-foreground-tertiary ml-4">
          <div className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300">
            <CopyIcon />
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
          isCollapsed ? "max-h-0 opacity-0" : "max-h-[1000px] opacity-100"
        )}
      >
        <div className="flex flex-col gap-2 bg-background-page-secondary w-full h-fit mx-auto rounded-semi shadow-sm shadow-foreground-muted/60 pt-2 px-4 pb-4">
          <div className="flex flex-row gap-2">
            <ExpandingButton
              icon={<SearchThickIcon size={16} />}
              placeholder="Search in this tab group"
            />
            <ExpandingButton icon={<PlusLargeIcon size={16} />} placeholder="Add a new tab" />
          </div>

          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <FlatItem key={item.id} title={item.title} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const FlatItem = ({ title }: { title: string }) => {
  return (
    <div className="flex flex-row gap-4 items-center group">
      <div className="flex flex-row gap-2 cursor-pointer">
        <img
          src="https://static.cdninstagram.com/rsrc.php/y4/r/QaBlI0OZiks.ico"
          alt="favicon"
          className="w-5 h-5 rounded-sm"
        />
        <span className="text-foreground-secondary group-hover:text-foreground-neutral transition-colors duration-300 text-sm line-clamp-1">
          {title}
        </span>
      </div>

      <div className="flex flex-row gap-1 invisible group-hover:visible transition-opacity duration-300 opacity-0 group-hover:opacity-100 text-foreground-tertiary">
        <div className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300">
          <CopyIcon size={20} />
        </div>
        <div className="cursor-pointer hover:text-foreground-secondary transition-colors duration-300">
          <OpenArrowIcon size={20} />
        </div>
        <div className="cursor-pointer hover:text-foreground-danger transition-colors duration-300">
          <DeleteIcon size={20} />
        </div>
      </div>
    </div>
  );
};

const ExpandingButton = ({ icon, placeholder }: { icon: React.ReactNode; placeholder: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

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
        {icon}
      </Button>
      <Input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        className={cn(
          "flex-grow w-full bg-transparent pl-0 py-1 placeholder:text-sm text-sm border-none outline-none hover:bg-transparent focus:bg-transparent hover:shadow-none focus:shadow-none transition-opacity duration-300",
          isExpanded ? "opacity-100" : "opacity-0"
        )}
        onBlur={() => setIsExpanded(false)}
      />
    </div>
  );
};
