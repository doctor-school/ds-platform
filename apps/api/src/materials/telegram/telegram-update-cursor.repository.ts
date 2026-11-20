import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { telegramUpdateCursor } from "@ds/db";
import { DRIZZLE_DB } from "../../database/database.tokens.js";

// 048 slice 2 (#4165) — Drizzle access to `telegram_update_cursor`, the
// stored `getUpdates` offset of the update poller (EARS-24), the time of its
// last successful poll and the update its processing keeps failing on (both
// read by the EARS-31 source check). One row per bot id; only the poller that
// holds the single-poller lock writes it.

type Db = DrizzleHandle["db"];

@Injectable()
export class TelegramUpdateCursorRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly handle: Db) {}

  /** The `offset` of the bot's next `getUpdates`; 0 before its first poll. */
  async nextOffset(botId: number): Promise<number> {
    const [row] = await this.handle
      .select({ nextOffset: telegramUpdateCursor.nextOffset })
      .from(telegramUpdateCursor)
      .where(eq(telegramUpdateCursor.botId, botId));
    return row?.nextOffset ?? 0;
  }

  /** A `getUpdates` answered: record the time (EARS-31 reads it). */
  async markPolled(botId: number, at: Date): Promise<void> {
    await this.handle
      .insert(telegramUpdateCursor)
      .values({ botId, polledAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: telegramUpdateCursor.botId,
        set: { polledAt: at, updatedAt: at },
      });
  }

  /**
   * An update is processed or deliberately dropped: move the offset past it.
   * Never backwards — a stale advance changes nothing.
   */
  async advance(botId: number, nextOffset: number): Promise<void> {
    const now = new Date();
    await this.handle
      .insert(telegramUpdateCursor)
      .values({ botId, nextOffset, updatedAt: now })
      .onConflictDoUpdate({
        target: telegramUpdateCursor.botId,
        set: {
          nextOffset: sql`greatest(${telegramUpdateCursor.nextOffset}, excluded.next_offset)`,
          // Past the failing update: the failure is over.
          failingUpdateId: sql`case when ${telegramUpdateCursor.failingUpdateId} < excluded.next_offset then null else ${telegramUpdateCursor.failingUpdateId} end`,
          failingSince: sql`case when ${telegramUpdateCursor.failingUpdateId} < excluded.next_offset then null else ${telegramUpdateCursor.failingSince} end`,
          updatedAt: now,
        },
      });
  }

  /**
   * EARS-25 — processing failed on `updateId`. The first failure of an
   * update sets the time; another failure of the same update keeps it.
   */
  async markFailing(botId: number, updateId: number, at: Date): Promise<void> {
    await this.handle
      .insert(telegramUpdateCursor)
      .values({ botId, failingUpdateId: updateId, failingSince: at, updatedAt: at })
      .onConflictDoUpdate({
        target: telegramUpdateCursor.botId,
        set: {
          failingSince: sql`case when ${telegramUpdateCursor.failingUpdateId} = excluded.failing_update_id then coalesce(${telegramUpdateCursor.failingSince}, excluded.failing_since) else excluded.failing_since end`,
          failingUpdateId: sql`excluded.failing_update_id`,
          updatedAt: at,
        },
      });
  }

  /**
   * EARS-31 — the bot's last successful poll (null before its first) and
   * since when processing keeps failing on one update (null while it does not).
   */
  async health(
    botId: number,
  ): Promise<{ polledAt: Date | null; failingSince: Date | null }> {
    const [row] = await this.handle
      .select({
        polledAt: telegramUpdateCursor.polledAt,
        failingSince: telegramUpdateCursor.failingSince,
      })
      .from(telegramUpdateCursor)
      .where(eq(telegramUpdateCursor.botId, botId));
    return {
      polledAt: row?.polledAt ?? null,
      failingSince: row?.failingSince ?? null,
    };
  }
}
