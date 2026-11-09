import { Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  type PointsAccountRow,
  type PointsPostingRow,
  pointsAccounts,
  pointsFacts,
  pointsPostingKeys,
  pointsPostings,
} from "@ds/db";
import {
  type PointsAccount,
  type PointsAccountRef,
  PointsAccountSchema,
  PUL_UNIT,
  type PointsFact,
  PointsFactSchema,
  type PointsPosting,
  type PointsPostingHistory,
  PointsPostingHistorySchema,
  type PointsPostOutcome,
  type PointsSystemCode,
} from "@ds/schemas";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  encodePostingCursor,
  type PostingHistoryPosition,
} from "./points-history-cursor.js";
import {
  firstOverdrawingLeg,
  type FoldPosting,
  foldPointsAccount,
  RELEASE_FACT,
  RESERVE_FACT,
  type ResolvedLeg,
  SETTLE_FACT,
} from "./points-balance.js";
import { PointsLedgerError } from "./points.errors.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

const UNIT = "attention_points" as const;

/**
 * Clock-skew bound for a fact's `occurredAt` (EARS-27). The 0058 CHECK
 * `occurred_at <= recorded_at + interval '1 day'` is the database backstop of
 * the same bound; a test pins the two together.
 */
export const POINTS_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** A deterministic key per account ref — also the global open order. */
function refKey(ref: PointsAccountRef): string {
  return ref.kind === "person" ? `p:${ref.personId}` : `s:${ref.code}`;
}

/**
 * The 025 ledger core (025-design §2/§3/§9). The ONE account-resolution API
 * every consumer uses (EARS-1) and the ONE write entry point for a fact
 * (EARS-4, EARS-22, EARS-27, EARS-31). Rule evaluation, reserves, reads and
 * corrections are later slices that call into this service; none of them
 * writes `points_*` tables directly.
 */
