import { eq } from "drizzle-orm";
import { users, type DrizzleHandle } from "@ds/db";
import type { RegisteredEmailDirectory } from "./idp.types.js";

type Db = DrizzleHandle["db"];

/**
 * 003 EARS-41 (#3525): the registered-email lookup off the `users` mirror.
 * `users.email` is a UNIQUE `citext`, so at most one row answers and the match
 * is case-insensitive, like the IdP search it stands in front of. The adapter
 * re-reads the subject from the IdP by id and checks its address, so a stale
 * row can never name another account.
 */
export class DrizzleRegisteredEmailDirectory implements RegisteredEmailDirectory {
  constructor(private readonly db: Db) {}

  async subjectFor(email: string): Promise<string | null> {
    const [row] = await this.db
      .select({ sub: users.zitadelSub })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row?.sub ?? null;
  }
}
