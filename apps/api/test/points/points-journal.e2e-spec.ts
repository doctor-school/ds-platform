import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type EngineHarness,
  engineHarness,
  journalOf,
  publishRule,
  testFact,
  testRule,
  testRuleId,
} from "./engine-harness.js";

// 025 EARS-40 (#3838) — the fact journal `points_facts`: one row per accepted
// fact with its outcome and full evaluation trace, written in the transaction
// of its postings; immutable by trigger; refs and catalog attributes only,
// never attribution.
describe.skipIf(!process.env.DATABASE_URL)("025 points fact journal (e2e)", () => {
  let h: EngineHarness;

  beforeAll(() => {
    h = engineHarness();
  });

  afterAll(async () => {
    await h.handle.pool.end();
  });

  it("025 EARS-40: the journal row carries type, person, ref, attributes, outcome and the full trace of every rule considered", async () => {
    const runId = randomUUID();
    const ruleId = testRuleId();
    const published = await publishRule(
      h.rules,
      ruleId,
      testRule(runId, { limits: [{ oncePer: ["subject"] }] }),
    );
    const personId = randomUUID();
    const f = testFact(runId, personId);
    await h.engine.record(f);
    const [row] = await journalOf(h.handle, f.eventId);
    expect(row).toMatchObject({
      type: "person.starter-bonus-eligible",
      person_id: personId,
      ref_kind: null,
      ref_id: null,
      attributes: { runId },
      outcome: "applied",
    });
    expect(row!.trace).toContainEqual({
      ruleId,
      version: published.row.version,
      trigger: true,
      active: true,
      valid: true,
      condition: true,
      limits: [{ kind: "oncePer", verdict: "pass", key: `${ruleId}:${personId}` }],
      stacking: null,
      verdict: "applied",
      ledgerEventId: `${f.eventId}#${ruleId}`,
    });
    expect(row!.trace).toContainEqual(
      expect.objectContaining({
        ruleId: "accrual.starter-bonus",
        verdict: "applied",
      }),
    );
  });

  it("025 EARS-40: a lesson fact journals its ref with the catalog ref kind and a condition-false rule's trace", async () => {
    const f = {
      type: "lesson.completed" as const,
      eventId: `e2e-lesson:${randomUUID()}`,
      personId: randomUUID(),
      ref: randomUUID(),
      occurredAt: new Date(),
      attributes: { mode: "offline" },
    };
    await h.engine.record(f);
    const [row] = await journalOf(h.handle, f.eventId);
    expect(row).toMatchObject({ ref_kind: "lesson", ref_id: f.ref });
    expect(row!.trace).toContainEqual(
      expect.objectContaining({
        ruleId: "accrual.lesson",
        condition: false,
        limits: [],
        verdict: "condition-false",
      }),
    );
  });

  it("025 EARS-40: the journal stores no attribution — the attribution reaches the postings only", async () => {
    // Attribution columns reference real rows (organisations, users); the
    // fact's own person is opened as a user-less account, so the member is
    // any existing user — or, on an empty database, the attribution is the
    // organisation alone.
    const { rows: refs } = await h.handle.pool.query<{
      org: string | null;
      member: string | null;
    }>(
      `SELECT (SELECT id FROM organisations LIMIT 1) AS org,
              (SELECT id FROM users LIMIT 1) AS member`,
    );
    const organisationId = refs[0]?.org ?? undefined;
    const memberId = refs[0]?.member ?? undefined;
    const f = testFact(randomUUID(), randomUUID(), {
      attribution: {
        ...(organisationId ? { organisationId } : {}),
        ...(memberId ? { memberId } : {}),
      },
    });
    await h.engine.record(f);
    const { rows } = await h.handle.pool.query<{ j: string }>(
      `SELECT row_to_json(f)::text AS j FROM points_facts f WHERE event_id = $1`,
      [f.eventId],
    );
    expect(rows[0]!.j).not.toContain("attribution");
    expect(rows[0]!.j).not.toContain("organisation");
    for (const id of [organisationId, memberId]) {
      if (id) expect(rows[0]!.j).not.toContain(id);
    }
    const { rows: postings } = await h.handle.pool.query<{
      org: string | null;
      member: string | null;
    }>(
      `SELECT attributed_organisation_id AS org, attributed_member_id AS member
         FROM points_postings WHERE event_id LIKE $1 || '#%'`,
      [f.eventId],
    );
    expect(postings).toEqual([
      { org: organisationId ?? null, member: memberId ?? null },
    ]);
  });

  it("025 EARS-40: a journal row is immutable — UPDATE and DELETE are refused by the database", async () => {
    const f = testFact(randomUUID());
    await h.engine.record(f);
    await expect(
      h.handle.pool.query(
        `UPDATE points_facts SET outcome = 'no-effect' WHERE event_id = $1`,
        [f.eventId],
      ),
    ).rejects.toThrow();
    await expect(
      h.handle.pool.query(`DELETE FROM points_facts WHERE event_id = $1`, [f.eventId]),
    ).rejects.toThrow();
    expect(await journalOf(h.handle, f.eventId)).toHaveLength(1);
  });
});
