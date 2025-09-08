import { Button } from "@src/components/ui/button";
import { Input } from "@src/components/ui/input";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@src/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@src/components/ui/select";
import { v4 as uuidv4 } from "uuid";
import { ItemDocType } from "@src/schemas/item_schema";
import { FolderDocType } from "@src/schemas/folder_schema";
import * as React from "react";

const Popup = () => {
  const [folderName, setFolderName] = React.useState("");
  const [scope, setScope] = React.useState<
    "current_window" | "except_current" | "left_of_current" | "right_of_current" | "all_windows"
  >("current_window");
  const [isSaving, setIsSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const openSearchPage = () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/pages/search/index.html"),
    });
  };

  const buildItemsFromTabs = (tabs: chrome.tabs.Tab[], folderId: string) => {
    const itemsToSave = tabs
      .filter((tab) => tab.url && !tab.url.startsWith("chrome://"))
      .map(
        (tab) =>
          ({
            id: uuidv4(),
            userId: "user1",
            title: tab.title || "No Title",
            textContent: "",
            url: tab.url!,
            source: "web" as const,
            folderId,
            isFavorite: false,
            parentId: null,
            isEmbedded: false,
            isDirty: true,
            serverVersion: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            vector_index: -1,
            deletedAt: 0,
          } as ItemDocType)
      );
    return itemsToSave;
  };

  const pickTabsByScope = async (): Promise<chrome.tabs.Tab[]> => {
    if (scope === "current_window") {
      return chrome.tabs.query({ currentWindow: true });
    }
    if (scope === "except_current") {
      return chrome.tabs.query({ currentWindow: true, active: false });
    }
    if (scope === "left_of_current" || scope === "right_of_current") {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const currentTab = tabs.find((t) => t.active);
      if (!currentTab) return [];
      return tabs.filter((t) =>
        scope === "left_of_current" ? t.index < currentTab.index : t.index > currentTab.index
      );
    }
    // all_windows
    return chrome.tabs.query({});
  };

  const createFolder = async (name: string): Promise<FolderDocType> => {
    const folderId = uuidv4();
    const response = await chrome.runtime.sendMessage({
      service: "dbManager",
      type: "createFolder",
      target: "offscreen",
      payload: { id: folderId, name, userId: "user1" },
    });
    if (!response?.success) {
      throw new Error(response?.error || "Failed to create folder");
    }
    return response.payload as FolderDocType;
  };

  const saveTabs = async () => {
    setIsSaving(true);
    setStatus(null);
    setStatus(null);
    try {
      const tabs = await pickTabsByScope();
      const name = folderName.trim() || `${tabs.length} tabs`;
      const folder = await createFolder(name);
      const items = buildItemsFromTabs(tabs, folder.id);
      if (items.length === 0) {
        setStatus("No tabs to save.");
        return;
      }
      const response = await chrome.runtime.sendMessage({
        service: "dbManager",
        type: "addItems",
        target: "offscreen",
        payload: { items },
      });
      if (!response?.success) {
        throw new Error(response?.error || "Failed to save items");
      }
      setStatus(`Saved ${items.length} tabs to “${folder.name}”.`);
      setFolderName("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setStatus(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-3 w-72">
      <Card>
        <CardHeader>
          <CardTitle>Save tabs</CardTitle>
          <CardDescription>Group tabs into a folder and save as items.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-foreground-secondary">Folder name</label>
            <Input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. Research – Local-first"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground-secondary">Scope</label>
            <Select value={scope} onValueChange={(v) => setScope(v as any)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current_window">All tabs in window</SelectItem>
                <SelectItem value="except_current">All except current</SelectItem>
                <SelectItem value="left_of_current">Tabs to the left</SelectItem>
                <SelectItem value="right_of_current">Tabs to the right</SelectItem>
                <SelectItem value="all_windows">All tabs in all windows</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status && <div className="text-xs text-foreground-secondary">{status}</div>}
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="secondary" onClick={openSearchPage}>
            Open Search
          </Button>
          <Button onClick={saveTabs} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Popup;
