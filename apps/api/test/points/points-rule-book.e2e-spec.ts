import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import {
  POINTS_RULE_DEFAULTS,
  POINTS_RULE_IDS,
  type PointsAccrualFact,
  type PointsCreditedEvent,
} from "@ds/schemas";
import { PointsEventsPublisher } from "../../src/points/points-events.js";
import { PointsFactIntake } from "../../src/points/points-fact-intake.service.js";
import { PointsLedgerService } from "../../src/points/points-ledger.service.js";
import { PointsLedgerError } from "../../src/points/points.errors.js";
import { RuleBookService } from "../../src/points/rule-book.service.js";

// 025 rule book + accrual intake (#3808) against a real Postgres migrated
// through 0059 — EARS-3 (version active at occurredAt, one posting per
// non-zero denomination, all fields, one transaction, PointsCredited once),
// EARS-12 (no Bre/Con debit, no conversion) and EARS-25 at the service level
// (the HTTP route, its authz and audit live in points-rules-admin.e2e-spec).
//
// Rule versions are global and immutable, so a test that re-tunes a rule
// publishes the re-tuned version for a two-second window and then publishes
// the PRD defaults again: every fact dated after the window evaluates the
// defaults, exactly as before the test. Persons and event ids are unique per
// run; postings are append-only, so nothing is tidied up.
describe.skipIf(!process.env.DATABASE_URL)(
  "025 rule book and accrual intake (e2e)",
  () => {
    let handle: DrizzleHandle;
    let ledger: PointsLedgerService;
    let rules: RuleBookService;
    let events: PointsEventsPublisher;
    let intake: PointsFactIntake;
    const credited: PointsCreditedEvent[] = [];

    function fact(
      overrides: Partial<PointsAccrualFact> = {},
    ): PointsAccrualFact {
      return {
        eventId: `lesson-completed:${randomUUID()}`,
        personId: randomUUID(),
        action: "lesson",
        contentRef: randomUUID(),
        occurredAt: new Date(Date.now() - 60_000),
        ...overrides,
      };
    }

    async function rows(eventId: string) {
      const { rows: found } = await handle.pool.query<{
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
        attributed_member_id: string | null;
        occurred_at: Date;
        recorded_at: Date;
        debit_kind: string;
        debit_code: string | null;
        credit_kind: string;
        credit_subject: string | null;
        dedupe_key: string | null;
      }>(
        `SELECT p.*, d.subject_kind AS debit_kind, d.system_code AS debit_code,
                c.subject_kind AS credit_kind, c.subject_id AS credit_subject,
                k.dedupe_key
           FROM points_postings p
           JOIN points_accounts d ON d.id = p.debit_account_id
           JOIN points_accounts c ON c.id = p.credit_account_id
           JOIN points_posting_keys k ON k.event_id = p.event_id
          WHERE p.event_id = $1 ORDER BY p.leg`,
        [eventId],
      );
      return found;
    }

    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    beforeAll(async () => {
      handle = createDrizzle(process.env.DATABASE_URL!, { max: 10 });
      ledger = new PointsLedgerService(handle.db);
      rules = new RuleBookService(handle.db);
      events = new PointsEventsPublisher();
      intake = new PointsFactIntake(handle.db, rules, ledger, events);
      events.onCredited((event) => {
        credited.push(event);
      });
    });

    afterAll(async () => {
      await handle.pool.end();
    });

    it("025 EARS-25: the seed migration stores version 1 of every rule with the PRD defaults, published by no admin", async () => {
      const { rows: seeded } = await handle.pool.query<{
        rule_id: string;
        parameters: unknown;
        effective_from: Date;
        published_by: string | null;
      }>(
        `SELECT rule_id, parameters, effective_from, published_by
           FROM points_rule_versions WHERE version = 1 AND rule_id = ANY($1)`,
        [POINTS_RULE_IDS],
      );
      expect(seeded).toHaveLength(POINTS_RULE_IDS.length);
      for (const row of seeded) {
        expect(row.parameters, row.rule_id).toEqual(
          POINTS_RULE_DEFAULTS[
            row.rule_id as keyof typeof POINTS_RULE_DEFAULTS
          ],
        );
        expect(row.effective_from.getTime()).toBe(0);
        expect(row.published_by).toBeNull();
      }
      const { rows: issuance } = await handle.pool.query(
        `SELECT 1 FROM points_accounts WHERE system_code = 'issuance' AND unit = 'attention_points'`,
      );
      expect(issuance).toHaveLength(1);
    });

    it("025 EARS-3: an accrual fact writes one posting per non-zero denomination, issuance → person, carrying every field, then emits PointsCredited once", async () => {
      const projectId = (
        await handle.pool.query<{ id: string }>(
          `SELECT id FROM projects LIMIT 1`,
        )
      ).rows[0]?.id;
      const f = fact({
        action: "module",
        ...(projectId ? { projectId } : {}),
        output: { type: "module", id: randomUUID() },
      });
      const active = await rules.activeVersion("accrual.module", f.occurredAt);
      const before = credited.length;
      const outcome = await intake.accept(f);
      expect(outcome.status).toBe("posted");
      const written = await rows(f.eventId);
      const expected = (["bre", "con", "pul"] as const).filter(
        (d) => active.parameters[d] > 0,
      );
      expect(written.map((r) => r.denomination)).toEqual(expected);
      for (const row of written) {
        expect(row).toMatchObject({
          leg: `accrual:${row.denomination}`,
          amount: active.parameters[row.denomination as "pul"],
          rule_id: "accrual.module",
          rule_version: active.version,
          action: "module",
          project_id: projectId ?? null,
          output_type: "module",
          output_id: f.output!.id,
          debit_kind: "system",
          debit_code: "issuance",
          credit_kind: "person",
          credit_subject: f.personId,
          dedupe_key: `${f.personId}:${f.contentRef}:module`,
        });
        expect(row.occurred_at.getTime()).toBe(f.occurredAt.getTime());
        expect(row.recorded_at).toBeInstanceOf(Date);
      }
      expect(credited.slice(before)).toEqual([
        {
          personId: f.personId,
          eventId: f.eventId,
          postings: expect.arrayContaining(
            expected.map((d) => ({
              denomination: d,
              amount: active.parameters[d],
            })),
          ),
        },
      ]);
    });

    it("025 EARS-3: the attribution subject is written to the postings and changes no amount", async () => {
      const { rows: org } = await handle.pool.query<{ id: string }>(
        `SELECT id FROM organisations LIMIT 1`,
      );
      const plain = fact();
      const attributed = fact({
        attribution: {
          ...(org[0] ? { organisationId: org[0].id } : {}),
        },
      });
      await intake.accept(plain);
      await intake.accept(attributed);
      const a = await rows(plain.eventId);
      const b = await rows(attributed.eventId);
      expect(b.map((r) => r.amount)).toEqual(a.map((r) => r.amount));
      expect(b[0]!.attributed_organisation_id).toBe(org[0]?.id ?? null);
    });

    it("025 EARS-3: a duplicate fact (same dedupe key, other event id) writes nothing and emits no event", async () => {
      const f = fact();
      expect((await intake.accept(f)).status).toBe("posted");
      const before = credited.length;
      const replay = await intake.accept({
        ...f,
        eventId: `retry:${randomUUID()}`,
      });
      expect(replay.status).toBe("duplicate");
      expect(
        replay.status === "duplicate" && replay.postings.length,
      ).toBeGreaterThan(0);
      expect(credited.length).toBe(before);
    });

    it("025 EARS-3: a refused posting rolls back the whole fact in one transaction and emits nothing", async () => {
      const f = fact();
      await ledger.close(f.personId, new Date());
      const before = credited.length;
      await expect(intake.accept(f)).rejects.toMatchObject({
        errorCode: "POINTS_ACCOUNT_CLOSED",
      });
      const { rows: keys } = await handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [f.eventId],
      );
      expect(keys).toHaveLength(0);
      expect(credited.length).toBe(before);
    });

    it("025 EARS-3: accept owns its transaction and publishes PointsCredited exactly once, and not on a duplicate", async () => {
      const f = fact();
      const before = credited.length;
      expect((await intake.accept(f)).status).toBe("posted");
      expect(credited.slice(before).map((e) => e.eventId)).toEqual([f.eventId]);
      expect((await intake.accept(f)).status).toBe("duplicate");
      expect(credited.length).toBe(before + 1);
    });

    it("025 EARS-3: acceptWithin a producer's transaction publishes nothing before publishAfterCommit, then exactly once", async () => {
      const f = fact();
      const before = credited.length;
      const { outcome, publishAfterCommit } = await handle.db.transaction(
        async (tx) => {
          const accepted = await intake.acceptWithin(tx, f);
          expect(credited.length).toBe(before);
          return accepted;
        },
      );
      expect(outcome.status).toBe("posted");
      expect(await rows(f.eventId)).not.toHaveLength(0);
      expect(credited.length).toBe(before);
      await publishAfterCommit();
      await publishAfterCommit();
      expect(credited.slice(before).map((e) => e.eventId)).toEqual([f.eventId]);
    });

    it("025 EARS-3: after a producer's rollback an acceptWithin fact is neither stored nor published", async () => {
      const f = fact();
      const before = credited.length;
      await expect(
        handle.db.transaction(async (tx) => {
          await intake.acceptWithin(tx, f);
          throw new Error("producer aborts");
        }),
      ).rejects.toThrow("producer aborts");
      expect(await rows(f.eventId)).toHaveLength(0);
      const { rows: keys } = await handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [f.eventId],
      );
      expect(keys).toHaveLength(0);
      expect(credited.length).toBe(before);
    });

    it("025 EARS-4: two lesson facts of one person for different lessons both credit", async () => {
      const personId = randomUUID();
      const first = fact({ personId, contentRef: randomUUID() });
      const second = fact({ personId, contentRef: randomUUID() });
      expect((await intake.accept(first)).status).toBe("posted");
      expect((await intake.accept(second)).status).toBe("posted");
      expect(await rows(second.eventId)).not.toHaveLength(0);
    });

    it("025 EARS-4: the intake refuses a content-scoped fact without contentRef and writes nothing", async () => {
      const { contentRef: _omitted, ...f } = fact();
      const before = credited.length;
      await expect(intake.accept(f)).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["contentRef"] })],
      });
      const { rows: keys } = await handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [f.eventId],
      );
      expect(keys).toHaveLength(0);
      expect(credited.length).toBe(before);
    });

    it("025 EARS-3 / EARS-25: a fact evaluates the version active at its occurredAt — a fact dated before a newly published version keeps the old one", async () => {
      const earlier = new Date(Date.now() - 60_000);
      const old = await rules.activeVersion("accrual.lesson", earlier);
      const effectiveFrom = new Date(Date.now() + 2_000);
      const retuned = await rules.publish({
        ruleId: "accrual.lesson",
        parameters: { pul: 15, bre: 1, con: 0 },
        effectiveFrom,
        actorSub: null,
      });
      // Restore the defaults two seconds later (see the file header).
      const restored = await rules.publish({
        ruleId: "accrual.lesson",
        parameters: POINTS_RULE_DEFAULTS["accrual.lesson"],
        effectiveFrom: new Date(effectiveFrom.getTime() + 2_000),
        actorSub: null,
      });
      expect(restored.version).toBe(retuned.version + 1);

      const before = fact({ occurredAt: earlier });
      await intake.accept(before);
      await wait(effectiveFrom.getTime() - Date.now() + 50);
      const after = fact({
        occurredAt: new Date(effectiveFrom.getTime() + 10),
      });
      await intake.accept(after);

      const oldPul = (await rows(before.eventId)).find(
        (r) => r.denomination === "pul",
      )!;
      expect(oldPul.rule_version).toBe(old.version);
      expect(oldPul.amount).toBe(old.parameters.pul);
      const newPul = (await rows(after.eventId)).find(
        (r) => r.denomination === "pul",
      )!;
      expect(newPul).toMatchObject({
        rule_version: retuned.version,
        amount: 15,
      });

      const later = await rules.activeVersion(
        "accrual.lesson",
        new Date(effectiveFrom.getTime() + 3_000),
      );
      expect(later.version).toBe(restored.version);
    });

    it("025 EARS-3: a rule version crediting zero in every denomination writes nothing and emits nothing", async () => {
      const effectiveFrom = new Date(Date.now() + 1_000);
      await rules.publish({
        ruleId: "accrual.rating",
        parameters: { pul: 0, bre: 0, con: 0 },
        effectiveFrom,
        actorSub: null,
      });
      await rules.publish({
        ruleId: "accrual.rating",
        parameters: POINTS_RULE_DEFAULTS["accrual.rating"],
        effectiveFrom: new Date(effectiveFrom.getTime() + 2_000),
        actorSub: null,
      });
      await wait(effectiveFrom.getTime() - Date.now() + 50);
      const f = fact({
        action: "rating",
        occurredAt: new Date(effectiveFrom.getTime() + 10),
      });
      const before = credited.length;
      const outcome = await intake.accept(f);
      expect(outcome.status).toBe("nothing-to-credit");
      expect(await rows(f.eventId)).toHaveLength(0);
      expect(credited.length).toBe(before);
    });

    it("025 EARS-12: every accrual leg credits the person; no accepted fact debits Bre or Con from a person account", async () => {
      const f = fact({ action: "participation" });
      await intake.accept(f);
      for (const row of await rows(f.eventId)) {
        expect(row.credit_kind).toBe("person");
        expect(row.debit_kind).toBe("system");
      }
    });

    it("025 EARS-12: the ledger refuses a leg debiting Bre or Con from a person (penalty or conversion) and writes nothing", async () => {
      const personId = randomUUID();
      await intake.accept(fact({ personId, action: "module" }));
      for (const legs of [
        // a penalty
        [{ leg: "penalty:bre", denomination: "bre" as const }],
        // a conversion Con → Bre
        [{ leg: "convert:con", denomination: "con" as const }],
      ]) {
        const eventId = `forbidden:${randomUUID()}`;
        const error = await ledger
          .post({
            eventId,
            occurredAt: new Date(),
            legs: [
              ...legs.map((l) => ({
                ...l,
                debit: { kind: "person" as const, personId },
                credit: { kind: "system" as const, code: "sink" as const },
                amount: 1,
                ruleId: "manual-correction",
                ruleVersion: 1,
              })),
              ...(legs[0]!.denomination === "con"
                ? [
                    {
                      leg: "convert:bre",
                      debit: {
                        kind: "system" as const,
                        code: "issuance" as const,
                      },
                      credit: { kind: "person" as const, personId },
                      denomination: "bre" as const,
                      amount: 2,
                      ruleId: "manual-correction",
                      ruleVersion: 1,
                    },
                  ]
                : []),
            ],
          })
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(PointsLedgerError);
        expect((error as PointsLedgerError).errorCode).toBe(
          "POINTS_BRE_CON_DEBIT",
        );
        expect((error as PointsLedgerError).getStatus()).toBe(422);
        const { rows: keys } = await handle.pool.query(
          `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
          [eventId],
        );
        expect(keys).toHaveLength(0);
      }
    });

    it("025 EARS-12: a compensating reversal of a specific earlier accrual may debit Bre", async () => {
      const personId = randomUUID();
      const outcome = await intake.accept(fact({ personId, action: "module" }));
      expect(outcome.status).toBe("posted");
      const bre =
        outcome.status === "posted"
          ? outcome.postings.find((p) => p.denomination === "bre")!
          : undefined;
      const reversal = await ledger.post({
        eventId: `reversal:${randomUUID()}`,
        occurredAt: new Date(),
        legs: [
          {
            leg: "reversal:bre",
            debit: { kind: "person", personId },
            credit: { kind: "system", code: "issuance" },
            denomination: "bre",
            amount: bre!.amount,
            ruleId: bre!.ruleId,
            ruleVersion: bre!.ruleVersion,
            reverses: { postingId: bre!.id, occurredAt: bre!.occurredAt },
          },
        ],
      });
      expect(reversal.status).toBe("posted");
    });

    it("025 EARS-25: publish refuses an unknown rule, invalid parameters and a past effectiveFrom, storing nothing", async () => {
      const count = async () =>
        Number(
          (
            await handle.pool.query<{ n: string }>(
              `SELECT count(*) AS n FROM points_rule_versions WHERE rule_id = 'advance.cap'`,
            )
          ).rows[0]!.n,
        );
      const start = await count();
      await expect(
        rules.publish({
          ruleId: "accrual.prescription",
          parameters: {},
          actorSub: null,
        }),
      ).rejects.toMatchObject({ errorCode: "POINTS_RULE_UNKNOWN" });
      for (const parameters of [
        { pul: -1 },
        { pul: 150, sponsorId: "x" },
        {},
      ]) {
        await expect(
          rules.publish({ ruleId: "advance.cap", parameters, actorSub: null }),
        ).rejects.toMatchObject({
          errorCode: "POINTS_RULE_PARAMETERS_INVALID",
        });
      }
      await expect(
        rules.publish({
          ruleId: "advance.cap",
          parameters: { pul: 150 },
          effectiveFrom: new Date(Date.now() - 60_000),
          actorSub: null,
        }),
      ).rejects.toMatchObject({ errorCode: "POINTS_RULE_EFFECTIVE_FROM_PAST" });
      expect(await count()).toBe(start);
    });

    it("025 EARS-25: concurrent publishes of one rule get distinct consecutive versions", async () => {
      const published = await Promise.all(
        Array.from({ length: 4 }, () =>
          rules.publish({
            ruleId: "leaderboard.top",
            parameters: POINTS_RULE_DEFAULTS["leaderboard.top"],
            actorSub: null,
          }),
        ),
      );
      const versions = published.map((p) => p.version).sort((a, b) => a - b);
      expect(versions).toEqual(versions.map((_, i) => versions[0]! + i));
    });

    it("025 EARS-25: a stored version is immutable — UPDATE of its parameters and DELETE are refused by the database", async () => {
      await expect(
        handle.pool.query(
          `UPDATE points_rule_versions SET parameters = '{"pul":1,"bre":0,"con":0}' WHERE rule_id = 'accrual.lesson' AND version = 1`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        handle.pool.query(
          `DELETE FROM points_rule_versions WHERE rule_id = 'accrual.lesson' AND version = 1`,
        ),
      ).rejects.toThrow(/append-only/);
    });
  },
);
