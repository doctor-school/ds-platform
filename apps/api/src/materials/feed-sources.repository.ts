import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import type { DrizzleHandle, FeedSource } from "@ds/db";
import { feedEntries, feedSources } from "@ds/db";
import type { FeedSourceNetwork } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  type AuditedTransaction,
  withRequestAuditContext,
} from "../audit/audit-context.tx.js";

// 048 slice 2 (#3993) — Drizzle access to `feed_sources` and the two
// write-side marks its admin commands put on the source's `feed_entries`
// (048-design §Data model (slice 2), Lead decision 11): the `href` rewrite of
// an address change (EARS-21) and the `source_off` mirror of «Выключить» /
// «Включить» (EARS-22). Every mutating path runs inside
// `withRequestAuditContext`, so feature 010's capture trigger attributes the
// `data.feed_sources.*` ledger row to the acting administrator (EARS-23).

type Db = DrizzleHandle["db"];
export type FeedSourcesTx = AuditedTransaction;

/** A source with the number of its posts in the feed (EARS-20). */
export interface FeedSourceListRow {
  source: FeedSource;
  entryCount: number;
}

@Injectable()
export class FeedSourcesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly handle: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: FeedSourcesTx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.handle, fn);
  }

  /** EARS-20 — every source, by platform then address. */
  async list(): Promise<FeedSourceListRow[]> {
    const counts = this.handle
      .select({
        feedSourceId: feedEntries.feedSourceId,
        n: count().as("n"),
      })
      .from(feedEntries)
      .groupBy(feedEntries.feedSourceId)
      .as("counts");
    const rows = await this.handle
      .select({ source: feedSources, n: counts.n })
      .from(feedSources)
      .leftJoin(counts, eq(counts.feedSourceId, feedSources.id))
      .orderBy(asc(feedSources.platform), asc(feedSources.address));
    return rows.map((r) => ({ source: r.source, entryCount: r.n ?? 0 }));
  }

  async findById(id: string): Promise<FeedSource | undefined> {
    const [row] = await this.handle
      .select()
      .from(feedSources)
      .where(eq(feedSources.id, id));
    return row;
  }

  /** EARS-32 — one source with the number of its posts (all pages of «Публикации»). */
  async findWithCount(id: string): Promise<FeedSourceListRow | undefined> {
    const [row] = await this.handle
      .select({ source: feedSources, n: count(feedEntries.id) })
      .from(feedSources)
      .leftJoin(feedEntries, eq(feedEntries.feedSourceId, feedSources.id))
      .where(eq(feedSources.id, id))
      .groupBy(feedSources.id);
    return row ? { source: row.source, entryCount: row.n } : undefined;
  }

  async lockById(
    tx: FeedSourcesTx,
    id: string,
  ): Promise<FeedSource | undefined> {
    const [row] = await tx
      .select()
      .from(feedSources)
      .where(eq(feedSources.id, id))
      .for("update");
    return row;
  }

  /**
   * 048 EARS-25 (#3994) — the Telegram source a channel update belongs to,
   * locked for the update's transaction (so a «Выключить» and the write of a
   * polled update never interleave — EARS-24, EARS-25): by the bound Telegram id once bound, else by the
   * channel username equal to the address, ignoring case, of a source with no
   * id bound yet. A source bound to another id never matches by name.
   */
  async lockTelegramSourceForChat(
    tx: FeedSourcesTx,
    chatId: number,
    username: string | null,
  ): Promise<FeedSource | undefined> {
    const [byId] = await tx
      .select()
      .from(feedSources)
      .where(
        and(
          eq(feedSources.platform, "telegram"),
          eq(feedSources.telegramChatId, BigInt(chatId)),
        ),
      )
      .for("update");
    if (byId || !username) return byId;
    const [byName] = await tx
      .select()
      .from(feedSources)
      .where(
        and(
          eq(feedSources.platform, "telegram"),
          eq(feedSources.address, username.toLowerCase()),
          isNull(feedSources.telegramChatId),
        ),
      )
      .for("update");
    return byName;
  }

  /** EARS-30 — the Telegram source of a normalized address, if listed. */
  async findTelegramByAddress(
    address: string,
  ): Promise<FeedSource | undefined> {
    const [row] = await this.handle
      .select()
      .from(feedSources)
      .where(
        and(
          eq(feedSources.platform, "telegram"),
          eq(feedSources.address, address),
        ),
      );
    return row;
  }

  /**
   * EARS-25 — bind the channel's Telegram id on its first matching update.
   * Not an administrator edit, so the admin ETag (`version`) is not bumped.
   */
  async bindTelegramChatId(
    tx: FeedSourcesTx,
    id: string,
    chatId: number,
  ): Promise<void> {
    await tx
      .update(feedSources)
      .set({ telegramChatId: BigInt(chatId), updatedAt: sql`now()` })
      .where(and(eq(feedSources.id, id), isNull(feedSources.telegramChatId)));
  }

  /** EARS-31 — the ids of every switched-on Telegram source (hourly check). */
  async enabledTelegramSourceIds(): Promise<string[]> {
    const rows = await this.handle
      .select({ id: feedSources.id })
      .from(feedSources)
      .where(
        and(
          eq(feedSources.platform, "telegram"),
          eq(feedSources.enabled, true),
        ),
      )
      .orderBy(asc(feedSources.address));
    return rows.map((r) => r.id);
  }

  /**
   * EARS-31 — write a check's verdict: `status`, `status_reason`,
   * `checked_at` and, while unbound, the Telegram id (in the same write).
   * Applied only while the source is still switched on at the address the
   * check judged, so an «Изменить адрес» or «Выключить» that raced it wins.
   * Not an administrator edit, so the admin ETag (`version`) is not bumped.
   */
  async writeCheck(
    tx: FeedSourcesTx,
    id: string,
    address: string,
    verdict: {
      status: "ok" | "failing";
      statusReason: string | null;
      checkedAt: Date;
      bindChatId: number | null;
    },
  ): Promise<FeedSource | undefined> {
    const [row] = await tx
      .update(feedSources)
      .set({
        status: verdict.status,
        statusReason: verdict.statusReason,
        checkedAt: verdict.checkedAt,
        ...(verdict.bindChatId === null
          ? {}
          : {
              telegramChatId: sql`coalesce(${feedSources.telegramChatId}, ${String(verdict.bindChatId)}::bigint)`,
            }),
      })
      .where(
        and(
          eq(feedSources.id, id),
          eq(feedSources.platform, "telegram"),
          eq(feedSources.enabled, true),
          eq(feedSources.address, address),
        ),
      )
      .returning();
    return row;
  }

  /** Serialize the uniqueness check of one `(platform, address)`. */
  async lockAddress(
    tx: FeedSourcesTx,
    platform: FeedSourceNetwork,
    address: string,
  ): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`feed-source:${platform}:${address}`}, 0))`,
    );
  }

  /** Whether another source of the platform already holds the address. */
  async addressTaken(
    tx: FeedSourcesTx,
    platform: FeedSourceNetwork,
    address: string,
    exceptId: string | null,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: feedSources.id })
      .from(feedSources)
      .where(
        and(
          eq(feedSources.platform, platform),
          eq(feedSources.address, address),
          exceptId ? ne(feedSources.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** EARS-21 — a new source: switched on, «Не проверен». */
  async insert(
    tx: FeedSourcesTx,
    values: { platform: FeedSourceNetwork; address: string },
  ): Promise<FeedSource> {
    const [row] = await tx.insert(feedSources).values(values).returning();
    return row!;
  }

  /** Write `patch` when the row is still at `expectedVersion`; bumps it. */
  async updateVersioned(
    tx: FeedSourcesTx,
    id: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        FeedSource,
        "address" | "enabled" | "status" | "statusReason" | "checkedAt"
      >
    >,
  ): Promise<FeedSource | undefined> {
    const [row] = await tx
      .update(feedSources)
      .set({
        ...patch,
        version: sql`${feedSources.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(feedSources.id, id), eq(feedSources.version, expectedVersion)),
      )
      .returning();
    return row;
  }

  /** The number of the source's entries (EARS-20). */
  async entryCount(tx: FeedSourcesTx, id: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(feedEntries)
      .where(eq(feedEntries.feedSourceId, id));
    return row?.n ?? 0;
  }

  /**
   * EARS-21 — point every entry of the source at its new address. The
   * permalink is `https://t.me/<address>/<smallest message id>` and
   * `source_ref` is `<feed_source_id>:<smallest message id>` (048-design §Data
   * model (slice 2)), so the message id is read back from `source_ref`.
   */
  async rewriteHrefs(
    tx: FeedSourcesTx,
    id: string,
    address: string,
  ): Promise<void> {
    await tx
      .update(feedEntries)
      .set({
        href: sql`'https://t.me/' || ${address}::text || '/' || split_part(${feedEntries.sourceRef}, ':', 2)`,
        updatedAt: sql`now()`,
      })
      .where(eq(feedEntries.feedSourceId, id));
  }

  /** EARS-22 — mirror the source's switched-off state onto each of its entries. */
  async markEntries(
    tx: FeedSourcesTx,
    id: string,
    sourceOff: boolean,
  ): Promise<void> {
    await tx
      .update(feedEntries)
      .set({ sourceOff, updatedAt: sql`now()` })
      .where(eq(feedEntries.feedSourceId, id));
  }
}
