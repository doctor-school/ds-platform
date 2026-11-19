import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { telegramUpdateCursor } from "@ds/db";
import { DRIZZLE_DB } from "../../database/database.tokens.js";

// 048 slice 2 (#4165) — Drizzle access to `telegram_update_cursor`, the
// stored `getUpdates` offset of the update poller (EARS-24) and the time of
// its last successful poll (read by the EARS-31 source check). One row per
// bot id; only the poller that holds the single-poller lock writes it.

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
          updatedAt: now,
        },
      });
  }

  /** The bot's last successful poll, or null before its first — EARS-31. */
  async polledAt(botId: number): Promise<Date | null> {
    const [row] = await this.handle
      .select({ at: telegramUpdateCursor.polledAt })
      .from(telegramUpdateCursor)
      .where(eq(telegramUpdateCursor.botId, botId));
    return row?.at ?? null;
  }
}
