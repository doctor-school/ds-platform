import { randomUUID } from "node:crypto";
import { PointsStarterBonusRunSchema } from "@ds/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RuleBookService } from "../../src/points/rule-book.service.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";
import { publishRule } from "./engine-harness.js";
import {
  bootSpend,
  DEVICE,
  doctor,
  pulOf,
  sessionHeaders,
  type SpendHarness,
} from "./spend-harness.js";

// 025 EARS-43 (#3840) — `POST /v1/admin/points/starter-bonus` over the real
// stack (Fastify + the 011 admin session + Postgres). The doctors "registered
// before the engine" are fresh accounts whose `users.created_at` is moved to
// BEFORE_ENGINE (a fixture precondition), and the run's `registeredBefore` is
// CUT_OVER — so a run walks only such backdated doctors, never every account
// the stand holds, and a doctor registered now is after the instant. A doctor
// backdated by an earlier run of this file was granted then and answers
// `duplicate`, so counts are asserted per doctor and as lower bounds, and
// exactly where a run can add nothing (`applied: 0` on a re-run). Skips
// without DATABASE_URL / IDP_ISSUER.
const BEFORE_ENGINE = "2026-01-15T00:00:00Z";
const CUT_OVER = "2026-02-01T00:00:00Z";
const STARTER = "person.starter-bonus-eligible";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 EARS-43 — starter-bonus grant (e2e)",
  () => {
    let h: SpendHarness;
    let sid: string;
    let sub: string;
    const password = "Aa1!ufficiently-long-pw";
    const consent = [{ purpose: "tos", version: "2026-01" }];

    async function staffSession(role: string) {
      const { email, sub } = await registerUniqueFakeUserFixture({
        app: h.app,
        pool: h.pool,
        fake: h.fake,
        nextEmail: () => `points-starter-${role}-${randomUUID()}@ds.test`,
        password,
        consent,
      });
      await h.fake.grantProjectRole(sub, role);
      const { sid } = await establishAdminSession(h.app, {
        identifier: email,
        password,
        device: DEVICE,
      });
      return { sid, sub };
    }

    function run(payload: unknown, headers: Record<string, string> = {}) {
      return h.app.inject({
        method: "POST",
        url: "/v1/admin/points/starter-bonus",
        headers: { ...DEVICE, "content-type": "application/json", ...headers },
        payload: payload as Record<string, unknown>,
      });
    }

    const asAdmin = (payload: unknown) => run(payload, adminHeaders(sid));

    /** A doctor account created "before the engine". */
    async function legacyDoctor(): Promise<string> {
      const { personId } = await doctor(h);
      await h.pool.query(`UPDATE users SET created_at = $2 WHERE id = $1`, [
        personId,
        BEFORE_ENGINE,
      ]);
      return personId;
    }

    /** Both registration facts, so `accrual.registration` may apply (EARS-5). */
    async function registrationFacts(personId: string) {
      for (const type of ["account.registered", "phone.verified"] as const) {
        await h.engine.record({
          type,
          eventId: `e2e-${type}:${randomUUID()}`,
          personId,
          occurredAt: new Date(),
          attributes: {},
        });
      }
    }

    async function factOf(personId: string) {
      const { rows } = await h.pool.query<{
        type: string;
        outcome: string;
        attributes: Record<string, unknown>;
      }>(
        `SELECT type, outcome, attributes FROM points_facts WHERE event_id = $1`,
        [`starter-bonus:${personId}`],
      );
      return rows;
    }

    async function pulPostingsOf(personId: string) {
      const { rows } = await h.pool.query<{ rule_id: string; amount: number }>(
        `SELECT p.rule_id, p.amount FROM points_postings p
           JOIN points_accounts c ON c.id = p.credit_account_id
          WHERE c.subject_kind = 'person' AND c.subject_id = $1
            AND p.denomination = 'pul' ORDER BY p.rule_id`,
        [personId],
      );
      return rows;
    }

    async function auditOf(runId: string) {
      const { rows } = await h.pool.query<{
        event_type: string;
        subject_id: string | null;
        metadata: Record<string, unknown>;
      }>(
        `SELECT event_type, subject_id, metadata FROM audit_ledger
          WHERE event_type LIKE 'points.starter-bonus.%'
            AND metadata ->> 'runId' = $1
          ORDER BY created_at, event_type DESC`,
        [runId],
      );
      return rows;
    }

    async function auditByReason(reason: string) {
      const { rows } = await h.pool.query(
        `SELECT 1 FROM audit_ledger
          WHERE event_type LIKE 'points.starter-bonus.%'
            AND metadata ->> 'reason' = $1`,
        [reason],
      );
      return rows;
    }

    beforeAll(async () => {
      h = await bootSpend();
      ({ sid, sub } = await staffSession("platform_admin"));
    });

    afterAll(async () => {
      await h?.app.close();
    });

    it("EARS-43: a run credits each pre-cut-over doctor +20 Pul once under accrual.starter-bonus, never on top of the registration grant, skips a closed account and a later doctor, and audits its admin, reason, instant and counts", async () => {
      const f = await legacyDoctor();
      const g = await legacyDoctor();
      await registrationFacts(g);
      expect(await pulOf(h, g)).toBe(20);
      const closed = await legacyDoctor();
      await h.ledger.close(closed, new Date());
      const later = (await doctor(h)).personId;
      const reason = `cut-over ${randomUUID()}`;

      const res = await asAdmin({ registeredBefore: CUT_OVER, reason });
      expect(res.statusCode, res.payload).toBe(200);
      const first = PointsStarterBonusRunSchema.parse(res.json());
      expect(first.applied).toBeGreaterThanOrEqual(1);
      expect(first.duplicate).toBeGreaterThanOrEqual(1);
      expect(first.skipped).toBeGreaterThanOrEqual(1);

      expect(await pulPostingsOf(f)).toEqual([
        { rule_id: "accrual.starter-bonus", amount: 20 },
      ]);
      expect(await pulOf(h, g)).toBe(20);
      expect(
        (await pulPostingsOf(g)).map((p) => p.rule_id),
      ).toEqual(["accrual.registration"]);
      expect(await factOf(f)).toEqual([
        { type: STARTER, outcome: "applied", attributes: { runId: first.runId } },
      ]);
      expect(await factOf(g)).toEqual([
        {
          type: STARTER,
          outcome: "duplicate",
          attributes: { runId: first.runId },
        },
      ]);
      expect(await factOf(closed)).toEqual([]);
      expect(await factOf(later)).toEqual([]);
      expect(await pulOf(h, later)).toBe(0);

      // The other order: a granted doctor's registration facts add nothing.
      await registrationFacts(f);
      expect(await pulOf(h, f)).toBe(20);

      // Every fact a run records carries its run id.
      const { rows: unattributed } = await h.pool.query(
        `SELECT 1 FROM points_facts
          WHERE type = $1 AND event_id LIKE 'starter-bonus:%'
            AND NOT (attributes ? 'runId')`,
        [STARTER],
      );
      expect(unattributed).toEqual([]);

      expect(await auditOf(first.runId)).toEqual([
        {
          event_type: "points.starter-bonus.started",
          subject_id: sub,
          metadata: {
            runId: first.runId,
            reason,
            registeredBefore: CUT_OVER.replace("Z", ".000Z"),
          },
        },
        {
          event_type: "points.starter-bonus.completed",
          subject_id: sub,
          metadata: {
            runId: first.runId,
            applied: first.applied,
            duplicate: first.duplicate,
            noEffect: first.noEffect,
            skipped: first.skipped,
          },
        },
      ]);

      // A re-run (or a resumed one) answers `duplicate` for every doctor.
      const again = await asAdmin({ registeredBefore: CUT_OVER, reason });
      expect(again.statusCode, again.payload).toBe(200);
      const second = PointsStarterBonusRunSchema.parse(again.json());
      expect(second.runId).not.toBe(first.runId);
      expect(second).toMatchObject({ applied: 0, noEffect: 0 });
      expect(second.duplicate).toBe(
        first.applied + first.duplicate + first.noEffect,
      );
      expect(second.skipped).toBe(first.skipped);
      expect(await pulPostingsOf(f)).toEqual([
        { rule_id: "accrual.starter-bonus", amount: 20 },
      ]);
      expect(await factOf(f)).toEqual([
        { type: STARTER, outcome: "applied", attributes: { runId: first.runId } },
      ]);
      expect((await auditOf(second.runId)).map((r) => r.event_type)).toEqual([
        "points.starter-bonus.started",
        "points.starter-bonus.completed",
      ]);
    }, 120_000);

    it("EARS-43: a registeredBefore later than now (points-rule-parameters-invalid) and a missing or empty reason are refused; nothing is audited", async () => {
      const reason = `future ${randomUUID()}`;
      const future = await asAdmin({
        registeredBefore: new Date(Date.now() + 3_600_000).toISOString(),
        reason,
      });
      expect(future.statusCode, future.payload).toBe(422);
      expect(future.json()).toMatchObject({
        errorCode: "POINTS_RULE_PARAMETERS_INVALID",
        errors: [expect.objectContaining({ path: "registeredBefore" })],
      });
      expect(await auditByReason(reason)).toEqual([]);
      for (const body of [
        { registeredBefore: CUT_OVER },
        { registeredBefore: CUT_OVER, reason: "   " },
      ]) {
        const res = await asAdmin(body);
        expect(res.statusCode, res.payload).toBe(400);
      }
    });

    it("EARS-43: with no active rule triggering on person.starter-bonus-eligible the run is refused points-starter-bonus-no-rule (422); no fact is recorded and nothing is audited", async () => {
      const rules = h.app.get(RuleBookService);
      const now = new Date();
      // Deactivate every rule active on the trigger now: the seeded
      // `accrual.starter-bonus` and any test rule another engine spec left
      // inside its ten-minute window (engine-harness.ts).
      const active = (await rules.candidatesFor(STARTER, now)).filter(
        (c) =>
          c.rule.active &&
          (c.rule.validUntil === null || Date.parse(c.rule.validUntil) > +now),
      );
      const seeded = active.find((c) => c.ruleId === "accrual.starter-bonus");
      expect(seeded).toBeDefined();
      const d = await legacyDoctor();
      const reason = `no rule ${randomUUID()}`;
      try {
        for (const c of active) {
          await publishRule(rules, c.ruleId, { ...c.rule, active: false });
        }
        const res = await asAdmin({ registeredBefore: CUT_OVER, reason });
        expect(res.statusCode, res.payload).toBe(422);
        expect(res.json()).toMatchObject({
          errorCode: "POINTS_STARTER_BONUS_NO_RULE",
        });
        expect(res.json().type).toMatch(/\/points-starter-bonus-no-rule$/);
      } finally {
        // Only the seeded rule is restored; a test rule's window closes anyway.
        await publishRule(rules, seeded!.ruleId, seeded!.rule);
      }
      expect(await factOf(d)).toEqual([]);
      expect(await pulOf(h, d)).toBe(0);
      expect(await auditByReason(reason)).toEqual([]);
    }, 60_000);

    it("EARS-43: an admin-session principal without platform_admin is refused 403; a doctor's portal session and no session are refused 401; nothing runs", async () => {
      const reason = `refused ${randomUUID()}`;
      const body = { registeredBefore: CUT_OVER, reason };
      const staff = await staffSession("event-registrar");
      const forbidden = await run(body, adminHeaders(staff.sid));
      expect(forbidden.statusCode, forbidden.payload).toBe(403);
      const { cookie } = await doctor(h);
      for (const headers of [sessionHeaders(cookie), {}]) {
        const res = await run(body, headers as Record<string, string>);
        expect(res.statusCode, res.payload).toBe(401);
      }
      expect(await auditByReason(reason)).toEqual([]);
    });
  },
);
