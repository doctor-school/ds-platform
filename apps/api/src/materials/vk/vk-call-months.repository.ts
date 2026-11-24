import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { feedVkCallMonths } from "@ds/db";
import { DRIZZLE_DB } from "../../database/database.tokens.js";
import type { VkCallCounter } from "./vk-api.types.js";

// 048 EARS-44, EARS-51 (#4004) — the VK API calls of the current calendar
// month, Moscow time (048-design «Call budget (slice 3)»): one
// `feed_vk_call_months` row per month, keyed by its first day. The VK ID
// account's cap is per account, so the counter is too.

type Db = DrizzleHandle["db"];

/** The first day of the current calendar month in Moscow time. */
const CURRENT_MONTH = sql`date_trunc('month', now() AT TIME ZONE 'Europe/Moscow')::date`;

@Injectable()
export class VkCallMonthsRepository implements VkCallCounter {
  constructor(@Inject(DRIZZLE_DB) private readonly handle: Db) {}

  /** Count one outbound VK API call against the current month. */
  async count(): Promise<void> {
    await this.handle
      .insert(feedVkCallMonths)
      .values({ month: sql`${CURRENT_MONTH}`, calls: 1 })
      .onConflictDoUpdate({
        target: feedVkCallMonths.month,
        set: {
          calls: sql`${feedVkCallMonths.calls} + 1`,
          updatedAt: sql`now()`,
        },
      });
  }

  /** EARS-44 — the calls of the current month (0 before the first). */
  async thisMonth(): Promise<number> {
    const [row] = await this.handle
      .select({ calls: feedVkCallMonths.calls })
      .from(feedVkCallMonths)
      .where(eq(feedVkCallMonths.month, sql`${CURRENT_MONTH}`));
    return row?.calls ?? 0;
  }
}
