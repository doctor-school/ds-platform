import { pgTable, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// Fixture: the cascade below is recorded in the fixture baseline — must pass.
export const registrations = pgTable("registrations", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});
