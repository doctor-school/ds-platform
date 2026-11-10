import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  type PointsFactRow,
  type PointsPriceRow,
  pointsAccounts,
  pointsFacts,
  pointsPostingKeys,
  pointsPostings,
} from "@ds/db";
import {
  getPointsFactType,
  pointsFactAttributesSchema,
  PointsRecordFactSchema,
  type PointsCreditedEvent,
  type PointsEarnHint,
  type PointsFactTypeEntry,
  type PointsParsedRecordFact,
  type PointsPosting,
  type PointsPostingLeg,
  type PointsRecordFact,
  type PointsRecordOutcome,
  type PointsRule,
  type PointsRuleEffectKind,
  type PointsRuleLimit,
  type PointsSettingId,
  type PointsTraceEntry,
} from "@ds/schemas";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withRequestAuditContext } from "../../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../../database/database.tokens.js";
import {
  type PointsAdvanceSettledEvent,
  PointsEventsPublisher,
} from "../points-events.js";
import { POINTS_FUTURE_SKEW_MS, PointsLedgerService } from "../points-ledger.service.js";
import { PointsLedgerError } from "../points.errors.js";
import { type CandidateRule, RuleBookService } from "../rule-book.service.js";
import { conditionTypeContext, evaluateCondition } from "./condition.js";
import { HoldBook, isChargeable } from "./holds.js";
import { moscowPeriod } from "./period.js";
import { JournalPredicateResolver } from "./predicates.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const DENOMINATIONS = ["pul", "bre", "con"] as const;
/** Stands in for an account a `quote` reads that does not exist yet (it matches no row). */
const NO_ACCOUNT = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** EARS-33 — a fact its catalog entry refuses; thrown, nothing written. */
export class PointsFactRefusedError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`points: fact refused at ${path || "(fact)"}: ${message}`);
    this.name = "PointsFactRefusedError";
  }
}

/** One applied rule of a fact (amended EARS-3). */
export interface PointsApplication {
  ruleId: string;
  ruleVersion: number;
  effect: PointsRuleEffectKind;
  /** The ledger fact `<fact event id>#<rule id>`. */
  ledgerEventId: string;
  postings: PointsPosting[];
}

/** One rule a `quote` says would apply (EARS-41): its legs, nothing written. */
export interface PointsQuoteApplication {
  ruleId: string;
  ruleVersion: number;
  effect: PointsRuleEffectKind;
  ledgerEventId: string;
  legs: PointsPostingLeg[];
}

/**
 * EARS-41 — what `quote` answers: the would-be outcome of `record`, the rules
 * that would apply with their legs, and the problem a refusal would raise
 * (`outcome: "refused"`, nothing applies). Nothing is written, locked or
 * published.
 */
export interface PointsQuoteResult {
  outcome: PointsRecordOutcome | "refused";
  applied: PointsQuoteApplication[];
  trace: PointsTraceEntry[];
  refusal?: PointsLedgerError;
}

type EvaluationMode = "record" | "quote";

/** One applied rule inside an evaluation, before it is shaped for `record` or `quote`. */
interface Applied {
  ruleId: string;
  ruleVersion: number;
  effect: PointsRuleEffectKind;
  ledgerEventId: string;
  legs: PointsPostingLeg[];
  postings: PointsPosting[];
  /** EARS-20 — what this credit netted of open obligations, per person. */
  netted: Netting[];
}

/** EARS-20 — what one Pul credit netted of a person's open obligations. */
interface Netting {
  personId: string;
  settled: number;
  /** Σ remaining of the person's open obligations after the netting. */
  remaining: number;
}

/**
 * EARS-20 — the open obligations of the person accounts one evaluation
 * nets, read once (after the person locks of `record`) and kept current as
 * each credit the ledger applies nets them, so two credits of one fact never
 * net the same Pul twice — under `quote` too, which writes nothing.
 */
class OpenObligations {
  private readonly byAccount = new Map<
    string,
    Array<{ id: string; remaining: number }>
  >();

  constructor(
    private readonly holds: HoldBook,
    private readonly executor: Tx,
  ) {}

  async of(personAccountId: string) {
    let open = this.byAccount.get(personAccountId);
    if (!open) {
      open = await this.holds.openObligations(this.executor, personAccountId);
      this.byAccount.set(personAccountId, open);
    }
    return open;
  }
}

/** EARS-33 — what `record` answers. */
export interface PointsRecordResult {
  outcome: PointsRecordOutcome;
  applied: PointsApplication[];
  trace: PointsTraceEntry[];
  /**
   * Publishes one `PointsCredited` per credited person, at most once. A
   * producer that passed its own transaction MUST call it after its COMMIT
   * and never after a rollback; `record(fact)` calls it itself.
   */
  publishAfterCommit: () => Promise<void>;
}

/** A candidate that passed validity, active and its condition. */
interface Eligible {
  candidate: CandidateRule;
  trace: PointsTraceEntry;
  beneficiaryId: string;
  dedupeKey: string | undefined;
}

/** The value of one limit scope field for this fact (EARS-36). */
function limitScopeValue(
  fact: PointsParsedRecordFact,
  beneficiaryId: string,
  name: string,
): string {
  if (name === "subject") return fact.personId;
  if (name === "beneficiary") return beneficiaryId;
  if (name === "ref") return fact.ref ?? "";
  return String(fact.attributes[name] ?? null);
}

