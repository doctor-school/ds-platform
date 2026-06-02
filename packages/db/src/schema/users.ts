import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// `citext` (case-insensitive text) is a Postgres extension type, not a native
// drizzle column. The migration prepends `CREATE EXTENSION IF NOT EXISTS citext`
// by hand (drizzle-kit never emits CREATE EXTENSION) — same pattern as `vector`
// in 0000_initial.sql. Case-insensitive email matching closes the duplicate-
// account / enumeration seam called out in ADR-0001 §3.
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

// Domain mirror of the Zitadel identity (003-design §5). `apps/api` (the BFF)
// owns this row; Zitadel owns the credential. `zitadel_sub` is the join key back
// to the IdP. At least one of email / phone must be present (ADR-0001 §3).
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    zitadelSub: text("zitadel_sub").notNull().unique(),
    email: citext("email").unique(),
    phone: text("phone").unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    role: text("role").notNull().default("doctor_guest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "users_email_or_phone",
      sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