@Injectable()
export class PointsLedgerService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * EARS-1 — the person's one attention-points account, opened on first need.
   * Race-safe: concurrent first needs converge on the unique
   * (`subject_kind`, `subject_id`, `unit`) via ON CONFLICT DO NOTHING.
   */
  async resolvePersonAccount(
    personId: string,
    executor: Executor = this.db,
  ): Promise<PointsAccountRow> {
    await executor
      .insert(pointsAccounts)
      .values({ subjectKind: "person", subjectId: personId, unit: UNIT })
      .onConflictDoNothing({
        target: [
          pointsAccounts.subjectKind,
          pointsAccounts.subjectId,
          pointsAccounts.unit,
        ],
      });
    const [row] = await executor
      .select()
      .from(pointsAccounts)
      .where(
        and(
          eq(pointsAccounts.subjectKind, "person"),
          eq(pointsAccounts.subjectId, personId),
          eq(pointsAccounts.unit, UNIT),
        ),
      );
    if (!row) throw new Error("points: person account vanished after open");
    return row;
  }

  /**
   * EARS-2 — the person's `PointsAccount`, folded over postings at read time
   * (no balance column exists to read). A read never writes: a person with no
   * account yet gets the zero fold of an open account WITHOUT opening one —
   * the account opens on the first accrual (EARS-1).
   */
  async readPersonAccount(personId: string): Promise<PointsAccount> {
    const [account] = await this.db
      .select()
      .from(pointsAccounts)
      .where(
        and(
          eq(pointsAccounts.subjectKind, "person"),
          eq(pointsAccounts.subjectId, personId),
          eq(pointsAccounts.unit, UNIT),
        ),
      );
    const postings = account ? await this.foldPostings(account.id) : [];
    const fold = foldPointsAccount(account?.id ?? "", postings);
    return PointsAccountSchema.parse({
      personId,
      pul: { unit: PUL_UNIT, ...fold.pul },
      bre: fold.bre,
      con: fold.con,
      advance: fold.advance,
      status: account?.closedAt ? "closed" : "open",
    });
  }

  /**
   * EARS-46 — the person's `PostingHistory`: every posting on the person
   * account, newest first by (`occurred_at`, `id`), one keyset page of
   * `limit` after `after`. The amount is signed from the person's side
   * (credit +, debit −). `contentRef` is the ref of the journaled fact that
   * produced the posting — the engine writes a rule's postings under the
   * ledger event id `<fact event id>#<rule id>` — unless that ref names a
   * person (a referral link), which the history never exposes. No
   * attribution column, counterparty account or fact subject is selected.
   * A read never writes: a person with no account reads an empty page.
   */
  async readPersonPostings(
    personId: string,
    page: { limit: number; after: PostingHistoryPosition | null },
  ): Promise<PointsPostingHistory> {
    const [account] = await this.db
      .select({ id: pointsAccounts.id })
      .from(pointsAccounts)
      .where(
        and(
          eq(pointsAccounts.subjectKind, "person"),
          eq(pointsAccounts.subjectId, personId),
          eq(pointsAccounts.unit, UNIT),
        ),
      );
    if (!account) return { items: [], nextCursor: null };
    const rows = await this.db
      .select({
        id: pointsPostings.id,
        occurredAt: pointsPostings.occurredAt,
        occurredAtKey: sql<string>`to_char(${pointsPostings.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        creditAccountId: pointsPostings.creditAccountId,
        denomination: pointsPostings.denomination,
        amount: pointsPostings.amount,
        action: pointsPostings.action,
        ruleId: pointsPostings.ruleId,
        ruleVersion: pointsPostings.ruleVersion,
        reversesPostingId: pointsPostings.reversesPostingId,
        contentRef: pointsFacts.refId,
      })
      .from(pointsPostings)
      .leftJoin(
        pointsFacts,
        and(
          // The PK lookup, then the exact `<fact>#<rule>` match.
          eq(
            pointsFacts.eventId,
            sql`left(${pointsPostings.eventId}, length(${pointsPostings.eventId}) - length(${pointsPostings.ruleId}) - 1)`,
          ),
          eq(
            pointsPostings.eventId,
            sql`${pointsFacts.eventId} || '#' || ${pointsPostings.ruleId}`,
          ),
          ne(pointsFacts.refKind, "person"),
        ),
      )
      .where(
        and(
          or(
            eq(pointsPostings.creditAccountId, account.id),
            eq(pointsPostings.debitAccountId, account.id),
          ),
          page.after
            ? sql`(${pointsPostings.occurredAt}, ${pointsPostings.id}) < (${page.after.occurredAt}::timestamptz, ${page.after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(pointsPostings.occurredAt), desc(pointsPostings.id))
      .limit(page.limit + 1);
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return PointsPostingHistorySchema.parse({
      items: items.map((row) => {
        if (row.denomination === null) {
          throw new Error(
            `points: person posting ${row.id} has no denomination`,
          );
        }
        return {
          postingId: row.id,
          occurredAt: row.occurredAt.toISOString(),
          denomination: row.denomination,
          amount: row.creditAccountId === account.id ? row.amount : -row.amount,
          action: row.action,
          ...(row.contentRef !== null ? { contentRef: row.contentRef } : {}),
          ruleId: row.ruleId,
          ruleVersion: row.ruleVersion,
          ...(row.reversesPostingId !== null
            ? { reversesPostingId: row.reversesPostingId }
            : {}),
        };
      }),
      nextCursor:
        rows.length > page.limit && last
          ? encodePostingCursor({ occurredAt: last.occurredAtKey, id: last.id })
          : null,
    });
  }

  /**
   * The postings {@link foldPointsAccount} reads: every posting of the account,
   * plus the reserve / settle / release facts of the person's reserves — their
   * `reserve:advance` and settle legs move Pul between system accounts only.
   */
  private async foldPostings(accountId: string): Promise<FoldPosting[]> {
    const columns = {
      id: pointsPostings.id,
      eventId: pointsPostings.eventId,
      leg: pointsPostings.leg,
      debitAccountId: pointsPostings.debitAccountId,
      creditAccountId: pointsPostings.creditAccountId,
      denomination: pointsPostings.denomination,
      amount: pointsPostings.amount,
      occurredAt: pointsPostings.occurredAt,
    };
    const own = await this.db
      .select(columns)
      .from(pointsPostings)
      .where(
        or(
          eq(pointsPostings.creditAccountId, accountId),
          eq(pointsPostings.debitAccountId, accountId),
        ),
      );
    const registrations = [
      ...new Set(
        own
          .filter((p) => p.eventId.startsWith(RESERVE_FACT))
          .map((p) => p.eventId.slice(RESERVE_FACT.length)),
      ),
    ];
    const lifecycle =
      registrations.length === 0
        ? []
        : await this.db
            .select(columns)
            .from(pointsPostings)
            .where(
              inArray(
                pointsPostings.eventId,
                registrations.flatMap((r) => [
                  `${RESERVE_FACT}${r}`,
                  `${SETTLE_FACT}${r}`,
                  `${RELEASE_FACT}${r}`,
                ]),
              ),
            );
    const byId = new Map([...own, ...lifecycle].map((p) => [p.id, p]));
    return [...byId.values()].map(({ id: _id, ...p }) => ({
      ...p,
      // Attention-points postings always carry a denomination (0058 trigger).
      denomination: p.denomination as FoldPosting["denomination"],
    }));
  }

  /** A system account of the attention-points unit, opened on first need. */
  async resolveSystemAccount(
    code: PointsSystemCode,
    executor: Executor = this.db,
  ): Promise<PointsAccountRow> {
    await executor
      .insert(pointsAccounts)
      .values({ subjectKind: "system", systemCode: code, unit: UNIT })
      .onConflictDoNothing({
        target: [pointsAccounts.systemCode, pointsAccounts.unit],
      });
    const [row] = await executor
      .select()
      .from(pointsAccounts)
      .where(
        and(eq(pointsAccounts.systemCode, code), eq(pointsAccounts.unit, UNIT)),
      );
    if (!row) throw new Error("points: system account vanished after open");
    return row;
  }

  /**
   * Writes one domain fact in ONE transaction — the caller's when `executor`
   * is a transaction (025-design §1: producers post inside their own
   * transaction; the fact runs in a savepoint, so a refusal rolls back only
   * the fact), else its own:
   *  0. refuses a fact dated more than a day ahead, writing nothing (EARS-27 —
   *     it would land in the default partition and block partition creation),
   *     and a fact with a leg debiting Bre or Con from a person account that
   *     is not a compensating reversal (EARS-12 — no penalty, no conversion);
   *  1. opens every account the legs name in one deterministic key order, then
   *     locks the person accounts (`SELECT … FOR UPDATE`, id order) —
   *     per-account serialisation (EARS-22). Both orders are global, so two
   *     facts naming the same accounts in opposite leg order cannot deadlock;
   *  2. inserts the fact's `points_posting_keys` row; a conflict on its
   *     `event_id` OR its dedupe key writes nothing and answers `duplicate`
   *     with the existing postings (EARS-4 — the constraint is the authority).
   *     Idempotency precedes the account state: a replay still answers
   *     `duplicate` after the account closed;
   *  3. refuses a closed person account, writing nothing (EARS-31);
   *  4. refuses any leg that would take a person's available Pul below zero
   *     (EARS-22);
   *  5. writes the postings (immutable, partitioned — EARS-27).
   */
  async post(
    input: PointsFact,
    executor: Executor = this.db,
  ): Promise<PointsPostOutcome> {
    const fact = PointsFactSchema.parse(input);
    if (fact.occurredAt.getTime() > Date.now() + POINTS_FUTURE_SKEW_MS) {
      throw new PointsLedgerError("POINTS_OCCURRED_AT_FUTURE");
    }
    if (fact.legs.some(debitsBreOrCon)) {
      throw new PointsLedgerError("POINTS_BRE_CON_DEBIT");
    }
    return executor.transaction(async (tx) => {
      const refs = new Map<string, PointsAccountRef>();
      for (const leg of fact.legs) {
        refs.set(refKey(leg.debit), leg.debit);
        refs.set(refKey(leg.credit), leg.credit);
      }
      const accounts = new Map<string, PointsAccountRow>();
      for (const key of [...refs.keys()].sort()) {
        const ref = refs.get(key)!;
        accounts.set(
          key,
          ref.kind === "person"
            ? await this.resolvePersonAccount(ref.personId, tx)
            : await this.resolveSystemAccount(ref.code, tx),
        );
      }
      const accountId = (ref: PointsAccountRef): string =>
        accounts.get(refKey(ref))!.id;
      const legs: Array<ResolvedLeg & { source: PointsFact["legs"][number] }> =
        fact.legs.map((leg) => ({
          leg: leg.leg,
          denomination: leg.denomination,
          amount: leg.amount,
          debitAccountId: accountId(leg.debit),
          creditAccountId: accountId(leg.credit),
          source: leg,
        }));

      const personIds = [...accounts.entries()]
        .filter(([key]) => key.startsWith("p:"))
        .map(([, row]) => row.id)
        .sort();
      const locked =
        personIds.length === 0
          ? []
          : await tx
              .select()
              .from(pointsAccounts)
              .where(inArray(pointsAccounts.id, personIds))
              .orderBy(asc(pointsAccounts.id))
              .for("update");

      const inserted = await tx
        .insert(pointsPostingKeys)
        .values({
          eventId: fact.eventId,
          dedupeKey: fact.dedupeKey ?? null,
          occurredMonth: occurredMonth(fact.occurredAt),
        })
        .onConflictDoNothing()
        .returning({ eventId: pointsPostingKeys.eventId });
      if (inserted.length === 0) {
        return {
          status: "duplicate" as const,
          postings: await this.existingPostings(tx, fact),
        };
      }
      if (locked.some((account) => account.closedAt !== null)) {
        throw new PointsLedgerError("POINTS_ACCOUNT_CLOSED");
      }

      const balances = new Map<string, number>();
      for (const id of personIds) balances.set(id, await pulBalance(tx, id));
      if (firstOverdrawingLeg(balances, legs) !== null) {
        throw new PointsLedgerError("POINTS_INSUFFICIENT_PUL");
      }

      const rows = await tx
        .insert(pointsPostings)
        .values(
          legs.map(({ source, debitAccountId, creditAccountId }) => ({
            eventId: fact.eventId,
            leg: source.leg,
            debitAccountId,
            creditAccountId,
            denomination: source.denomination,
            amount: source.amount,
            action: source.action ?? null,
            projectId: source.projectId ?? null,
            outputType: source.outputType ?? null,
            outputId: source.outputId ?? null,
            ruleId: source.ruleId,
            ruleVersion: source.ruleVersion,
            attributedOrganisationId: source.attributedOrganisationId ?? null,
            attributedMemberId: source.attributedMemberId ?? null,
            reversesPostingId: source.reverses?.postingId ?? null,
            reversesOccurredAt: source.reverses?.occurredAt ?? null,
            occurredAt: fact.occurredAt,
          })),
        )
        .returning();
      return { status: "posted" as const, postings: rows.map(toPosting) };
    });
  }

  /**
   * EARS-31 — the personal-data lifecycle closes (freezes) the person's
   * account. Idempotent: an already-closed account keeps its first
   * `closed_at`. Existing postings are untouched; no reserve is released and
   * no obligation settled here (025-design §9).
   */
  async close(personId: string, at: Date): Promise<PointsAccountRow> {
    return this.db.transaction(async (tx) => {
      const account = await this.resolvePersonAccount(personId, tx);
      const [closed] = await tx
        .update(pointsAccounts)
        .set({ closedAt: at })
        .where(
          and(
            eq(pointsAccounts.id, account.id),
            isNull(pointsAccounts.closedAt),
          ),
        )
        .returning();
      return closed ?? account;
    });
  }

  /** The postings of the fact that already holds this event id or dedupe key. */
  private async existingPostings(
    tx: Tx,
    fact: PointsFact,
  ): Promise<PointsPosting[]> {
    const [key] = await tx
      .select({ eventId: pointsPostingKeys.eventId })
      .from(pointsPostingKeys)
      .where(
        fact.dedupeKey === undefined
          ? eq(pointsPostingKeys.eventId, fact.eventId)
          : or(
              eq(pointsPostingKeys.eventId, fact.eventId),
              eq(pointsPostingKeys.dedupeKey, fact.dedupeKey),
            ),
      )
      .limit(1);
    if (!key) return [];
    const rows = await tx
      .select()
      .from(pointsPostings)
      .where(eq(pointsPostings.eventId, key.eventId))
      .orderBy(asc(pointsPostings.leg));
    return rows.map(toPosting);
  }
}

/**
 * EARS-12 — Bre and Con only grow: a leg may debit them from a person account
 * only as a compensating posting that reverses a specific earlier posting
 * (EARS-28). Every leg carries one denomination, so with this refusal no fact
 * can move value out of a person's Bre/Con — a conversion between
 * denominations has no leg to stand on.
 */
export function debitsBreOrCon(leg: PointsFact["legs"][number]): boolean {
  return (
    leg.debit.kind === "person" &&
    leg.denomination !== "pul" &&
    leg.reverses === undefined
  );
}

/** First day (UTC) of the fact's month, as a SQL `date` literal. */
function occurredMonth(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** EARS-22 fold — available Pul = Σ credits − Σ debits of the account. */
async function pulBalance(tx: Tx, accountId: string): Promise<number> {
  const [row] = await tx
    .select({
      balance: sql<string>`coalesce(sum(case when ${pointsPostings.creditAccountId} = ${accountId} then ${pointsPostings.amount} else -${pointsPostings.amount} end), 0)`,
    })
    .from(pointsPostings)
    .where(
      and(
        eq(pointsPostings.denomination, "pul"),
        or(
          eq(pointsPostings.creditAccountId, accountId),
          eq(pointsPostings.debitAccountId, accountId),
        ),
      ),
    );
  return Number(row?.balance ?? 0);
}

function toPosting(row: PointsPostingRow): PointsPosting {
  return {
    id: row.id,
    eventId: row.eventId,
    leg: row.leg,
    debitAccountId: row.debitAccountId,
    creditAccountId: row.creditAccountId,
    // The ledger core writes attention-points postings only; the insert
    // trigger (0058) guarantees a denomination on every such row.
    denomination: row.denomination as PointsPosting["denomination"],
    amount: row.amount,
    ruleId: row.ruleId,
    ruleVersion: row.ruleVersion,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
  };
}
