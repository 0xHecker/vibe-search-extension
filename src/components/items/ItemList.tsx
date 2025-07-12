import React, { useEffect, useState } from "react";
import { getDb } from "@src/services/DatabaseService";
import { ItemDocType } from "@src/schemas/item_schema";

const ItemList = () => {
  const [items, setItems] = useState<ItemDocType[]>([]);

  useEffect(() => {
    const fetchItems = async () => {
      const db = await getDb();
      const allItems = await db.items.find().exec();
      setItems(allItems);
    };

    fetchItems();
  }, []);

  return (
    <div>
      <h2>Items</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.title} - {item.url}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ItemList;
