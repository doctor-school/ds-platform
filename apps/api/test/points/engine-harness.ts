import { randomBytes, randomUUID } from "node:crypto";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import type {
  PointsCreditedEvent,
  PointsRecordFact,
  PointsRule,
} from "@ds/schemas";
import { PointsEngine } from "../../src/points/engine/points-engine.service.js";
import { PointsEventsPublisher } from "../../src/points/points-events.js";
import { PointsLedgerService } from "../../src/points/points-ledger.service.js";
import { RuleBookService } from "../../src/points/rule-book.service.js";

// Shared harness of the 025 engine e2e specs (#3838) against a real Postgres
// migrated through 0060.
//
// Isolation. Rule versions are global and immutable, so a spec never re-tunes
// a seeded rule. It publishes rules of its own under a unique slug that
// trigger on `person.starter-bonus-eligible` and carry the condition
// `runId = <a uuid of the test>`: a rule matches only the facts of the test
// that published it, and its validity window closes ten minutes later, so a
// stand keeps no live test rule. The seeded `accrual.starter-bonus`
// (+20 Pul, oncePer(subject) under `welcome`) also matches every such fact —
// the specs count it in, it is a real second matching rule. Persons and event
// ids are unique per run; postings and journal rows are append-only, so
// nothing is tidied up.

export const TEST_FACT_TYPE = "person.starter-bonus-eligible" as const;

export interface EngineHarness {
  handle: DrizzleHandle;
  engine: PointsEngine;
  rules: RuleBookService;
  ledger: PointsLedgerService;
  events: PointsEventsPublisher;
  credited: PointsCreditedEvent[];
}

export function engineHarness(): EngineHarness {
  const handle = createDrizzle(process.env.DATABASE_URL!, { max: 10 });
  const ledger = new PointsLedgerService(handle.db);
  const rules = new RuleBookService(handle.db);
  const events = new PointsEventsPublisher();
  const engine = new PointsEngine(handle.db, rules, ledger, events);
  const credited: PointsCreditedEvent[] = [];
  events.onCredited((event) => {
    credited.push(event);
  });
  return { handle, engine, rules, ledger, events, credited };
}

/** A unique admin slug for a test rule. */
export function testRuleId(prefix = "e2e.engine"): string {
  return `${prefix}.${randomBytes(6).toString("hex")}`;
}

/** A test rule body scoped to `runId` (see the isolation note above). */
export function testRule(
  runId: string,
  overrides: Partial<Omit<PointsRule, "kind">> = {},
): PointsRule {
  return {
    kind: "rule",
    label: "e2e test rule",
    trigger: [TEST_FACT_TYPE],
    condition: { eq: [{ attr: "runId" }, runId] },
    effect: {
      kind: "credit",
      beneficiary: "subject",
      amounts: { pul: 0, bre: 5, con: 0 },
    },
    limits: [{ unlimited: true }],
    validFrom: null,
    validUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
    active: true,
    stacking: { priority: 0, exclusiveGroup: null },
    ...overrides,
  };
}

/** Publishes `body` under `ruleId` (effective now) and returns its version. */
export async function publishRule(
  rules: RuleBookService,
  ruleId: string,
  body: unknown,
  effectiveFrom?: Date,
) {
  return rules.publish({
    ruleId,
    parameters: body,
    effectiveFrom,
    actorSub: null,
  });
}

/** A test fact of `runId` for `personId`, occurring now. */
export function testFact(
  runId: string,
  personId: string = randomUUID(),
  overrides: Partial<PointsRecordFact> = {},
): PointsRecordFact {
  return {
    type: TEST_FACT_TYPE,
    eventId: `e2e-fact:${randomUUID()}`,
    personId,
    occurredAt: new Date(),
    attributes: { runId },
    ...overrides,
  };
}

export async function postingsOf(handle: DrizzleHandle, eventIdPrefix: string) {
  const { rows } = await handle.pool.query<{
    event_id: string;
    leg: string;
    denomination: string;
    amount: number;
    rule_id: string;
    rule_version: number;
    action: string | null;
    project_id: string | null;
    output_type: string | null;
    output_id: string | null;
    attributed_organisation_id: string | null;
    debit_kind: string;
    debit_code: string | null;
    debit_subject: string | null;
    credit_kind: string;
    credit_code: string | null;
    credit_subject: string | null;
    dedupe_key: string | null;
  }>(
    `SELECT p.*, d.subject_kind AS debit_kind, d.system_code AS debit_code,
            d.subject_id AS debit_subject,
            c.subject_kind AS credit_kind, c.system_code AS credit_code,
            c.subject_id AS credit_subject, k.dedupe_key
       FROM points_postings p
       JOIN points_accounts d ON d.id = p.debit_account_id
       JOIN points_accounts c ON c.id = p.credit_account_id
       JOIN points_posting_keys k ON k.event_id = p.event_id
      WHERE p.event_id LIKE $1 || '#%' ORDER BY p.event_id, p.leg`,
    [eventIdPrefix],
  );
  return rows;
}

export async function journalOf(handle: DrizzleHandle, eventId: string) {
  const { rows } = await handle.pool.query<{
    event_id: string;
    type: string;
    person_id: string;
    ref_kind: string | null;
    ref_id: string | null;
    attributes: Record<string, unknown>;
    outcome: string;
    trace: Array<Record<string, unknown>>;
  }>(`SELECT * FROM points_facts WHERE event_id = $1`, [eventId]);
  return rows;
}

/** Pul available on the person's account (Σ credits − Σ debits). */
export async function pulOf(
  handle: DrizzleHandle,
  personId: string,
): Promise<number> {
  const { rows } = await handle.pool.query<{ n: string }>(
    `SELECT coalesce(sum(CASE WHEN p.credit_account_id = a.id THEN p.amount ELSE -p.amount END), 0) AS n
       FROM points_accounts a
       JOIN points_postings p ON a.id IN (p.credit_account_id, p.debit_account_id)
      WHERE a.subject_kind = 'person' AND a.subject_id = $1 AND p.denomination = 'pul'`,
    [personId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Records `phone.verified` for the person, so a debit-side effect may run (EARS-5). */
export async function verifyPhone(
  engine: PointsEngine,
  personId: string,
): Promise<void> {
  await engine.record({
    type: "phone.verified",
    eventId: `e2e-phone:${randomUUID()}`,
    personId,
    occurredAt: new Date(),
    attributes: {},
  });
}
