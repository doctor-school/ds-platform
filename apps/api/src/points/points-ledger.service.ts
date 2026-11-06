import { Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  type PointsAccountRow,
  type PointsPostingRow,
  pointsAccounts,
  pointsPostingKeys,
  pointsPostings,
} from "@ds/db";
import {
  type PointsAccountRef,
  type PointsFact,
  PointsFactSchema,
  type PointsPosting,
  type PointsPostOutcome,
  type PointsSystemCode,
} from "@ds/schemas";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { firstOverdrawingLeg, type ResolvedLeg } from "./points-balance.js";
import { PointsLedgerError } from "./points.errors.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

const UNIT = "attention_points" as const;

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
   * Writes one domain fact in ONE transaction:
   *  1. resolves every account the legs name and locks the person accounts
   *     (`SELECT … FOR UPDATE`, id order) — per-account serialisation (EARS-22);
   *  2. refuses a closed person account, writing nothing (EARS-31);
   *  3. inserts the fact's `points_posting_keys` row first; a conflict on its
   *     `event_id` OR its dedupe key writes nothing and answers `duplicate`
   *     with the existing postings (EARS-4 — the constraint is the authority);
   *  4. refuses any leg that would take a person's available Pul below zero
   *     (EARS-22);
   *  5. writes the postings (immutable, partitioned — EARS-27).
   */
  async post(input: PointsFact): Promise<PointsPostOutcome> {
    const fact = PointsFactSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const accountIds = new Map<string, PointsAccountRow>();
      const resolve = async (ref: PointsAccountRef): Promise<string> => {
        const key =
          ref.kind === "person" ? `p:${ref.personId}` : `s:${ref.code}`;
        let row = accountIds.get(key);
        if (!row) {
          row =
            ref.kind === "person"
              ? await this.resolvePersonAccount(ref.personId, tx)
              : await this.resolveSystemAccount(ref.code, tx);
          accountIds.set(key, row);
        }
        return row.id;
      };
      const legs: Array<ResolvedLeg & { source: PointsFact["legs"][number] }> =
        [];
      for (const leg of fact.legs) {
        legs.push({
          leg: leg.leg,
          denomination: leg.denomination,
          amount: leg.amount,
          debitAccountId: await resolve(leg.debit),
          creditAccountId: await resolve(leg.credit),
          source: leg,
        });
      }

      const personIds = [...accountIds.entries()]
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
      if (locked.some((account) => account.closedAt !== null)) {
        throw new PointsLedgerError("POINTS_ACCOUNT_CLOSED");
      }

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
