// #4172 — the golden doctors' attention-points ledger (025), accrual side.
//
// The Pul plate of the doctor school, course and step screens reads
// `GET /v1/me/points` — a fold over the person account's postings (025
// EARS-2). The rows here are the ones the engine writes for the facts the
// platform itself produces, under the rule book migration 0060 inserts:
//
// - `person.starter-bonus-eligible` — the admin starter-bonus run
//   (`starter-bonus:<personId>`, `accrual.starter-bonus`, 20 Pul);
// - `lesson.completed` / `module.completed` — the learning projector's
//   completions (`learning:<type>:<personId>:<itemId>`), derived from the
//   golden `learning_facts` under the volume courses' own layer (every step
//   done → the lesson; every lesson done → the module), mode `online`.
//
// Each applied rule is one ledger fact `<fact event id>#<rule id>`: a
// `points_posting_keys` row carrying its `oncePer` dedupe key and one
// `accrual:<denomination>` posting per non-zero amount, issuance → person.
// The fact itself is one `points_facts` journal row with the trace of every
// rule its type triggers. Account ids, the rule versions and the facts the
// ledger already holds are read from the database (`seed.ts`), never minted
// here: migration 0059 opens the issuance account with a generated id, and a
// fact whose ledger event or dedupe key is already recorded is skipped as the
// engine's own dedupe answers `duplicate` — a re-seed at another pin adds
// nothing.
//
// Spread over the doctors: the verified cardiologist and its worker-pool
// copies hold the starter bonus and their completions (large); every other
// verified volume doctor holds the starter bonus (small); the rest hold no
// account at all (zero — an account opens on the first accrual, EARS-1).
//
// Holds (`points_reserves`, `points_obligations`) and the price list are #4188.

import type {
  pointsAccounts,
  pointsFacts,
  pointsPostingKeys,
  pointsPostings,
} from "../../schema/points-ledger.js";
import type {
  learningFacts,
  learningLessons,
  learningModules,
  learningSteps,
} from "../../schema/learning.js";
import { golden, goldenUuid, GOLDEN_GROUP } from "./ids.js";
import { GOLDEN_LEARNERS, goldenLearnerId } from "./learning-results.js";
import { GOLDEN_VOLUME_ORDINAL_BASE } from "./volume.js";

/** Rules the ledger applies, with the effect migration 0060 gives each. */
const RULES = {
  "accrual.starter-bonus": { key: "welcome", amounts: { pul: 20 } },
  "accrual.lesson": { key: "lesson.pul", amounts: { pul: 10 } },
  "accrual.lesson.any-mode": { key: "lesson", amounts: { bre: 1 } },
  "accrual.module": { key: "module.pul", amounts: { pul: 20 } },
  "accrual.module.any-mode": { key: "module", amounts: { bre: 3, con: 1 } },
} as const;
type AppliedRuleId = keyof typeof RULES;

/** The rules each fact type triggers, in the rule book's order (`rule_id` asc). */
const TRIGGERED: Record<GoldenPointsFactType, readonly string[]> = {
  "person.starter-bonus-eligible": ["accrual.starter-bonus"],
  // The referral rules trigger too; with no referrer their condition is false.
  "lesson.completed": [
    "accrual.lesson",
    "accrual.lesson.any-mode",
    "accrual.referral-invitee",
    "accrual.referral-inviter",
  ],
  "module.completed": ["accrual.module", "accrual.module.any-mode"],
};

/** Every rule id the ledger cites — the versions `seed.ts` resolves. */
export const GOLDEN_POINTS_RULE_IDS: readonly string[] = [
  ...new Set(Object.values(TRIGGERED).flat()),
].sort();

type GoldenPointsFactType =
  | "person.starter-bonus-eligible"
  | "lesson.completed"
  | "module.completed";

/** One producer fact and the ledger facts its applied rules write. */
export interface GoldenPointsFact {
  eventId: string;
  type: GoldenPointsFactType;
  personId: string;
  refKind: "lesson" | "module" | null;
  refId: string | null;
  attributes: Record<string, unknown>;
  occurredAt: Date;
  applied: {
    ruleId: AppliedRuleId;
    /** `<limit key>:<scope values>` (`oncePer`). */
    dedupeKey: string;
    legs: { denomination: "pul" | "bre" | "con"; amount: number }[];
  }[];
}

