import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { seedStructure, seedTaxonomy } from "./fixtures.js";

// 024 × 010 EARS-7 — the doctor's free-text step feedback is PD-bearing: the
// universal audit trigger must record `learning_feedback.text` as
// `{masked:true}`, never the typed text.

describe.skipIf(!process.env.DATABASE_URL)("024 learning — audit masking (e2e)", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("EARS-23: a feedback row's free text is masked in the audit ledger — no plaintext", async () => {
    const f = await seedTaxonomy(pool);
    const s = await seedStructure(pool, f);
    const secret = `Иванов, +7 900 000-00-00 ${f.suffix}`;
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO learning_feedback (person_id, step_id, text) VALUES ($1, $2, $3) RETURNING id",
      [f.userId, s.stepId, secret],
    );
    const id = rows[0]!.id;
    const trail = await pool.query<{ metadata: { diff: Record<string, unknown> } }>(
      `SELECT metadata FROM audit_ledger
       WHERE event_type = 'data.learning_feedback.insert' AND metadata -> 'pk' ->> 'id' = $1`,
      [id],
    );
    expect(trail.rows).toHaveLength(1);
    const meta = trail.rows[0]!.metadata;
    expect(meta.diff["text"]).toEqual({ masked: true });
    expect(JSON.stringify(meta)).not.toContain(secret);
  });
});
