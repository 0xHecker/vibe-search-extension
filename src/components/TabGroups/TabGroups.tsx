import { TabGroup } from "@components/TabGroups/TabGroup";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";
import { TooltipProvider } from "../ui/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";

interface TabGroupsProps {
  folders: FolderDocType[];
  items: ItemDocType[];
}

export const TabGroups = ({ folders, items }: TabGroupsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sentForFetch, setSentForFetch] = useState(new Set<string>());

  const itemsNeedingMeta = useMemo(() => {
    return new Set(items.filter((i) => !i.isMetaFetched).map((i) => i.url));
  }, [items]);

  // Use ref to track sent URLs to avoid effect re-runs causing observer churn
  const sentForFetchRef = useRef(sentForFetch);
  sentForFetchRef.current = sentForFetch;

  useEffect(() => {
    const root = containerRef.current || null;
    if (itemsNeedingMeta.size === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisible: string[] = [];
        for (const entry of entries) {
          const url = (entry.target as HTMLElement).dataset["url"];
          if (!url) continue;

          // Check if the item needs metadata and hasn't been sent for fetching yet.
          if (
            entry.isIntersecting &&
            itemsNeedingMeta.has(url) &&
            !sentForFetchRef.current.has(url)
          ) {
            newlyVisible.push(url);
          }
        }

        if (newlyVisible.length > 0) {
          // Optimistically mark as sent to prevent re-sending.
          setSentForFetch((prev) => new Set([...prev, ...newlyVisible]));
          try {
            chrome.runtime.sendMessage({
              target: "background",
              type: "FETCH_METADATA",
              payload: { urls: newlyVisible },
            });
          } catch (e) {
            console.warn(
              "Failed to send metadata fetch request, will retry on next visibility.",
              e
            );
            // If sending fails, remove from the sent set so it can be picked up again.
            setSentForFetch((prev) => {
              const next = new Set(prev);
              newlyVisible.forEach((u) => next.delete(u));
              return next;
            });
          }
        }
      },
      { root: root, rootMargin: "600px 0px", threshold: 0.01 }
    );

    const nodes = (root || document).querySelectorAll<HTMLElement>('[data-observe="item"]');
    nodes.forEach((n) => observer.observe(n));

    return () => observer.disconnect();
  }, [itemsNeedingMeta]); // Removed sentForFetch from deps to prevent observer churn

  return (
    <TooltipProvider>
      <div ref={containerRef} className="w-full h-fit max-w-[1090px] mx-auto mt-14 pb-14">
        <div className="flex flex-col gap-4">
          {folders.map((folder) => {
            const folderItems = items.filter((item) => item.folderId === folder.id);
            return <TabGroup key={folder.id} folder={folder} items={folderItems} />;
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};