export interface GoldenPointsLedger {
  /** Person accounts opened for the doctors with an accrual (no system account). */
  accounts: (typeof pointsAccounts.$inferInsert)[];
  facts: GoldenPointsFact[];
}

/**
 * What the database answers for the ledger, read by `seed.ts` in the seed
 * transaction: `p:<personId>` / `s:<code>` → open account id, `rule_id` → its
 * latest version, and the ledger event ids and dedupe keys already recorded.
 */
export interface GoldenPointsContext {
  accountIdByRef: ReadonlyMap<string, string>;
  ruleVersionById: ReadonlyMap<string, number>;
  recordedEventIds: ReadonlySet<string>;
  recordedDedupeKeys: ReadonlySet<string>;
}

/** The ledger event id of one applied rule (`points-engine.service.ts`). */
export function goldenLedgerEventId(fact: GoldenPointsFact, ruleId: string) {
  return `${fact.eventId}#${ruleId}`;
}

interface LearningRows {
  learningModules: readonly (typeof learningModules.$inferInsert)[];
  learningLessons: readonly (typeof learningLessons.$inferInsert)[];
  learningSteps: readonly (typeof learningSteps.$inferInsert)[];
  learningFacts: readonly (typeof learningFacts.$inferInsert)[];
  /**
   * #4012 — the rule layers, for a course's own `test.threshold` (the platform
   * seed's 80 otherwise): a test step is done on a submitted attempt at it.
   */
  learningRuleLayers?: readonly {
    scopeKind: string;
    scopeId: string;
    values?: Record<string, unknown> | null;
  }[];
}

/** The platform seed's pass mark (`LEARNING_PLATFORM_SEED["test.threshold"]`). */
const PLATFORM_TEST_THRESHOLD = 80;

/**
 * The lessons and modules each person has completed on the golden facts, with
 * the instant the last fact arrived: a lesson whose every step carries the
 * person's fact — for a test step a submitted attempt at the course's pass
 * mark (#4012) — (the volume courses' own layer completes a lesson on
 * `all-steps-done`), a module whose every lesson is complete.
 */
export function goldenLearningCompletions(
  rows: LearningRows,
  personIds: readonly string[],
): { personId: string; kind: "lesson" | "module"; id: string; at: Date }[] {
  const out: {
    personId: string;
    kind: "lesson" | "module";
    id: string;
    at: Date;
  }[] = [];
  const thresholdOf = new Map<string, number>();
  for (const layer of rows.learningRuleLayers ?? []) {
    const value = layer.values?.["test.threshold"];
    if (layer.scopeKind === "course" && typeof value === "number")
      thresholdOf.set(layer.scopeId, value);
  }
  const groupBy = <T, K>(items: readonly T[], key: (item: T) => K) => {
    const map = new Map<K, T[]>();
    for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
    return map;
  };
  const lessonsOf = groupBy(rows.learningLessons, (l) => l.moduleId);
  for (const lessons of lessonsOf.values())
    lessons.sort((a, b) => a.position - b.position);
  const stepsOf = groupBy(rows.learningSteps, (s) => s.lessonId);
  const factsOf = groupBy(rows.learningFacts, (f) => f.personId);
  for (const personId of personIds) {
    const facts = factsOf.get(personId) ?? [];
    if (facts.length === 0) continue;
    const factAt = new Map<string, number>();
    const attempts = new Map<string, { score: number; at: number }[]>();
    for (const f of facts) {
      const t = f.occurredAt!.getTime();
      if (f.kind === "attempt-submitted") {
        const score = Number((f.data as Record<string, unknown>)["score"]);
        attempts.set(f.stepId!, [
          ...(attempts.get(f.stepId!) ?? []),
          { score, at: t },
        ]);
        continue;
      }
      factAt.set(f.stepId!, Math.max(factAt.get(f.stepId!) ?? 0, t));
    }
    for (const module of rows.learningModules) {
      const threshold =
        thresholdOf.get(module.courseId) ?? PLATFORM_TEST_THRESHOLD;
      const lessons = lessonsOf.get(module.id!) ?? [];
      // A test step is done at its first submitted attempt at the pass mark.
      const doneAt = (s: (typeof rows.learningSteps)[number]) =>
        s.type === "test"
          ? (attempts.get(s.id!) ?? [])
              .filter((a) => a.score >= threshold)
              .reduce<number | undefined>(
                (min, a) => (min === undefined || a.at < min ? a.at : min),
                undefined,
              )
          : factAt.get(s.id!);
      let moduleAt = 0;
      let moduleDone = lessons.length > 0;
      for (const lesson of lessons) {
        const steps = stepsOf.get(lesson.id!) ?? [];
        const at = steps.map(doneAt);
        const done = steps.length > 0 && at.every((x) => x !== undefined);
        if (!done) {
          moduleDone = false;
          continue;
        }
        const last = Math.max(...(at as number[]));
        moduleAt = Math.max(moduleAt, last);
        out.push({ personId, kind: "lesson", id: lesson.id!, at: new Date(last) });
      }
      if (moduleDone) {
        out.push({
          personId,
          kind: "module",
          id: module.id!,
          at: new Date(moduleAt),
        });
      }
    }
  }
  return out;
}

