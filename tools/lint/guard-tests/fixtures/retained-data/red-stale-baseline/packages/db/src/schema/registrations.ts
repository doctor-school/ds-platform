import { pgTable, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// Fixture: ONE cascade remains while the baseline still claims two — the removal
// must shrink the baseline in the same PR, so the guard goes red.
export const registrations = pgTable("registrations", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull(),
});
