import { randomUUID } from "node:crypto";
import { PointsAccountSchema, PointsGatingDecisionSchema } from "@ds/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type PointsAdvanceSettledEvent,
  PointsEventsPublisher,
} from "../../src/points/points-events.js";
import { PointsLedgerError } from "../../src/points/points.errors.js";
import {
  bootSpend,
  doctor,
  lessonDone,
  obligationOf,
  payer,
  postingsOfPerson,
  pricedItem,
  pulOf,
  sessionHeaders,
  signUp,
  type SpendHarness,
  verifyPhone,
} from "./spend-harness.js";

// 025 EARS-15, 16, 20 (#3811) — the advance branch of the seeded
// `spend.reserve` (`allowAdvance`) on an advance-mode item, its cap
// `setting.advance.cap`, and the netting of open obligations by every later
// Pul credit, through `PointsEngine.record` over the real stack. Skips
// without DATABASE_URL / IDP_ISSUER.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 spend — event advance (e2e)",
  () => {
    let h: SpendHarness;
    let cap: number;
    const settled: PointsAdvanceSettledEvent[] = [];

    async function refusalOf(p: Promise<unknown>): Promise<PointsLedgerError> {
      const error = await p.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PointsLedgerError);
      return error as PointsLedgerError;
    }

    async function partsOf(registrationId: unknown) {
      const { rows } = await h.pool.query<{
        balance_part: number;
        advance_part: number;
        state: string;
      }>(
        "SELECT balance_part, advance_part, state FROM points_reserves WHERE registration_id = $1",
        [registrationId],
      );
      return rows[0];
    }

    /** The legs of a ledger fact as (leg kind, amount, debit, credit) — account kinds only. */
    async function legsOf(eventId: string) {
      const { rows } = await h.pool.query<{
        leg: string;
        amount: number;
        debit: string;
        credit: string;
      }>(
        `SELECT p.leg, p.amount,
                coalesce(d.system_code, d.subject_kind) AS debit,
                coalesce(c.system_code, c.subject_kind) AS credit
           FROM points_postings p
           JOIN points_accounts d ON d.id = p.debit_account_id
           JOIN points_accounts c ON c.id = p.credit_account_id
          WHERE p.event_id = $1
          ORDER BY p.leg`,
        [eventId],
      );
      return rows.map((r) => ({ ...r, leg: r.leg.replace(/:[0-9a-f-]{36}$/, ":<id>") }));
    }

    beforeAll(async () => {
      h = await bootSpend();
      h.app.get(PointsEventsPublisher).onAdvanceSettled((e) => {
        settled.push(e);
      });
      const { rows } = await h.pool.query<{ value: number }>(
        `SELECT (parameters->>'value')::int AS value FROM points_rule_versions
          WHERE rule_id = 'setting.advance.cap' AND effective_from <= now()
          ORDER BY version DESC LIMIT 1`,
      );
      cap = rows[0]!.value;
    });

    afterAll(async () => {
      await h?.app.close();
    });

    it("EARS-15: an advance-mode sign-up short of Pul reserves the available Pul and covers exactly the shortfall by an advance posting, opening an obligation of that amount", async () => {
      const personId = await payer(h, 10);
      const item = await pricedItem(h, { mode: "advance", pulCost: 50 });
      const fact = signUp(personId, item);
      const result = await h.engine.record(fact);
      expect(result.outcome).toBe("applied");
      expect(await legsOf(`${fact.eventId}#spend.reserve`)).toEqual([
        { leg: "reserve:advance", amount: 40, debit: "advance", credit: "reserve" },
        { leg: "reserve:balance", amount: 10, debit: "person", credit: "reserve" },
      ]);
      expect(await pulOf(h, personId)).toBe(0);
      expect(await partsOf(fact.attributes.registrationId)).toEqual({
        balance_part: 10,
        advance_part: 40,
        state: "held",
      });
      expect(await obligationOf(h, fact.attributes.registrationId)).toMatchObject({
        opened: 40,
        netted: 0,
        remaining: 40,
        state: "open",
      });
    });

    it("EARS-15: the decision does not read the arrival source — a doctor with a medrep attribution gets the identical postings", async () => {
      const item = await pricedItem(h, { mode: "advance", pulCost: 50 });
      // Attribution columns reference real rows: the member is a real user,
      // the organisation any existing one (none on an empty database).
      const medrep = (await doctor(h)).personId;
      const { rows } = await h.pool.query<{ id: string }>(
        "SELECT id FROM organisations LIMIT 1",
      );
      const plain = signUp(await payer(h, 10), item);
      const attributed = {
        ...signUp(await payer(h, 10), item),
        attribution: {
          memberId: medrep,
          ...(rows[0] ? { organisationId: rows[0].id } : {}),
        },
      };
      await h.engine.record(plain);
      await h.engine.record(attributed);
      expect(await legsOf(`${attributed.eventId}#spend.reserve`)).toEqual(
        await legsOf(`${plain.eventId}#spend.reserve`),
      );
      expect(
        (await obligationOf(h, attributed.attributes.registrationId))?.opened,
      ).toBe((await obligationOf(h, plain.attributes.registrationId))?.opened);
    });

    it("EARS-15/2: a reserve covered wholly by the advance writes no person-account posting; GET /v1/me/points reads the advance from the projection, never a negative balance", async () => {
      const { cookie, personId } = await doctor(h);
      await verifyPhone(h, personId);
      const item = await pricedItem(h, { mode: "advance", pulCost: 30 });
      const fact = signUp(personId, item);
      await h.engine.record(fact);
      expect(await legsOf(`${fact.eventId}#spend.reserve`)).toEqual([
        { leg: "reserve:advance", amount: 30, debit: "advance", credit: "reserve" },
      ]);
      expect(
        (await postingsOfPerson(h, personId)).filter((p) =>
          p.event_id.startsWith(fact.eventId),
        ),
      ).toEqual([]);
      const res = await h.app.inject({
        method: "GET",
        url: "/v1/me/points",
        headers: sessionHeaders(cookie),
      });
      expect(res.statusCode, res.payload).toBe(200);
      expect(PointsAccountSchema.parse(res.json())).toMatchObject({
        pul: { available: 0, reserved: 0 },
        advance: { open: 1, remaining: 30 },
      });
    });

    it("EARS-16: at the cap of open obligations the next advance-mode item behaves as threshold; open items and lessons stay open", async () => {
      const { cookie, personId } = await doctor(h);
      await verifyPhone(h, personId);
      const first = await pricedItem(h, { mode: "advance", pulCost: cap - 50 });
      const second = await pricedItem(h, { mode: "advance", pulCost: 50 });
      await h.engine.record(signUp(personId, first));
      await h.engine.record(signUp(personId, second));
      expect((await h.ledger.readPersonAccount(personId)).advance).toEqual({
        open: 2,
        remaining: cap,
      });

      const beyond = await pricedItem(h, { mode: "advance", pulCost: 1 });
      const fact = signUp(personId, beyond);
      const error = await refusalOf(h.engine.record(fact));
      expect(error.errorCode).toBe("POINTS_THRESHOLD_SHORT");
      expect(error.short?.shortfall).toBe(1);
      expect(error.short?.earnHint.pulToEarn).toBe(1 + cap);
      expect(await partsOf(fact.attributes.registrationId)).toBeUndefined();
      expect(
        (
          await h.pool.query("SELECT 1 FROM points_facts WHERE event_id = $1", [
            fact.eventId,
          ])
        ).rows,
      ).toEqual([]);

      const gate = async (ref: string) => {
        const res = await h.app.inject({
          method: "GET",
          url: `/v1/me/points/gating/${encodeURIComponent(ref)}`,
          headers: sessionHeaders(cookie),
        });
        expect(res.statusCode, res.payload).toBe(200);
        return PointsGatingDecisionSchema.parse(res.json()).decision;
      };
      expect(await gate(beyond)).toBe("short");
      expect(await gate(`lesson:${randomUUID()}`)).toBe("open");
      const open = await pricedItem(h, { mode: "open", pulCost: 50 });
      expect(await gate(open)).toBe("open");
      expect((await h.engine.record(signUp(personId, open))).outcome).toBe(
        "no-effect",
      );
      expect((await h.engine.record(lessonDone(personId))).outcome).toBe(
        "applied",
      );
      const account = await h.ledger.readPersonAccount(personId);
      expect(account.pul.available).toBeGreaterThanOrEqual(0);
    });

    it("EARS-20: a lesson's Pul first settles the open obligations person→advance, oldest first, in the same transaction, and AdvanceSettled carries the remaining amount", async () => {
      const personId = await payer(h, 0);
      const older = await pricedItem(h, { mode: "advance", pulCost: 5 });
      const newer = await pricedItem(h, { mode: "advance", pulCost: 30 });
      const olderFact = {
        ...signUp(personId, older),
        occurredAt: new Date(Date.now() - 60_000),
      };
      const newerFact = signUp(personId, newer);
      await h.engine.record(newerFact);
      await h.engine.record(olderFact);

      const lesson = lessonDone(personId);
      const result = await h.engine.record(lesson);
      const award = result.applied.find((a) => a.ruleId === "accrual.lesson")!;
      const credit = award.postings.find((p) => p.leg === "accrual:pul")!.amount;
      expect(credit).toBeGreaterThan(5);
      const a = (await obligationOf(h, olderFact.attributes.registrationId))!;
      const b = (await obligationOf(h, newerFact.attributes.registrationId))!;
      const second = Math.min(credit - 5, 30);
      expect(award.postings.map((p) => [p.leg, p.amount])).toEqual([
        ["accrual:pul", credit],
        [`obligation-settle:${a.id}`, 5],
        [`obligation-settle:${b.id}`, second],
      ]);
      expect(a).toMatchObject({ opened: 5, netted: 5, remaining: 0, state: "netted" });
      expect(b).toMatchObject({
        opened: 30,
        netted: second,
        remaining: 30 - second,
        state: second === 30 ? "netted" : "open",
      });
      expect(await pulOf(h, personId)).toBe(credit - 5 - second);
      expect((await h.ledger.readPersonAccount(personId)).advance).toEqual({
        open: second === 30 ? 0 : 1,
        remaining: 30 - second,
      });
      expect(settled.filter((e) => e.eventId === lesson.eventId)).toEqual([
        { personId, eventId: lesson.eventId, settled: 5 + second, remaining: 30 - second },
      ]);
    });

    it("EARS-20: a credit to a person with no open obligation settles nothing and publishes no AdvanceSettled", async () => {
      const personId = await payer(h, 0);
      const lesson = lessonDone(personId);
      const result = await h.engine.record(lesson);
      const legs = result.applied.flatMap((a) => a.postings.map((p) => p.leg));
      expect(legs.some((l) => l.startsWith("obligation-settle:"))).toBe(false);
      expect(settled.filter((e) => e.eventId === lesson.eventId)).toEqual([]);
    });
  },
);