/**
 * Builds the ledger. `starterAt` is the starter-bonus run's instant (after
 * every golden doctor exists), `opened` the accounts' opening instant.
 */
export function buildGoldenPointsLedger(input: {
  learning: LearningRows;
  starterAt: Date;
}): GoldenPointsLedger {
  const pool = golden.workerPool.verifiedCardiologist.map((d) => d.id);
  const volumeVerified = Array.from({ length: 8 }, (_, d) =>
    goldenUuid(GOLDEN_GROUP.users, GOLDEN_VOLUME_ORDINAL_BASE + d),
  ).filter((_, d) => d % 2 === 0);
  const runId = goldenUuid(GOLDEN_GROUP.pointsRuns, GOLDEN_VOLUME_ORDINAL_BASE);

  const facts: GoldenPointsFact[] = [];
  for (const personId of [...pool, ...volumeVerified]) {
    facts.push({
      eventId: `starter-bonus:${personId}`,
      type: "person.starter-bonus-eligible",
      personId,
      refKind: null,
      refId: null,
      attributes: { runId },
      occurredAt: input.starterAt,
      applied: [applied("accrual.starter-bonus", personId)],
    });
  }
  // #4012 — the learners of the long paths' results accrue their completions
  // too (an account opens on the first accrual, EARS-1).
  const learners = Array.from({ length: GOLDEN_LEARNERS }, (_, i) =>
    goldenLearnerId(i),
  );
  for (const c of goldenLearningCompletions(input.learning, [
    ...pool,
    ...learners,
  ])) {
    const type = c.kind === "lesson" ? "lesson.completed" : "module.completed";
    const rules: AppliedRuleId[] =
      c.kind === "lesson"
        ? ["accrual.lesson", "accrual.lesson.any-mode"]
        : ["accrual.module", "accrual.module.any-mode"];
    facts.push({
      eventId: `learning:${type}:${c.personId}:${c.id}`,
      type,
      personId: c.personId,
      refKind: c.kind,
      refId: c.id,
      attributes: { mode: "online" },
      occurredAt: c.at,
      applied: rules.map((r) => applied(r, c.personId, c.id)),
    });
  }

  const holders = [...new Set(facts.map((f) => f.personId))];
  const accounts = holders.map((personId, i) => ({
    id: goldenUuid(GOLDEN_GROUP.pointsAccounts, GOLDEN_VOLUME_ORDINAL_BASE + i),
    subjectKind: "person",
    subjectId: personId,
    unit: "attention_points",
    openedAt: new Date(
      Math.min(
        ...facts.filter((f) => f.personId === personId).map((f) => +f.occurredAt),
      ),
    ),
  }));
  return { accounts, facts };
}

function applied(
  ruleId: AppliedRuleId,
  personId: string,
  ref?: string,
): GoldenPointsFact["applied"][number] {
  const rule = RULES[ruleId];
  return {
    ruleId,
    dedupeKey: [rule.key, personId, ...(ref ? [ref] : [])].join(":"),
    legs: (["pul", "bre", "con"] as const)
      .map((denomination) => ({
        denomination,
        amount: (rule.amounts as Partial<Record<string, number>>)[denomination] ?? 0,
      }))
      .filter((l) => l.amount > 0),
  };
}