/** A deterministic signed 64-bit advisory-lock key of `text`. */
function advisoryKey(text: string): bigint {
  return createHash("sha256").update(text).digest().readBigInt64BE(0);
}

/** Raised inside the savepoint when a concurrent equal event id won the journal row. */
class JournalRaceLost extends Error {}

/**
 * The 025 rule engine's `record` (EARS-33, amended EARS-3/EARS-4,
 * EARS-34…38, EARS-40; 025-design production amendment D). A producer reports
 * WHAT happened; every rule whose version active at `occurredAt` triggers on
 * the fact's type is evaluated — validity and `active` (EARS-37), condition
 * (EARS-34), limits (EARS-36), exclusive groups (EARS-38) — and every rule
 * that applies is written as one ledger fact `<event id>#<rule id>` through
 * the ledger core, debit-side effects before credits (EARS-35), with the
 * fact's journal row and full trace in the same transaction (EARS-40).
 *
 * The spend effects (EARS-35; 025-design E) read the price list and write
 * the hold projections in the same transaction as their postings: `reserve`
 * holds the item's price from the balance and, on an advance-mode item within
 * the advance cap, the shortfall from the advance, opening an obligation
 * (EARS-14…17); `settle` moves a held price to the sink; `release` reverses
 * the hold's postings and its obligation's netting (EARS-18); a `settle` /
 * `release` with no open hold is traced `no-open-hold`. Every Pul credit
 * first nets the beneficiary's open obligations (EARS-20).
 *
 * `quote` (EARS-41) runs the very same evaluation in a READ ONLY transaction
 * with no locks and no inserts — one code path, so an advertised decision and
 * the enforced one cannot diverge.
 */
