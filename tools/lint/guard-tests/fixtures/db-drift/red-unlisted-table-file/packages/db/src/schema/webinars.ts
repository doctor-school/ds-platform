import { pgTable, uuid } from "drizzle-orm/pg-core";

export const webinars = pgTable("webinars", {
  id: uuid("id").primaryKey(),
});