/**
 * The journal, posting-key and posting rows of the facts the ledger does not
 * hold yet, resolved against the database's accounts and rule versions. A
 * fact whose person has no open account, or any of whose ledger events or
 * dedupe keys is already recorded, is skipped whole.
 */
export function resolveGoldenPointsRows(
  ledger: GoldenPointsLedger,
  ctx: GoldenPointsContext,
): {
  pointsPostingKeys: (typeof pointsPostingKeys.$inferInsert)[];
  pointsFacts: (typeof pointsFacts.$inferInsert)[];
  pointsPostings: (typeof pointsPostings.$inferInsert)[];
} {
  const issuance = ctx.accountIdByRef.get("s:issuance");
  if (!issuance) {
    throw new Error(
      "points_accounts carries no issuance account — migration 0059 opens it before the golden seed",
    );
  }
  const version = (ruleId: string): number => {
    const v = ctx.ruleVersionById.get(ruleId);
    if (v === undefined) {
      throw new Error(
        `points_rule_versions carries no ${ruleId} — migration 0060 inserts the rule book before the golden seed`,
      );
    }
    return v;
  };
  const out = {
    pointsPostingKeys: [] as (typeof pointsPostingKeys.$inferInsert)[],
    pointsFacts: [] as (typeof pointsFacts.$inferInsert)[],
    pointsPostings: [] as (typeof pointsPostings.$inferInsert)[],
  };
  ledger.facts.forEach((fact, f) => {
    const account = ctx.accountIdByRef.get(`p:${fact.personId}`);
    if (!account) return;
    const recorded = fact.applied.some(
      (a) =>
        ctx.recordedEventIds.has(goldenLedgerEventId(fact, a.ruleId)) ||
        ctx.recordedDedupeKeys.has(a.dedupeKey),
    );
    if (recorded) return;
    const month = `${fact.occurredAt.toISOString().slice(0, 7)}-01`;
    const appliedBy = new Map(fact.applied.map((a) => [a.ruleId, a]));
    out.pointsFacts.push({
      eventId: fact.eventId,
      type: fact.type,
      personId: fact.personId,
      refKind: fact.refKind,
      refId: fact.refId,
      attributes: fact.attributes,
      occurredAt: fact.occurredAt,
      receivedAt: fact.occurredAt,
      outcome: "applied",
      trace: TRIGGERED[fact.type].map((ruleId) => {
        const a = appliedBy.get(ruleId as AppliedRuleId);
        return a
          ? {
              ruleId,
              version: version(ruleId),
              trigger: true,
              active: true,
              valid: true,
              condition: true,
              limits: [{ kind: "oncePer", verdict: "pass", key: a.dedupeKey }],
              stacking: null,
              verdict: "applied",
              ledgerEventId: goldenLedgerEventId(fact, ruleId),
            }
          : {
              ruleId,
              version: version(ruleId),
              trigger: true,
              active: true,
              valid: true,
              condition: false,
              limits: [],
              stacking: null,
              verdict: "condition-false",
            };
      }),
    });
    fact.applied.forEach((a, r) => {
      const eventId = goldenLedgerEventId(fact, a.ruleId);
      out.pointsPostingKeys.push({
        eventId,
        dedupeKey: a.dedupeKey,
        occurredMonth: month,
        recordedAt: fact.occurredAt,
      });
      a.legs.forEach((leg, l) => {
        out.pointsPostings.push({
          id: goldenUuid(
            GOLDEN_GROUP.pointsPostings,
            GOLDEN_VOLUME_ORDINAL_BASE + f * 100 + r * 10 + l,
          ),
          eventId,
          leg: `accrual:${leg.denomination}`,
          debitAccountId: issuance,
          creditAccountId: account,
          denomination: leg.denomination,
          amount: leg.amount,
          action: fact.type,
          ruleId: a.ruleId,
          ruleVersion: version(a.ruleId),
          occurredAt: fact.occurredAt,
          recordedAt: fact.occurredAt,
        });
      });
    });
  });
  return out;
}