@Injectable()
export class PointsEngine {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(RuleBookService) private readonly rules: RuleBookService,
    @Inject(PointsLedgerService) private readonly ledger: PointsLedgerService,
    @Inject(PointsEventsPublisher)
    private readonly events: PointsEventsPublisher,
  ) {}

  private readonly holds = new HoldBook();

  /**
   * EARS-41 — the same evaluation as {@link record} for `personId`'s draft
   * fact, in a READ ONLY transaction with no locks and no inserts. A fact
   * whose event id is already journaled answers `duplicate`; a refusing
   * debit-side effect answers `refused` with its problem.
   */
  async quote(
    personId: string,
    draft: Omit<PointsRecordFact, "personId">,
  ): Promise<PointsQuoteResult> {
    const { fact, entry } = validate({ ...draft, personId });
    if (fact.occurredAt.getTime() > Date.now() + POINTS_FUTURE_SKEW_MS) {
      throw new PointsLedgerError("POINTS_OCCURRED_AT_FUTURE");
    }
    return this.db.transaction(
      async (tx): Promise<PointsQuoteResult> => {
        if (await this.journalRow(tx, fact.eventId)) {
          return { outcome: "duplicate", applied: [], trace: [] };
        }
        const trace: PointsTraceEntry[] = [];
        try {
          const evaluated = await this.evaluate(tx, fact, entry, "quote", trace);
          return {
            outcome: evaluated.outcome,
            applied: evaluated.applied.map(
              ({ postings: _p, netted: _n, ...a }) => a,
            ),
            trace,
          };
        } catch (error) {
          if (!(error instanceof PointsLedgerError)) throw error;
          return { outcome: "refused", applied: [], trace, refusal: error };
        }
      },
      { accessMode: "read only" },
    );
  }

  /** Record in a transaction of the engine's own; publishes after its COMMIT. */
  async record(fact: PointsRecordFact): Promise<PointsRecordResult>;
  /** Record inside the producer's transaction, as a savepoint. */
  async record(tx: Tx, fact: PointsRecordFact): Promise<PointsRecordResult>;
  async record(
    a: Tx | PointsRecordFact,
    b?: PointsRecordFact,
  ): Promise<PointsRecordResult> {
    if (b === undefined) {
      const fact = a as PointsRecordFact;
      const result = await withRequestAuditContext(this.db, (own) =>
        this.recordWithin(own, fact),
      );
      await result.publishAfterCommit();
      return result;
    }
    return this.recordWithin(a as Tx, b);
  }

  private async recordWithin(
    tx: Tx,
    input: PointsRecordFact,
  ): Promise<PointsRecordResult> {
    const { fact, entry } = validate(input);
    if (fact.occurredAt.getTime() > Date.now() + POINTS_FUTURE_SKEW_MS) {
      throw new PointsLedgerError("POINTS_OCCURRED_AT_FUTURE");
    }
    const journaled = await this.journalRow(tx, fact.eventId);
    if (journaled) return this.duplicateOf(tx, journaled);
    try {
      return await tx.transaction(async (sp) => {
        const trace: PointsTraceEntry[] = [];
        const { outcome, applied, accounts } = await this.evaluate(
          sp,
          fact,
          entry,
          "record",
          trace,
        );
        const inserted = await sp
          .insert(pointsFacts)
          .values({
            eventId: fact.eventId,
            type: fact.type,
            personId: fact.personId,
            refKind: fact.ref !== undefined ? entry.refKind : null,
            refId: fact.ref ?? null,
            attributes: fact.attributes,
            occurredAt: fact.occurredAt,
            outcome,
            trace,
          })
          .onConflictDoNothing()
          .returning({ eventId: pointsFacts.eventId });
        if (inserted.length === 0) throw new JournalRaceLost();
        const applications: PointsApplication[] = applied.map(
          ({ legs: _l, netted: _n, ...a }) => a,
        );
        return {
          outcome,
          applied: applications,
          trace,
          publishAfterCommit: this.publisher(
            fact.eventId,
            applications,
            accounts,
            applied.flatMap((a) => a.netted),
          ),
        };
      });
    } catch (error) {
      if (!(error instanceof JournalRaceLost)) throw error;
      const original = await this.journalRow(tx, fact.eventId);
      if (!original) {
        throw new Error("points: journal row vanished after a race", {
          cause: error,
        });
      }
      return this.duplicateOf(tx, original);
    }
  }

  /**
   * The one evaluation of `record` and `quote` (025-design D). `record`
   * locks the person accounts and the `countPer` scopes and writes postings
   * and projections; `quote` reads the same state and writes nothing. The
   * caller writes the journal row (`record`) from the returned outcome and
   * the `trace` it passed in, which is filled as the evaluation goes.
   */
  private async evaluate(
    sp: Tx,
    fact: PointsParsedRecordFact,
    entry: PointsFactTypeEntry,
    mode: EvaluationMode,
    trace: PointsTraceEntry[],
  ): Promise<{
    outcome: PointsRecordOutcome;
    applied: Applied[];
    accounts: Map<string, string>;
  }> {
    const write = mode === "record";
    const candidates = await this.rules.candidatesFor(
      fact.type,
      fact.occurredAt,
      sp,
    );
    const settings = await this.rules.settingsAt(fact.occurredAt, sp);

    // Beneficiaries a predicate names are resolved first, so that every
    // person account is locked in one ascending order (no deadlock between
    // two facts touching the same two people).
    const lookup = new JournalPredicateResolver(sp, fact);
    const beneficiaries = new Map<string, string | null>();
    for (const c of candidates) {
      const effect = c.rule.effect;
      if (effect.kind === "credit" && typeof effect.beneficiary === "object") {
        const value = await lookup.resolve(effect.beneficiary.pred, {});
        beneficiaries.set(
          c.ruleId,
          typeof value === "string" && UUID.test(value) ? value : null,
        );
      }
    }
    const persons = [
      fact.personId,
      ...[...beneficiaries.values()].filter((v): v is string => v !== null),
    ];
    const accounts = write
      ? await this.lockAccounts(sp, persons)
      : await this.existingAccounts(sp, persons);
    if (write) {
      // Under the subject's lock: a concurrent equal event id has committed.
      if (await this.journalRow(sp, fact.eventId)) throw new JournalRaceLost();
      await this.lockCountScopes(sp, fact, candidates, beneficiaries);
    }
    // EARS-26 — the item's price-list row, read after the person locks.
    const price =
      entry.refKind === "item"
        ? await this.holds.priceOf(sp, fact.ref)
        : undefined;

    const predicates = new JournalPredicateResolver(sp, fact);
    const env = {
      types: conditionTypeContext(fact.type),
      attributes: fact.attributes,
      predicates,
      settings,
    };
    const eligible: Eligible[] = [];
    for (const candidate of candidates) {
      const rule = candidate.rule;
      const t: PointsTraceEntry = {
        ruleId: candidate.ruleId,
        version: candidate.version,
        trigger: true,
        active: rule.active,
        valid: null,
        condition: null,
        limits: [],
        stacking: null,
        verdict: "inactive",
      };
      trace.push(t);
      if (!rule.active) continue;
      t.valid = withinWindow(rule, fact.occurredAt);
      if (!t.valid) {
        t.verdict = "not-valid";
        continue;
      }
      const beneficiaryId =
        rule.effect.kind === "credit" &&
        typeof rule.effect.beneficiary === "object"
          ? (beneficiaries.get(candidate.ruleId) ?? null)
          : fact.personId;
      t.condition =
        (await evaluateCondition(rule.condition, env)) && beneficiaryId !== null;
      if (!t.condition || beneficiaryId === null) {
        t.verdict = "condition-false";
        continue;
      }
      const { reached, dedupeKey } = await this.checkLimits(sp, {
        candidate,
        fact,
        beneficiaryId,
        beneficiaryAccountId: accounts.get(beneficiaryId) ?? NO_ACCOUNT,
        subjectAccountId: accounts.get(fact.personId),
        price,
        settings,
        trace: t,
      });
      if (reached) {
        t.verdict = "limit-reached";
        continue;
      }
      eligible.push({ candidate, trace: t, beneficiaryId, dedupeKey });
    }

    // EARS-38 — exclusive groups after conditions, validity and limits: a
    // rule its limit stopped never suppresses a lower-priority member.
    const winners = resolveStacking(eligible);

    // EARS-35 — debit-side effects first; a refusal throws and the savepoint
    // takes every write of this fact with it, the journal row included.
    const ordered = [
      ...winners.filter((e) => e.candidate.rule.effect.kind !== "credit"),
      ...winners.filter((e) => e.candidate.rule.effect.kind === "credit"),
    ];
    const applied: Applied[] = [];
    const obligations = new OpenObligations(this.holds, sp);
    for (const e of ordered) {
      const effect = e.candidate.rule.effect;
      const ledgerEventId = `${fact.eventId}#${e.candidate.ruleId}`;
      const planned = await this.planEffect(sp, {
        fact,
        e,
        effect,
        price,
        predicates,
        settings,
        obligations,
        subjectAccountId: accounts.get(fact.personId),
        beneficiaryAccountId: accounts.get(e.beneficiaryId),
        ledgerEventId,
      });
      if ("verdict" in planned) {
        e.trace.verdict = planned.verdict;
        continue;
      }
      if (planned.legs.length === 0) continue;
      const ledgerFact = {
        eventId: ledgerEventId,
        ...(e.dedupeKey !== undefined ? { dedupeKey: e.dedupeKey } : {}),
        occurredAt: fact.occurredAt,
        legs: planned.legs,
      };
      const posted = write
        ? await this.ledger.post(ledgerFact, sp)
        : { ...(await this.ledger.preview(ledgerFact, sp)), postings: [] };
      if (posted.status === "duplicate") {
        // Another rule of this fact took the shared limit key first.
        e.trace.verdict = "limit-reached";
        const once = e.trace.limits.find((l) => l.kind === "oncePer");
        if (once) once.verdict = "limit-reached";
        continue;
      }
      planned.commit?.();
      if (write && planned.project) await planned.project(sp);
      e.trace.verdict = "applied";
      e.trace.ledgerEventId = ledgerEventId;
      applied.push({
        ruleId: e.candidate.ruleId,
        ruleVersion: e.candidate.version,
        effect: effect.kind,
        ledgerEventId,
        legs: planned.legs,
        postings: posted.postings,
        netted: planned.netted ?? [],
      });
    }

    return { outcome: outcomeOf(trace, applied), applied, accounts };
  }

  /**
   * The legs of one effect and, for a spend effect, the projection write
   * that goes with them (EARS-35; 025-design E) — or the verdict that it has
   * nothing to do. A refusal throws its problem.
   */
  private async planEffect(
    sp: Tx,
    ctx: {
      fact: PointsParsedRecordFact;
      e: Eligible;
      effect: PointsRule["effect"];
      price: PointsPriceRow | undefined;
      predicates: JournalPredicateResolver;
      settings: Record<PointsSettingId, number>;
      obligations: OpenObligations;
      subjectAccountId: string | undefined;
      beneficiaryAccountId: string | undefined;
      ledgerEventId: string;
    },
  ): Promise<
    | {
        legs: PointsPostingLeg[];
        project?: (tx: Tx) => Promise<void>;
        netted?: Netting[];
        /** Applies the plan to the in-memory view once the ledger posted it. */
        commit?: () => void;
      }
    | { verdict: "no-price" | "no-open-hold" | "limit-reached" }
  > {
    const { fact, e, effect, price, subjectAccountId } = ctx;
    const common = commonOf(fact, e);
    const person = { kind: "person", personId: fact.personId } as const;
    switch (effect.kind) {
      case "credit": {
        const beneficiary = { kind: "person", personId: e.beneficiaryId } as const;
        const legs = DENOMINATIONS.filter((d) => effect.amounts[d] > 0).map(
          (d): PointsPostingLeg => ({
            leg: `accrual:${d}`,
            debit: { kind: "system", code: "issuance" },
            credit: beneficiary,
            denomination: d,
            amount: effect.amounts[d],
            ...common,
          }),
        );
        // EARS-20 — the Pul credit nets the beneficiary's open obligations
        // first, oldest first, inside this very ledger fact.
        const open =
          effect.amounts.pul > 0 && ctx.beneficiaryAccountId
            ? await ctx.obligations.of(ctx.beneficiaryAccountId)
            : [];
        const nets: Array<{ id: string; amount: number }> = [];
        let left = effect.amounts.pul;
        for (const o of open) {
          if (left === 0) break;
          const amount = Math.min(left, o.remaining);
          if (amount === 0) continue;
          left -= amount;
          nets.push({ id: o.id, amount });
          legs.push({
            leg: `obligation-settle:${o.id}`,
            debit: beneficiary,
            credit: { kind: "system", code: "advance" },
            denomination: "pul",
            amount,
            ...common,
          });
        }
        if (nets.length === 0) return { legs };
        const settled = nets.reduce((sum, n) => sum + n.amount, 0);
        return {
          legs,
          // EARS-20 — a credit the ledger answers `duplicate` nets nothing.
          commit: () => {
            for (const n of nets) {
              const o = open.find((x) => x.id === n.id);
              if (o) o.remaining -= n.amount;
            }
          },
          project: async (tx) => {
            for (const n of nets) {
              await this.holds.netObligation(tx, n.id, n.amount);
            }
          },
          netted: [
            {
              personId: e.beneficiaryId,
              settled,
              remaining: open.reduce((sum, o) => sum + o.remaining, 0) - settled,
            },
          ],
        };
      }
      case "debit": {
        const amount =
          effect.amounts === "price"
            ? isChargeable(price)
              ? price.pulCost
              : 0
            : effect.amounts.pul;
        if (amount === 0) return { verdict: "no-price" };
        await requirePhone(ctx.predicates);
        return {
          legs: [
            {
              leg: "debit:pul",
              debit: person,
              credit: { kind: "system", code: "sink" },
              denomination: "pul",
              amount,
              ...common,
            },
          ],
        };
      }
      case "reserve": {
        // EARS-14 — an open item or a zero price writes nothing.
        if (!isChargeable(price)) return { verdict: "no-price" };
        const registrationId = String(fact.attributes.registrationId);
        if (await this.holds.anyReserve(sp, registrationId)) {
          // The hold key is the registration: one hold per registration.
          return { verdict: "limit-reached" };
        }
        await requirePhone(ctx.predicates);
        const available = subjectAccountId
          ? await this.ledger.availablePul(subjectAccountId, sp)
          : 0;
        const balancePart = Math.min(available, price.pulCost);
        const advancePart = price.pulCost - balancePart;
        if (advancePart > 0) {
          // EARS-15 / EARS-16 / EARS-17 — an advance-mode item covers the
          // shortfall from the advance while the person's open obligations
          // stay within the cap; otherwise it refuses like a threshold one.
          const owed = subjectAccountId
            ? (await this.holds.projection(sp, subjectAccountId)).advance
                .remaining
            : 0;
          const advance =
            price.mode === "advance" &&
            effect.allowAdvance &&
            owed + advancePart <= ctx.settings["setting.advance.cap"];
          if (!advance) {
            throw await this.thresholdShort(
              sp,
              fact.occurredAt,
              subjectAccountId,
              advancePart,
            );
          }
        }
        const reserve = { kind: "system", code: "reserve" } as const;
        const legs: PointsPostingLeg[] = [];
        if (balancePart > 0) {
          legs.push({
            leg: "reserve:balance",
            debit: person,
            credit: reserve,
            denomination: "pul",
            amount: balancePart,
            ...common,
          });
        }
        if (advancePart > 0) {
          legs.push({
            leg: "reserve:advance",
            debit: { kind: "system", code: "advance" },
            credit: reserve,
            denomination: "pul",
            amount: advancePart,
            ...common,
          });
        }
        return {
          legs,
          project: (tx) =>
            this.holds.insertReserve(tx, {
              registrationId,
              personAccountId: subjectAccountId!,
              itemRef: price.itemRef,
              price: price.pulCost,
              balancePart,
              advancePart,
              reserveEventId: ctx.ledgerEventId,
              heldAt: fact.occurredAt,
            }),
        };
      }
      case "settle":
      case "release": {
        const registrationId = fact.attributes.registrationId;
        const hold =
          typeof registrationId === "string" && subjectAccountId
            ? await this.holds.heldReserve(
                sp,
                registrationId,
                subjectAccountId,
                fact.ref,
              )
            : undefined;
        if (!hold) return { verdict: "no-open-hold" };
        const close = (tx: Tx) =>
          this.holds.closeReserve(
            tx,
            hold.registrationId,
            effect.kind === "settle" ? "settled" : "released",
            ctx.ledgerEventId,
            fact.occurredAt,
          );
        if (effect.kind === "settle") {
          // EARS-19 — the held price moves to the sink, once per registration.
          return {
            legs: [
              {
                leg: "settle:pul",
                debit: { kind: "system", code: "reserve" },
                credit: { kind: "system", code: "sink" },
                denomination: "pul",
                amount: hold.price,
                ...common,
              },
            ],
            project: close,
          };
        }
        // EARS-18 — one compensating `reverse:<postingId>` leg per
        // reserve-side posting and per netting leg of this hold's own
        // obligation; the person ends as if never registered.
        const obligation = await this.holds.obligationOf(
          sp,
          hold.registrationId,
        );
        const reserved = [
          ...(await this.holds.reservePostings(sp, hold.reserveEventId)),
          ...(obligation
            ? await this.holds.nettingPostings(sp, obligation)
            : []),
        ];
        return {
          project: async (tx) => {
            await close(tx);
            if (obligation) await this.holds.annulObligation(tx, obligation.id);
          },
          legs: reserved.map(
            (p): PointsPostingLeg => ({
              leg: `reverse:${p.id}`,
              debit: p.credit,
              credit: p.debit,
              denomination: "pul",
              amount: p.amount,
              reverses: { postingId: p.id, occurredAt: p.occurredAt },
              ...common,
            }),
          ),
        };
      }
    }
  }

  /** EARS-17 / EARS-13 — the threshold refusal with its shortfall and earn hint. */
  private async thresholdShort(
    executor: Tx,
    at: Date,
    subjectAccountId: string | undefined,
    shortfall: number,
  ): Promise<PointsLedgerError> {
    const earnHint = await this.earnHint(
      executor,
      at,
      subjectAccountId,
      shortfall,
    );
    return new PointsLedgerError(
      "POINTS_THRESHOLD_SHORT",
      `short by ${shortfall} Pul`,
      undefined,
      { shortfall, earnHint },
    );
  }

  /**
   * EARS-13 — `pulToEarn` = shortfall + the remaining open obligations
   * (EARS-20 nets new Pul to them first); `lessonsNeeded` =
   * ceil(pulToEarn / the Pul credit of the active `accrual.lesson`), null
   * when no active version credits Pul.
   */
  private async earnHint(
    executor: Tx,
    at: Date,
    subjectAccountId: string | undefined,
    shortfall: number,
  ): Promise<PointsEarnHint> {
    const remaining = subjectAccountId
      ? (await this.holds.projection(executor, subjectAccountId)).advance
          .remaining
      : 0;
    const pulToEarn = shortfall + remaining;
    const lesson = (
      await this.rules.candidatesFor("lesson.completed", at, executor)
    ).find((c) => c.ruleId === "accrual.lesson");
    const credit =
      lesson && lesson.rule.active && lesson.rule.effect.kind === "credit"
        ? lesson.rule.effect.amounts.pul
        : 0;
    return {
      pulToEarn,
      lessonsNeeded: credit > 0 ? Math.ceil(pulToEarn / credit) : null,
    };
  }

  /** `quote` — the person accounts that exist, never opened, never locked. */
  private async existingAccounts(
    executor: Tx,
    personIds: string[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const personId of new Set(personIds)) {
      const account = await this.ledger.findPersonAccount(personId, executor);
      if (account) ids.set(personId, account.id);
    }
    return ids;
  }

  /** Opens (EARS-1) and locks `FOR UPDATE` the person accounts, ascending id. */
  private async lockAccounts(
    sp: Tx,
    personIds: string[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const personId of [...new Set(personIds)].sort()) {
      ids.set(personId, (await this.ledger.resolvePersonAccount(personId, sp)).id);
    }
    await sp
      .select({ id: pointsAccounts.id })
      .from(pointsAccounts)
      .where(inArray(pointsAccounts.id, [...ids.values()]))
      .orderBy(asc(pointsAccounts.id))
      .for("update");
    return ids;
  }

  /**
   * EARS-36 — serialises every `countPer` scope this fact may count. The
   * count-then-compare is race-safe only while no concurrent fact can add to
   * the same scope; the person locks cover that only when the counted
   * account is a locked one, and a scope such as an attribute or a shared
   * beneficiary of many subjects (EARS-11) is not. So each scope —
   * (rule id, scope values, period start) — takes a transaction-scoped
   * advisory lock, held to COMMIT, before any count is read. The keys are
   * 64-bit digests acquired in ascending order after the person locks, so two
   * facts that share several scopes never deadlock.
   */
  private async lockCountScopes(
    sp: Tx,
    fact: PointsParsedRecordFact,
    candidates: CandidateRule[],
    beneficiaries: Map<string, string | null>,
  ): Promise<void> {
    const keys = new Set<bigint>();
    for (const c of candidates) {
      if (!c.rule.active) continue;
      const beneficiaryId =
        c.rule.effect.kind === "credit" && typeof c.rule.effect.beneficiary === "object"
          ? (beneficiaries.get(c.ruleId) ?? null)
          : fact.personId;
      if (beneficiaryId === null) continue;
      for (const limit of c.rule.limits) {
        if (!("countPer" in limit)) continue;
        const { start } = moscowPeriod(limit.countPer.period, fact.occurredAt);
        const values = limit.countPer.scope.map((name) =>
          limitScopeValue(fact, beneficiaryId, name),
        );
        keys.add(advisoryKey(JSON.stringify([c.ruleId, values, start.toISOString()])));
      }
    }
    for (const key of [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      await sp.execute(sql`SELECT pg_advisory_xact_lock(${key.toString()}::bigint)`);
    }
  }

  /** EARS-36 — every limit of the rule; all must pass. */
  private async checkLimits(
    sp: Tx,
    ctx: {
      candidate: CandidateRule;
      fact: PointsParsedRecordFact;
      beneficiaryId: string;
      beneficiaryAccountId: string;
      subjectAccountId: string | undefined;
      price: PointsPriceRow | undefined;
      settings: Record<PointsSettingId, number>;
      trace: PointsTraceEntry;
    },
  ): Promise<{ reached: boolean; dedupeKey: string | undefined }> {
    const { candidate, fact, trace } = ctx;
    let dedupeKey: string | undefined;
    let reached = false;
    const scopeValue = (name: string): string =>
      limitScopeValue(fact, ctx.beneficiaryId, name);
    for (const limit of candidate.rule.limits) {
      if ("unlimited" in limit) {
        trace.limits.push({ kind: "unlimited", verdict: "pass" });
        continue;
      }
      if ("oncePer" in limit) {
        const key = `${limit.key ?? candidate.ruleId}:${limit.oncePer.map(scopeValue).join(":")}`;
        dedupeKey = key;
        const [taken] = await sp
          .select({ eventId: pointsPostingKeys.eventId })
          .from(pointsPostingKeys)
          .where(eq(pointsPostingKeys.dedupeKey, key))
          .limit(1);
        const verdict = taken ? "limit-reached" : "pass";
        trace.limits.push({ kind: "oncePer", verdict, key });
        reached ||= taken !== undefined;
        continue;
      }
      if ("countPer" in limit) {
        const count = await this.countApplications(sp, ctx, limit, scopeValue);
        const n =
          typeof limit.countPer.n === "number"
            ? limit.countPer.n
            : ctx.settings[limit.countPer.n.setting];
        const verdict = count >= n ? "limit-reached" : "pass";
        trace.limits.push({ kind: "countPer", verdict });
        reached ||= count >= n;
        continue;
      }
      // EARS-21 — at most n open holds of the person on items matching the
      // filter. It refuses the fact (not a skipped rule); the person lock of
      // `record` serialises it against concurrent reserves.
      const { filter } = limit.concurrentOpen;
      if (reached || !this.holds.matches(ctx.price, filter)) {
        trace.limits.push({ kind: "concurrentOpen", verdict: "pass" });
        continue;
      }
      const n =
        typeof limit.concurrentOpen.n === "number"
          ? limit.concurrentOpen.n
          : ctx.settings[limit.concurrentOpen.n.setting];
      const open = ctx.subjectAccountId
        ? await this.holds.openCount(sp, ctx.subjectAccountId, filter)
        : 0;
      if (open >= n) {
        trace.limits.push({ kind: "concurrentOpen", verdict: "limit-reached" });
        throw new PointsLedgerError(
          "POINTS_RESERVE_LIMIT",
          `${open} open reserves on matching items (limit ${n})`,
        );
      }
      trace.limits.push({ kind: "concurrentOpen", verdict: "pass" });
    }
    return { reached, dedupeKey };
  }

  /**
   * EARS-36 `countPer` — the rule's applications for the same scope in the
   * Europe/Moscow calendar period of `occurredAt`: distinct ledger facts with
   * the rule's id, joined to their journal row (`<fact>#<rule>`) for the
   * subject, ref and attribute scope fields; `beneficiary` is the credited
   * account. Read under the scope's advisory lock (`lockCountScopes`).
   */
  private async countApplications(
    sp: Tx,
    ctx: {
      candidate: CandidateRule;
      fact: PointsParsedRecordFact;
      beneficiaryAccountId: string;
    },
    limit: Extract<PointsRuleLimit, { countPer: unknown }>,
    scopeValue: (name: string) => string,
  ): Promise<number> {
    const { start, end } = moscowPeriod(
      limit.countPer.period,
      ctx.fact.occurredAt,
    );
    const isCredit = ctx.candidate.rule.effect.kind === "credit";
    const filters = limit.countPer.scope.map((name) => {
      if (name === "beneficiary") {
        return isCredit
          ? eq(pointsPostings.creditAccountId, ctx.beneficiaryAccountId)
          : eq(pointsFacts.personId, ctx.fact.personId);
      }
      if (name === "subject") return eq(pointsFacts.personId, ctx.fact.personId);
      if (name === "ref") return eq(pointsFacts.refId, scopeValue("ref"));
      return sql`${pointsFacts.attributes} ->> ${name} = ${scopeValue(name)}`;
    });
    const [row] = await sp
      .select({
        n: sql<string>`count(distinct ${pointsPostings.eventId})`,
      })
      .from(pointsPostings)
      .innerJoin(
        pointsFacts,
        sql`${pointsPostings.eventId} = ${pointsFacts.eventId} || '#' || ${pointsPostings.ruleId}`,
      )
      .where(
        and(
          eq(pointsPostings.ruleId, ctx.candidate.ruleId),
          gte(pointsPostings.occurredAt, start),
          lt(pointsPostings.occurredAt, end),
          ...filters,
        ),
      );
    return Number(row?.n ?? 0);
  }

  private async journalRow(
    executor: Tx,
    eventId: string,
  ): Promise<PointsFactRow | undefined> {
    const [row] = await executor
      .select()
      .from(pointsFacts)
      .where(eq(pointsFacts.eventId, eventId));
    return row;
  }

  /** Amended EARS-4 — a journaled event id: nothing evaluated, the original applications. */
  private async duplicateOf(
    executor: Tx,
    row: PointsFactRow,
  ): Promise<PointsRecordResult> {
    const trace = row.trace as PointsTraceEntry[];
    const appliedTrace = trace.filter((t) => t.ledgerEventId !== undefined);
    const postings =
      appliedTrace.length === 0
        ? []
        : await executor
            .select()
            .from(pointsPostings)
            .where(
              inArray(
                pointsPostings.eventId,
                appliedTrace.map((t) => t.ledgerEventId!),
              ),
            )
            .orderBy(asc(pointsPostings.leg));
    return {
      outcome: "duplicate",
      applied: appliedTrace.map((t) => ({
        ruleId: t.ruleId,
        ruleVersion: t.version,
        effect: effectOfLegs(
          postings.filter((p) => p.eventId === t.ledgerEventId).map((p) => p.leg),
        ),
        ledgerEventId: t.ledgerEventId!,
        postings: postings
          .filter((p) => p.eventId === t.ledgerEventId)
          .map((p) => ({
            id: p.id,
            eventId: p.eventId,
            leg: p.leg,
            debitAccountId: p.debitAccountId,
            creditAccountId: p.creditAccountId,
            denomination: p.denomination as PointsPosting["denomination"],
            amount: p.amount,
            ruleId: p.ruleId,
            ruleVersion: p.ruleVersion,
            occurredAt: p.occurredAt,
            recordedAt: p.recordedAt,
          })),
      })),
      trace,
      publishAfterCommit: async () => {},
    };
  }

  /**
   * One `PointsCredited` per credited person, carrying that person's credit
   * postings, then one `AdvanceSettled` per person whose open obligations
   * the fact netted (EARS-20) — `remaining` as after its last credit.
   */
  private publisher(
    eventId: string,
    applied: PointsApplication[],
    accounts: Map<string, string>,
    netted: Netting[],
  ): () => Promise<void> {
    const settled = new Map<string, PointsAdvanceSettledEvent>();
    for (const n of netted) {
      settled.set(n.personId, {
        personId: n.personId,
        eventId,
        settled: (settled.get(n.personId)?.settled ?? 0) + n.settled,
        remaining: n.remaining,
      });
    }
    const byAccount = new Map<string, string>(
      [...accounts.entries()].map(([personId, accountId]) => [accountId, personId]),
    );
    const events = new Map<string, PointsCreditedEvent>();
    for (const app of applied) {
      if (app.effect !== "credit") continue;
      for (const p of app.postings) {
        const personId = byAccount.get(p.creditAccountId);
        if (!personId) continue;
        const event = events.get(personId) ?? {
          personId,
          eventId,
          postings: [],
        };
        event.postings.push({ denomination: p.denomination, amount: p.amount });
        events.set(personId, event);
      }
    }
    let published = false;
    return async () => {
      if (published) return;
      published = true;
      for (const event of events.values()) {
        await this.events.publishCredited(event);
      }
      for (const event of settled.values()) {
        await this.events.publishAdvanceSettled(event);
      }
    };
  }
}

