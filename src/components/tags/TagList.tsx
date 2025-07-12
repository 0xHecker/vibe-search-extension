import React, { useEffect, useState } from "react";
import { getDb } from "@src/services/DatabaseService";
import { TagDocType } from "@src/schemas/tag_schema";

const TagList = () => {
  const [tags, setTags] = useState<TagDocType[]>([]);

  useEffect(() => {
    const fetchTags = async () => {
      const db = await getDb();
      const allTags = await db.tags.find().exec();
      setTags(allTags);
    };

    fetchTags();
  }, []);

  return (
    <div>
      <h2>Tags</h2>
      <ul>
        {tags.map((tag) => (
          <li key={tag.id}>{tag.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default TagList;
