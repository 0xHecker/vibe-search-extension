import { getDb } from "./DatabaseService";

const seed = async () => {
  const db = await getDb();
  const items = await db.items.find().exec();
  if (items.length === 0) {
    // addDummyData();
  }
};

seed();