/** EARS-33 — the catalog's verdict on a fact; throws, nothing written. */
function validate(input: PointsRecordFact): {
  fact: PointsParsedRecordFact;
  entry: PointsFactTypeEntry;
} {
  const parsed = PointsRecordFactSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new PointsFactRefusedError(issue.path.join("."), issue.message);
  }
  const fact = parsed.data;
  const entry = getPointsFactType(fact.type)!;
  if (entry.refKind === "none" && fact.ref !== undefined) {
    throw new PointsFactRefusedError("ref", `${fact.type} carries no ref`);
  }
  if (entry.refKind !== "none" && fact.ref === undefined) {
    throw new PointsFactRefusedError("ref", `${fact.type} requires a ${entry.refKind} ref`);
  }
  const attributes = pointsFactAttributesSchema(entry).safeParse(fact.attributes);
  if (!attributes.success) {
    const issue = attributes.error.issues[0]!;
    throw new PointsFactRefusedError(
      ["attributes", ...issue.path].join("."),
      issue.message,
    );
  }
  return { fact: { ...fact, attributes: attributes.data }, entry };
}

/** EARS-37 — [validFrom, validUntil) on the fact's occurredAt. */
export function withinWindow(rule: PointsRule, at: Date): boolean {
  const t = at.getTime();
  if (rule.validFrom !== null && t < Date.parse(rule.validFrom)) return false;
  if (rule.validUntil !== null && t >= Date.parse(rule.validUntil)) return false;
  return true;
}

