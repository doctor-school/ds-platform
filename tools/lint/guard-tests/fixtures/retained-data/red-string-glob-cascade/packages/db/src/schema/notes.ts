import { pgTable, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

// Fixture: the string-literal blind spot (#1406 Mode-a blocker 1), cascade side.
// The `/*` inside this ordinary string constant must NOT blank the rest of the
// file — the NEW `onDelete: "cascade"` below has to stay visible to the guard.
const DOC = "see /**";

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  doc: DOC,
});
