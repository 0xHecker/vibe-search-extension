import { cn } from "@src/lib/utils";
import { useState, useEffect } from "react";
import { Input } from "@src/components/ui/input";
import { Tabs } from "@src/components/icons/tabs";
import SidePanel from "@src/components/ui/SidePanel";
import { TabGroups } from "@src/components/TabGroups/TabGroups";
import { ChevronRight } from "@src/components/icons/chevron-right";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";

const Search = () => {
  const [theme, setTheme] = useState("light");
  const [isOpen, setIsOpen] = useState(true);
  const [folders, setFolders] = useState<FolderDocType[]>([]);
  const [items, setItems] = useState<ItemDocType[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const foldersResponse = await chrome.runtime.sendMessage({
        service: "dbManager",
        type: "getAllFolders",
        target: "offscreen",
      });
      if (foldersResponse?.success) {
        setFolders(
          (foldersResponse.payload as FolderDocType[]).slice().sort((a, b) => {
            // Pinned first, within each group order by createdAt desc
            if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
            return b.createdAt - a.createdAt;
          })
        );
      }

      const itemsResponse = await chrome.runtime.sendMessage({
        service: "dbManager",
        type: "getAllItems",
        target: "offscreen",
      });
      if (itemsResponse?.success) {
        setItems(itemsResponse.payload);
      }
    };

    fetchData();

    chrome.storage.local.get("sidePanelOpen", (result) => {
      if (result.sidePanelOpen !== undefined) {
        setIsOpen(result.sidePanelOpen);
      }
    });
    // Live reactivity via RxDB queryChangeDetector: listen for changes broadcast from offscreen
    const onMessage = (msg: any) => {
      if (msg?.type === "DB_CHANGE" && (msg.scope === "folders" || msg.scope === "items")) {
        fetchData();
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const togglePanel = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    chrome.storage.local.set({ sidePanelOpen: newState });
  };

  return (
    <div id="search-results" data-theme={theme} className="min-h-dvh bg-background-page relative">
      <div
        className={cn(
          "fixed top-28 h-[70%] z-50 transition-transform duration-400 ease-in-out peer/sidepanel",
          {
            "left-4": isOpen,
            "-translate-x-[calc(100%+8px)] left-0": !isOpen,
          }
        )}
      >
        <SidePanel className="rounded-xl shadow-sm shadow-foreground-muted/60">
          <div className="flex flex-col gap-2 p-2 w-full h-full overflow-y-auto">
            {folders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center gap-2 w-full bg-background-neutral p-2 hover:bg-background-neutral/75 transition-all cursor-pointer rounded-lg border-border-neutral-faded"
              >
                <Tabs fillColor="#E56B6B" />
                <span className="text-foreground-neutral font-semibold text-xl">{folder.name}</span>
              </div>
            ))}
          </div>
        </SidePanel>
      </div>
      <div
        className={cn("peer/bar", {
          "left-[calc(1rem+240px)] fixed top-30 h-[40%] w-8": isOpen,
        })}
      />
      <button
        onClick={togglePanel}
        className={cn(
          "fixed top-34 p-1 z-50 shadow-sm shadow-foreground-muted/60 rounded-semi bg-background-page-secondary transition-all duration-400 ease-in-out group cursor-pointer",
          {
            "left-[calc(1rem+240px+8px)]": isOpen,
            "left-2": !isOpen,
            "opacity-100": !isOpen,
            "opacity-0 hover:opacity-100 peer-hover/sidepanel:opacity-100 peer-hover/bar:opacity-100":
              isOpen,
          }
        )}
      >
        <ChevronRight
          className={cn(
            "h-5 w-5 transition-all duration-300 text-foreground-tertiary group-hover:text-foreground-icon",
            {
              "rotate-180": isOpen,
            }
          )}
        />
      </button>

      <div className="mt-4 w-full max-w-5xl mx-auto border-b border-b-border-neutral-faded focus-within:border-b-accent/50 focus-within:shadow-[0_5px_6px_-6px_var(--color-accent)] transition-all duration-300 py-2">
        <Input
          placeholder="Search Something or type :"
          className="h-16 w-full text-6xl border-0 pb-2 shadow-none placeholder:text-foreground-tertiary/80 font-serif italic focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          onChange={(e) => console.log("Search query:", e.target.value)}
        />
      </div>

      <TabGroups folders={folders} items={items} />
    </div>
  );
};

export default Search;