/** EARS-38 — per exclusive group the highest priority, a tie to the lowest rule id. */
function resolveStacking(eligible: Eligible[]): Eligible[] {
  const best = new Map<string, Eligible>();
  for (const e of eligible) {
    const group = e.candidate.rule.stacking.exclusiveGroup;
    if (group === null) continue;
    const current = best.get(group);
    const better =
      !current ||
      e.candidate.rule.stacking.priority > current.candidate.rule.stacking.priority ||
      (e.candidate.rule.stacking.priority === current.candidate.rule.stacking.priority &&
        e.candidate.ruleId < current.candidate.ruleId);
    if (better) best.set(group, e);
  }
  return eligible.filter((e) => {
    const group = e.candidate.rule.stacking.exclusiveGroup;
    if (group === null) return true;
    const won = best.get(group) === e;
    e.trace.stacking = won ? "won" : "superseded";
    if (!won) e.trace.verdict = "superseded";
    return won;
  });
}

/** The fields every leg of one applied rule carries (amended EARS-3). */
function commonOf(fact: PointsParsedRecordFact, e: Eligible) {
  return {
    ruleId: e.candidate.ruleId,
    ruleVersion: e.candidate.version,
    action: fact.type,
    ...(fact.projectId ? { projectId: fact.projectId } : {}),
    ...(fact.output ? { outputType: fact.output.type, outputId: fact.output.id } : {}),
    ...(fact.attribution?.organisationId
      ? { attributedOrganisationId: fact.attribution.organisationId }
      : {}),
    ...(fact.attribution?.memberId
      ? { attributedMemberId: fact.attribution.memberId }
      : {}),
  };
}

