import { and, eq, isNull } from "drizzle-orm";
import { users, type DrizzleHandle } from "@ds/db";
import type { ConfirmedPhoneDirectory } from "./idp.types.js";

type Db = DrizzleHandle["db"];

/**
 * 003 EARS-58: the confirmed-phone lookup off the `users` mirror. A row
 * answers only while its phone is confirmed (`phone_verified`) and the account
 * is active; `users.phone` is UNIQUE, so at most one account answers.
 */
export class DrizzleConfirmedPhoneDirectory implements ConfirmedPhoneDirectory {
  constructor(private readonly db: Db) {}

  async subjectFor(phone: string): Promise<string | null> {
    const [row] = await this.db
      .select({ sub: users.zitadelSub })
      .from(users)
      .where(
        and(
          eq(users.phone, phone),
          eq(users.phoneVerified, true),
          isNull(users.deactivatedAt),
        ),
      )
      .limit(1);
    return row?.sub ?? null;
  }
}
