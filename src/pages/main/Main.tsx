import React from "react";
import ItemList from "@src/components/items/ItemList";
import FolderList from "@src/components/folders/FolderList";
import TagList from "@src/components/tags/TagList";

const Main = () => {
  return (
    <div>
      <h1>Vibe Search</h1>
      <p>Welcome to the main application page.</p>
      <FolderList />
      <TagList />
      <ItemList />
    </div>
  );
};

export default Main;
