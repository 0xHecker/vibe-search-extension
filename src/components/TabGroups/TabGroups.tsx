import React from "react";
import { TabGroup } from "@components/TabGroups/TabGroup";
import { FolderDocType } from "@src/schemas/folder_schema";
import { ItemDocType } from "@src/schemas/item_schema";

interface TabGroupsProps {
  folders: FolderDocType[];
  items: ItemDocType[];
}

export const TabGroups = ({ folders, items }: TabGroupsProps) => {
  return (
    <div className="w-full max-w-[1090px] mx-auto mt-14">
      {folders.map((folder) => {
        const folderItems = items.filter((item) => item.folderId === folder.id);
        return <TabGroup key={folder.id} folder={folder} items={folderItems} />;
      })}
    </div>
  );
};
