import {
  type DrizzleHandle,
  type PointsPriceRow,
  type PointsReserveRow,
  pointsAccounts,
  pointsObligations,
  pointsPostings,
  pointsPrices,
  pointsReserves,
} from "@ds/db";
import type { PointsAccountRef, PointsRuleLimit } from "@ds/schemas";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

type ConcurrentOpenFilter = Extract<
  PointsRuleLimit,
  { concurrentOpen: unknown }
>["concurrentOpen"]["filter"];

/**
 * A price-list row that forms a hold or a debit: a non-`open` mode with a
 * price above zero (EARS-14: an open item or a zero price writes nothing).
 */
export function isChargeable(price: PointsPriceRow | undefined): price is PointsPriceRow {
  return price !== undefined && price.mode !== "open" && price.pulCost > 0;
}

/**
 * 025 EARS-35 — the price list and the hold projections as the engine reads
 * and writes them (025-design E, F). Every read runs inside the evaluation's
 * transaction, after the person locks of `record` (none under `quote`); every
 * write runs in the transaction of the postings it projects.
 */
export class HoldBook {
  /** EARS-26 — the item's price-list row, or undefined (open at price 0). */
  async priceOf(
    executor: Executor,
    itemRef: string | undefined,
  ): Promise<PointsPriceRow | undefined> {
    if (itemRef === undefined) return undefined;
    const [row] = await executor
      .select()
      .from(pointsPrices)
      .where(eq(pointsPrices.itemRef, itemRef));
    return row;
  }

  /** The `held` reserve of the registration on the person's account and item, if any. */
  async heldReserve(
    executor: Executor,
    registrationId: string,
    personAccountId: string,
    itemRef: string | undefined,
  ): Promise<PointsReserveRow | undefined> {
    if (itemRef === undefined) return undefined;
    const [row] = await executor
      .select()
      .from(pointsReserves)
      .where(
        and(
          eq(pointsReserves.registrationId, registrationId),
          eq(pointsReserves.personAccountId, personAccountId),
          eq(pointsReserves.itemRef, itemRef),
          eq(pointsReserves.state, "held"),
        ),
      );
    return row;
  }

  /** Whether the registration has a hold in any state (one hold per registration). */
  async anyReserve(executor: Executor, registrationId: string): Promise<boolean> {
    const [row] = await executor
      .select({ id: pointsReserves.registrationId })
      .from(pointsReserves)
      .where(eq(pointsReserves.registrationId, registrationId));
    return row !== undefined;
  }

  /** EARS-21 — whether a chargeable price row matches the `concurrentOpen` filter. */
  matches(price: PointsPriceRow | undefined, filter: ConcurrentOpenFilter): boolean {
    if (!isChargeable(price)) return false;
    if (filter.limitedSeats !== undefined && price.limitedSeats !== filter.limitedSeats) {
      return false;
    }
    if (filter.itemKind !== undefined && price.itemKind !== filter.itemKind) {
      return false;
    }
    return true;
  }

  /** EARS-21 — the person's `held` reserves on items matching the filter. */
  async openCount(
    executor: Executor,
    personAccountId: string,
    filter: ConcurrentOpenFilter,
  ): Promise<number> {
    const [row] = await executor
      .select({ n: sql<string>`count(*)` })
      .from(pointsReserves)
      .innerJoin(pointsPrices, eq(pointsPrices.itemRef, pointsReserves.itemRef))
      .where(
        and(
          eq(pointsReserves.personAccountId, personAccountId),
          eq(pointsReserves.state, "held"),
          filter.limitedSeats !== undefined
            ? eq(pointsPrices.limitedSeats, filter.limitedSeats)
            : undefined,
          filter.itemKind !== undefined
            ? eq(pointsPrices.itemKind, filter.itemKind)
            : undefined,
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** EARS-2 / EARS-13 — Pul reserved from the balance and the open advance. */
  async projection(
    executor: Executor,
    personAccountId: string,
  ): Promise<{ reserved: number; advance: { open: number; remaining: number } }> {
    const [reserved] = await executor
      .select({ n: sql<string>`coalesce(sum(${pointsReserves.balancePart}), 0)` })
      .from(pointsReserves)
      .where(
        and(
          eq(pointsReserves.personAccountId, personAccountId),
          eq(pointsReserves.state, "held"),
        ),
      );
    const [advance] = await executor
      .select({
        open: sql<string>`count(*)`,
        remaining: sql<string>`coalesce(sum(${pointsObligations.remaining}), 0)`,
      })
      .from(pointsObligations)
      .where(
        and(
          eq(pointsObligations.personAccountId, personAccountId),
          eq(pointsObligations.state, "open"),
        ),
      );
    return {
      reserved: Number(reserved?.n ?? 0),
      advance: {
        open: Number(advance?.open ?? 0),
        remaining: Number(advance?.remaining ?? 0),
      },
    };
  }

  /** The reserve-side postings of a hold, with their accounts as refs (for a release). */
  async reservePostings(
    executor: Executor,
    reserveEventId: string,
  ): Promise<
    Array<{
      id: string;
      leg: string;
      amount: number;
      occurredAt: Date;
      debit: PointsAccountRef;
      credit: PointsAccountRef;
    }>
  > {
    const rows = await executor
      .select({
        id: pointsPostings.id,
        leg: pointsPostings.leg,
        amount: pointsPostings.amount,
        occurredAt: pointsPostings.occurredAt,
        debitAccountId: pointsPostings.debitAccountId,
        creditAccountId: pointsPostings.creditAccountId,
      })
      .from(pointsPostings)
      .where(eq(pointsPostings.eventId, reserveEventId))
      .orderBy(asc(pointsPostings.leg));
    const ids = [...new Set(rows.flatMap((r) => [r.debitAccountId, r.creditAccountId]))];
    const accounts = new Map<string, PointsAccountRef>();
    const rowsById =
      ids.length === 0
        ? []
        : await executor
            .select()
            .from(pointsAccounts)
            .where(inArray(pointsAccounts.id, ids));
    for (const id of ids) {
      const a = rowsById.find((r) => r.id === id);
      if (!a) throw new Error(`points: account ${id} of a hold vanished`);
      accounts.set(
        id,
        a.subjectKind === "person"
          ? { kind: "person", personId: a.subjectId! }
          : { kind: "system", code: a.systemCode as Extract<PointsAccountRef, { kind: "system" }>["code"] },
      );
    }
    return rows.map((r) => ({
      id: r.id,
      leg: r.leg,
      amount: r.amount,
      occurredAt: r.occurredAt,
      debit: accounts.get(r.debitAccountId)!,
      credit: accounts.get(r.creditAccountId)!,
    }));
  }

  async insertReserve(
    tx: Tx,
    row: {
      registrationId: string;
      personAccountId: string;
      itemRef: string;
      price: number;
      reserveEventId: string;
      heldAt: Date;
    },
  ): Promise<void> {
    await tx.insert(pointsReserves).values({
      ...row,
      balancePart: row.price,
      advancePart: 0,
      state: "held",
    });
  }

  async closeReserve(
    tx: Tx,
    registrationId: string,
    state: "settled" | "released",
    closeEventId: string,
    closedAt: Date,
  ): Promise<void> {
    const closed = await tx
      .update(pointsReserves)
      .set({ state, closeEventId, closedAt })
      .where(
        and(
          eq(pointsReserves.registrationId, registrationId),
          eq(pointsReserves.state, "held"),
        ),
      )
      .returning({ id: pointsReserves.registrationId });
    if (closed.length !== 1) {
      throw new Error(`points: hold ${registrationId} was not held at close`);
    }
  }
}
