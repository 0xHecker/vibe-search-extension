import React, { useEffect, useState } from "react";
import { getDb } from "@src/services/DatabaseService";
import { FolderDocType } from "@src/schemas/folder_schema";

const FolderList = () => {
  const [folders, setFolders] = useState<FolderDocType[]>([]);

  useEffect(() => {
    const fetchFolders = async () => {
      const db = await getDb();
      const allFolders = await db.folders.find().exec();
      setFolders(allFolders);
    };

    fetchFolders();
  }, []);

  return (
    <div>
      <h2>Folders</h2>
      <ul>
        {folders.map((folder) => (
          <li key={folder.id}>{folder.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default FolderList;
