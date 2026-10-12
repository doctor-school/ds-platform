import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { users, type DrizzleHandle } from "@ds/db";
import { DRIZZLE_DB } from "../../database/database.tokens.js";
import { isUniqueViolation } from "../auth.service.js";

type Db = DrizzleHandle["db"];

/** The account columns the phone confirmation reads (003 EARS-47/48). */
export interface PhoneAccount {
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
}

/**
 * 003 EARS-47…51: the confirmed-phone columns of the `users` mirror as the
 * phone confirmation reads and writes them. `users.phone` holds a number only
 * while it is confirmed (EARS-58), so the UNIQUE constraint is what makes a
 * number confirmed on at most one account.
 */
export interface PhoneMirror {
  /** The active account of `sub`, or `null` without a mirror row. */
  account(sub: string): Promise<PhoneAccount | null>;
  /** The subject holding `phone` confirmed, or `null`. */
  confirmedOwner(phone: string): Promise<string | null>;
  /** Clear the account's confirmed phone (the EARS-47 displacement). */
  clearConfirmedPhone(sub: string): Promise<void>;
  /**
   * Write `phone` as the account's confirmed phone. `"taken"` when another
   * account confirmed the same number first (the UNIQUE race of EARS-48).
   */
  setConfirmedPhone(sub: string, phone: string): Promise<"written" | "taken">;
}

export const PHONE_MIRROR = Symbol("PHONE_MIRROR");

@Injectable()
export class DrizzlePhoneMirror implements PhoneMirror {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async account(sub: string): Promise<PhoneAccount | null> {
    const [row] = await this.db
      .select({
        email: users.email,
        phone: users.phone,
        phoneVerified: users.phoneVerified,
      })
      .from(users)
      .where(and(eq(users.zitadelSub, sub), isNull(users.deactivatedAt)))
      .limit(1);
    return row ?? null;
  }

  async confirmedOwner(phone: string): Promise<string | null> {
    const [row] = await this.db
      .select({ sub: users.zitadelSub })
      .from(users)
      .where(and(eq(users.phone, phone), eq(users.phoneVerified, true)))
      .limit(1);
    return row?.sub ?? null;
  }

  async clearConfirmedPhone(sub: string): Promise<void> {
    await this.db
      .update(users)
      .set({ phone: null, phoneVerified: false })
      .where(eq(users.zitadelSub, sub));
  }

  async setConfirmedPhone(
    sub: string,
    phone: string,
  ): Promise<"written" | "taken"> {
    try {
      await this.db
        .update(users)
        .set({ phone, phoneVerified: true })
        .where(eq(users.zitadelSub, sub));
      return "written";
    } catch (err) {
      if (isUniqueViolation(err)) return "taken";
      throw err;
    }
  }
}

/** In-memory {@link PhoneMirror} for unit specs (UNIQUE enforced). */
export class InMemoryPhoneMirror implements PhoneMirror {
  readonly accounts = new Map<string, PhoneAccount>();

  account(sub: string): Promise<PhoneAccount | null> {
    const a = this.accounts.get(sub);
    return Promise.resolve(a ? { ...a } : null);
  }

  confirmedOwner(phone: string): Promise<string | null> {
    for (const [sub, a] of this.accounts) {
      if (a.phone === phone && a.phoneVerified) return Promise.resolve(sub);
    }
    return Promise.resolve(null);
  }

  clearConfirmedPhone(sub: string): Promise<void> {
    const a = this.accounts.get(sub);
    if (a) this.accounts.set(sub, { ...a, phone: null, phoneVerified: false });
    return Promise.resolve();
  }

  setConfirmedPhone(sub: string, phone: string): Promise<"written" | "taken"> {
    for (const [other, a] of this.accounts) {
      if (other !== sub && a.phone === phone) return Promise.resolve("taken");
    }
    const a = this.accounts.get(sub);
    if (a) this.accounts.set(sub, { ...a, phone, phoneVerified: true });
    return Promise.resolve("written");
  }
}
