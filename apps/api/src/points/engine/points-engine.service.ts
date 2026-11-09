import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  type PointsFactRow,
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
  type PointsFactTypeEntry,
  type PointsParsedRecordFact,
  type PointsPosting,
  type PointsPostingLeg,
  type PointsRecordFact,
  type PointsRecordOutcome,
  type PointsRule,
  type PointsRuleLimit,
  type PointsSettingId,
  type PointsTraceEntry,
} from "@ds/schemas";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withRequestAuditContext } from "../../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../../database/database.tokens.js";
import { PointsEventsPublisher } from "../points-events.js";
import { POINTS_FUTURE_SKEW_MS, PointsLedgerService } from "../points-ledger.service.js";
import { PointsLedgerError } from "../points.errors.js";
import { type CandidateRule, RuleBookService } from "../rule-book.service.js";
import { conditionTypeContext, evaluateCondition } from "./condition.js";
import { moscowPeriod } from "./period.js";
import { JournalPredicateResolver } from "./predicates.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const DENOMINATIONS = ["pul", "bre", "con"] as const;
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
  effect: "credit" | "debit";
  /** The ledger fact `<fact event id>#<rule id>`. */
  ledgerEventId: string;
  postings: PointsPosting[];
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
 * Effects that need the hold projections or the price list ship with #3810
 * (025-design H): a `reserve` and a `debit` of the price-list amount throw
 * (fail closed — the producer's write rolls back); a `settle` or `release`
 * finds no open hold, because none can exist yet, and is traced
 * `no-open-hold` as EARS-35 states. Publishing any of them is refused
 * (`engine/publish-check.ts`); only the 0060 seed carries them.
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
      return await tx.transaction((sp) => this.evaluate(sp, fact, entry));
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

  private async evaluate(
    sp: Tx,
    fact: PointsParsedRecordFact,
    entry: PointsFactTypeEntry,
  ): Promise<PointsRecordResult> {
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
    const accounts = await this.lockAccounts(sp, [
      fact.personId,
      ...[...beneficiaries.values()].filter((v): v is string => v !== null),
    ]);
    // Under the subject's lock: a concurrent equal event id has committed.
    if (await this.journalRow(sp, fact.eventId)) throw new JournalRaceLost();
    await this.lockCountScopes(sp, fact, candidates, beneficiaries);

    const predicates = new JournalPredicateResolver(sp, fact);
    const env = {
      types: conditionTypeContext(fact.type),
      attributes: fact.attributes,
      predicates,
      settings,
    };
    const trace: PointsTraceEntry[] = [];
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
        rule.effect.kind === "credit" && typeof rule.effect.beneficiary === "object"
          ? (beneficiaries.get(candidate.ruleId) ?? null)
          : fact.personId;
      t.condition =
        (await evaluateCondition(rule.condition, env)) && beneficiaryId !== null;
      if (!t.condition || beneficiaryId === null) {
        t.verdict = "condition-false";
        continue;
      }
      if (rule.effect.kind === "reserve") {
        throw new Error(
          `points: ${candidate.ruleId} reserves — the hold projections ship with #3810`,
        );
      }
      if (rule.effect.kind === "debit" && rule.effect.amounts === "price") {
        throw new Error(
          `points: ${candidate.ruleId} debits the price-list amount — the price list ships with #3810`,
        );
      }
      const { reached, dedupeKey } = await this.checkLimits(sp, {
        candidate,
        fact,
        beneficiaryId,
        beneficiaryAccountId: accounts.get(beneficiaryId)!,
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
    const applied: PointsApplication[] = [];
    for (const e of ordered) {
      const effect = e.candidate.rule.effect;
      if (effect.kind === "settle" || effect.kind === "release") {
        e.trace.verdict = "no-open-hold";
        continue;
      }
      if (effect.kind === "debit") {
        if ((await predicates.resolve("person.phoneVerified", {})) !== true) {
          throw new PointsLedgerError("POINTS_PHONE_UNVERIFIED");
        }
      }
      const ledgerEventId = `${fact.eventId}#${e.candidate.ruleId}`;
      const legs = buildLegs(fact, e, effect);
      if (legs.length === 0) continue;
      const posted = await this.ledger.post(
        {
          eventId: ledgerEventId,
          ...(e.dedupeKey !== undefined ? { dedupeKey: e.dedupeKey } : {}),
          occurredAt: fact.occurredAt,
          legs,
        },
        sp,
      );
      if (posted.status === "duplicate") {
        // Another rule of this fact took the shared limit key first.
        e.trace.verdict = "limit-reached";
        const once = e.trace.limits.find((l) => l.kind === "oncePer");
        if (once) once.verdict = "limit-reached";
        continue;
      }
      e.trace.verdict = "applied";
      e.trace.ledgerEventId = ledgerEventId;
      applied.push({
        ruleId: e.candidate.ruleId,
        ruleVersion: e.candidate.version,
        effect: effect.kind === "debit" ? "debit" : "credit",
        ledgerEventId,
        postings: posted.postings,
      });
    }

    const outcome = outcomeOf(trace, applied);
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

    return {
      outcome,
      applied,
      trace,
      publishAfterCommit: this.publisher(fact.eventId, applied, accounts),
    };
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
      // concurrentOpen is refused at publish until #3810; only the seeded
      // `spend.reserve` names it, and a reserve throws before its limits.
      throw new Error(
        `points: ${candidate.ruleId} names concurrentOpen — the hold projections ship with #3810`,
      );
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
        effect: postings.some(
          (p) => p.eventId === t.ledgerEventId && p.leg.startsWith("debit:"),
        )
          ? "debit"
          : "credit",
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

  /** One `PointsCredited` per credited person, carrying that person's credit postings. */
  private publisher(
    eventId: string,
    applied: PointsApplication[],
    accounts: Map<string, string>,
  ): () => Promise<void> {
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
function withinWindow(rule: PointsRule, at: Date): boolean {
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

/** The legs of one applied credit or debit (amended EARS-3). */
function buildLegs(
  fact: PointsParsedRecordFact,
  e: Eligible,
  effect: PointsRule["effect"],
): PointsPostingLeg[] {
  const common = {
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
  if (effect.kind === "credit") {
    return DENOMINATIONS.filter((d) => effect.amounts[d] > 0).map((d) => ({
      leg: `accrual:${d}`,
      debit: { kind: "system", code: "issuance" },
      credit: { kind: "person", personId: e.beneficiaryId },
      denomination: d,
      amount: effect.amounts[d],
      ...common,
    }));
  }
  if (effect.kind === "debit" && effect.amounts !== "price") {
    return [
      {
        leg: "debit:pul",
        debit: { kind: "person", personId: fact.personId },
        credit: { kind: "system", code: "sink" },
        denomination: "pul",
        amount: effect.amounts.pul,
        ...common,
      },
    ];
  }
  return [];
}

/**
 * EARS-33 / amended EARS-4 — `applied` when a rule applied; `duplicate` when
 * every otherwise applicable rule stopped on an existing `oncePer` key;
 * otherwise `no-effect`.
 */
function outcomeOf(
  trace: PointsTraceEntry[],
  applied: PointsApplication[],
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
