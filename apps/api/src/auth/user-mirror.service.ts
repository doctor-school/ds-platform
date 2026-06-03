import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { users, type DrizzleHandle, type User } from "@ds/db";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/** Fields a mirror upsert may set; identifiers/flags are optional per source. */
export interface MirrorUpsert {
  zitadelSub: string;
  email?: string | undefined;
  phone?: string | undefined;
  emailVerified?: boolean | undefined;
  phoneVerified?: boolean | undefined;
}

/**
 * Owns the backend `doctor_guest` mirror row (design §5). Zitadel owns the
 * credential; this service owns the domain projection keyed by `zitadel_sub`.
 *
 * Used by the webhook and the reconciliation sweep (EARS-19) for idempotent
 * upserts, and by verification (EARS-3/4) to flip the verified flags. The
 * registration cascade (EARS-1/2) inserts its row inside its own transaction
 * (AuthService) because it must be atomic with consent capture (EARS-20).
 */
@Injectable()
export class UserMirrorService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Idempotently upsert a mirror row by `zitadel_sub`, always ensuring the
   * `doctor_guest` grant. Verified flags are only written when the source
   * provides them, so a reconcile/webhook pass never clobbers a true flag with
   * a default false.
   */
  async upsert(input: MirrorUpsert): Promise<void> {
    const set: Record<string, unknown> = {
      role: "doctor_guest",
      updatedAt: new Date(),
    };
    if (input.email !== undefined) set["email"] = input.email;
    if (input.phone !== undefined) set["phone"] = input.phone;
    if (input.emailVerified !== undefined)
      set["emailVerified"] = input.emailVerified;
    if (input.phoneVerified !== undefined)
      set["phoneVerified"] = input.phoneVerified;

    await this.db
      .insert(users)
      .values({
        zitadelSub: input.zitadelSub,
        email: input.email,
        phone: input.phone,
        emailVerified: input.emailVerified ?? false,
        phoneVerified: input.phoneVerified ?? false,
        role: "doctor_guest",
      })
      .onConflictDoUpdate({ target: users.zitadelSub, set });
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row;
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    return row;
  }

  async markEmailVerified(zitadelSub: string): Promise<void> {
    await this.db
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.zitadelSub, zitadelSub));
  }

  async markPhoneVerified(zitadelSub: string): Promise<void> {
    await this.db
      .update(users)
      .set({ phoneVerified: true, updatedAt: new Date() })
      .where(eq(users.zitadelSub, zitadelSub));
  }
}