/** EARS-5 / EARS-35 — no Pul is spendable by a person whose phone is not verified. */
async function requirePhone(predicates: JournalPredicateResolver): Promise<void> {
  if ((await predicates.resolve("person.phoneVerified", {})) !== true) {
    throw new PointsLedgerError("POINTS_PHONE_UNVERIFIED");
  }
}

/** The effect kind of a ledger fact, told from its legs (a `duplicate` answer). */
function effectOfLegs(legs: string[]): PointsRuleEffectKind {
  if (legs.some((l) => l.startsWith("debit:"))) return "debit";
  if (legs.some((l) => l.startsWith("reserve:"))) return "reserve";
  if (legs.some((l) => l.startsWith("settle:"))) return "settle";
  if (legs.some((l) => l.startsWith("reverse:"))) return "release";
  return "credit";
}

/**
 * EARS-33 / amended EARS-4 — `applied` when a rule applied; `duplicate` when
 * every otherwise applicable rule stopped on an existing `oncePer` key;
 * otherwise `no-effect`.
 */
function outcomeOf(
  trace: PointsTraceEntry[],
  applied: readonly unknown[],
): PointsRecordOutcome {
  if (applied.length > 0) return "applied";
  const reachedLimits = trace.filter(
    (t) => t.verdict === "limit-reached" || t.verdict === "superseded",
  );
  const onKey = (t: PointsTraceEntry) =>
    t.limits.some((l) => l.kind === "oncePer" && l.verdict === "limit-reached");
  const stoppedOnKey = trace.filter(
    (t) => t.verdict === "limit-reached" && onKey(t),
  );
  if (
    stoppedOnKey.length > 0 &&
    reachedLimits.every((t) => t.verdict === "superseded" || onKey(t)) &&
    !trace.some((t) => t.verdict === "no-open-hold")
  ) {
    return "duplicate";
  }
  return "no-effect";
}
