import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PointsRecordFact } from "@ds/schemas";
import { type EngineHarness, engineHarness, postingsOf } from "./engine-harness.js";

// 025 amended EARS-4 (#3838) — dedupe on the fact (journal `event_id`) and
// on the applied rule's limit scope (`points_posting_keys.dedupe_key`), with
// the seeded lesson rules of 0060: `accrual.lesson` (online, +10 Pul, key
// `lesson.pul`) and `accrual.lesson.any-mode` (+1 Bre, key `lesson`), both
// `oncePer(subject, ref)` — 025-design G, the mode-order table.
describe.skipIf(!process.env.DATABASE_URL)("025 points dedupe (e2e)", () => {
  let h: EngineHarness;

  beforeAll(() => {
    h = engineHarness();
  });

  afterAll(async () => {
    await h.handle.pool.end();
  });

  function lesson(
    personId: string,
    lessonId: string,
    mode: "online" | "offline" | "open",
  ): PointsRecordFact {
    return {
      type: "lesson.completed",
      eventId: `e2e-lesson:${randomUUID()}`,
      personId,
      ref: lessonId,
      occurredAt: new Date(),
      attributes: { mode },
    };
  }

  async function totals(personId: string) {
    const { rows } = await h.handle.pool.query<{ denomination: string; n: string }>(
      `SELECT p.denomination, sum(p.amount) AS n FROM points_postings p
         JOIN points_accounts a ON a.id = p.credit_account_id
        WHERE a.subject_kind = 'person' AND a.subject_id = $1
        GROUP BY p.denomination ORDER BY p.denomination`,
      [personId],
    );
    return Object.fromEntries(rows.map((r) => [r.denomination, Number(r.n)]));
  }

  it("025 EARS-4: a replayed event id evaluates nothing, writes nothing and answers duplicate with the original applications", async () => {
    const f = lesson(randomUUID(), randomUUID(), "online");
    const first = await h.engine.record(f);
    expect(first.outcome).toBe("applied");
    const replay = await h.engine.record({ ...f, attributes: { mode: "offline" } });
    expect(replay.outcome).toBe("duplicate");
    expect(replay.applied.map((a) => a.ledgerEventId).sort()).toEqual(
      first.applied.map((a) => a.ledgerEventId).sort(),
    );
    expect(await postingsOf(h.handle, f.eventId)).toHaveLength(2);
  });

  it("025 EARS-4: one lesson reported under three event ids (doctor storefront, Academy, offline sync) credits once", async () => {
    const personId = randomUUID();
    const lessonId = randomUUID();
    const outcomes = [];
    for (let i = 0; i < 3; i += 1) {
      outcomes.push((await h.engine.record(lesson(personId, lessonId, "online"))).outcome);
    }
    expect(outcomes).toEqual(["applied", "duplicate", "duplicate"]);
    expect(await totals(personId)).toEqual({ bre: 1, pul: 10 });
    const { rows } = await h.handle.pool.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM points_posting_keys WHERE dedupe_key = ANY($1) ORDER BY 1`,
      [[`lesson.pul:${personId}:${lessonId}`, `lesson:${personId}:${lessonId}`]],
    );
    expect(rows).toHaveLength(2);
  });

  it("025 EARS-4: a limit-reached rule is skipped while a second rule of the fact still applies (offline, then online)", async () => {
    const personId = randomUUID();
    const lessonId = randomUUID();
    const offline = await h.engine.record(lesson(personId, lessonId, "offline"));
    expect(offline.applied.map((a) => a.ruleId)).toEqual(["accrual.lesson.any-mode"]);
    const online = await h.engine.record(lesson(personId, lessonId, "online"));
    expect(online.outcome).toBe("applied");
    expect(online.applied.map((a) => a.ruleId)).toEqual(["accrual.lesson"]);
    expect(
      online.trace.find((t) => t.ruleId === "accrual.lesson.any-mode")?.verdict,
    ).toBe("limit-reached");
    expect(await totals(personId)).toEqual({ bre: 1, pul: 10 });
  });

  it("025 EARS-4: online, then offline — the second answers duplicate (condition-false + limit-reached)", async () => {
    const personId = randomUUID();
    const lessonId = randomUUID();
    await h.engine.record(lesson(personId, lessonId, "online"));
    const offline = await h.engine.record(lesson(personId, lessonId, "offline"));
    expect(offline.outcome).toBe("duplicate");
    expect(
      Object.fromEntries(offline.trace.map((t) => [t.ruleId, t.verdict])),
    ).toMatchObject({
      "accrual.lesson": "condition-false",
      "accrual.lesson.any-mode": "limit-reached",
    });
  });

  it("025 EARS-4: concurrent reports of one lesson under different event ids credit once (database constraint, not read-before-write)", async () => {
    const personId = randomUUID();
    const lessonId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => h.engine.record(lesson(personId, lessonId, "online"))),
    );
    expect(results.filter((r) => r.outcome === "applied")).toHaveLength(1);
    expect(await totals(personId)).toEqual({ bre: 1, pul: 10 });
  });

  it("025 EARS-4: concurrent replays of one event id journal it once", async () => {
    const f = lesson(randomUUID(), randomUUID(), "online");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => h.engine.record(f)),
    );
    expect(results.filter((r) => r.outcome === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "duplicate")).toHaveLength(3);
  });
});
