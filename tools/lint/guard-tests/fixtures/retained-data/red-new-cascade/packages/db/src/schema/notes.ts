import { pgTable, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// Fixture: a NEW cascade FK with no baseline entry — the guard must go red.
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});
