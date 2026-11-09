import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PointsLedgerError } from "../../src/points/points.errors.js";
import { registrationCreatedFactEventId } from "../../src/points/registration-facts.js";
import {
  attended,
  bootSpend,
  doctor,
  fund,
  payer,
  postingsOfPerson,
  pricedItem,
  pulOf,
  reserveOf,
  seedEvent,
  sessionHeaders,
  signUp,
  type SpendHarness,
  verifyPhone,
} from "./spend-harness.js";

// 025 EARS-14, 17, 19, 21 (#3810) — the seeded `spend.reserve` /
// `spend.settle` rules over `registration.created` and `attendance.confirmed`,
// through `PointsEngine.record` and through the 005 sign-up producer
// (`POST /v1/events/:id/registration`). Skips without DATABASE_URL / IDP_ISSUER.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 spend — reserve and settle (e2e)",
  () => {
    let h: SpendHarness;

    async function refusalOf(p: Promise<unknown>): Promise<PointsLedgerError> {
      const error = await p.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PointsLedgerError);
      return error as PointsLedgerError;
    }

    async function journalRows(eventId: string): Promise<number> {
      const { rows } = await h.pool.query(
        "SELECT 1 FROM points_facts WHERE event_id = $1",
        [eventId],
      );
      return rows.length;
    }

    beforeAll(async () => {
      h = await bootSpend();
    });

    afterAll(async () => {
      await h?.app.close();
    });

    it("EARS-14: a sign-up on a priced item reserves the price from the person account to the reserve account, referencing the registration and the item", async () => {
      const personId = await payer(h, 80);
      const item = await pricedItem(h, { mode: "threshold", pulCost: 50 });
      const fact = signUp(personId, item);
      const result = await h.engine.record(fact);
      expect(result.outcome).toBe("applied");
      expect(result.applied.map((a) => [a.ruleId, a.effect])).toEqual([
        ["spend.reserve", "reserve"],
      ]);
      expect(await pulOf(h, personId)).toBe(30);
      expect(await reserveOf(h, fact.attributes.registrationId)).toEqual({
        state: "held",
        price: 50,
        balance_part: 50,
        item_ref: item,
      });
      const reserve = (await postingsOfPerson(h, personId)).filter((p) =>
        p.event_id.startsWith(fact.eventId),
      );
      expect(reserve.map((p) => [p.leg, p.amount])).toEqual([
        ["reserve:balance", 50],
      ]);
    });

    it("EARS-14: an open item, a zero price or an unpriced item writes nothing", async () => {
      const personId = await payer(h, 80);
      const open = await pricedItem(h, { mode: "open", pulCost: 50 });
      const zero = await pricedItem(h, { mode: "threshold", pulCost: 0 });
      for (const item of [open, zero, `course:${randomUUID()}`]) {
        const fact = signUp(personId, item);
        const result = await h.engine.record(fact);
        expect(result.applied).toEqual([]);
        expect(await reserveOf(h, fact.attributes.registrationId)).toBeUndefined();
      }
      expect(await pulOf(h, personId)).toBe(80);
    });

    it("EARS-17: a threshold item with Pul below the price is refused points-threshold-short with the shortfall and earn hint; nothing is written, the journal included", async () => {
      const personId = await payer(h, 20);
      const item = await pricedItem(h, { mode: "threshold", pulCost: 50 });
      const fact = signUp(personId, item);
      const error = await refusalOf(h.engine.record(fact));
      expect(error.errorCode).toBe("POINTS_THRESHOLD_SHORT");
      expect(error.getStatus()).toBe(422);
      expect(error.short?.shortfall).toBe(30);
      expect(error.short?.earnHint.pulToEarn).toBe(30);
      expect(await journalRows(fact.eventId)).toBe(0);
      expect(await reserveOf(h, fact.attributes.registrationId)).toBeUndefined();
      expect(await pulOf(h, personId)).toBe(20);
    });

    it("EARS-17: until the advance slice (#3811) an advance-mode item short of Pul is refused like a threshold one", async () => {
      const personId = await payer(h, 10);
      const item = await pricedItem(h, { mode: "advance", pulCost: 50 });
      const error = await refusalOf(h.engine.record(signUp(personId, item)));
      expect(error.errorCode).toBe("POINTS_THRESHOLD_SHORT");
      expect(error.short?.shortfall).toBe(40);
    });

    it("EARS-5: a reserve for a person whose phone is unverified is refused points-phone-unverified", async () => {
      const personId = randomUUID();
      await fund(h, personId, 100);
      const item = await pricedItem(h, { mode: "threshold", pulCost: 50 });
      const error = await refusalOf(h.engine.record(signUp(personId, item)));
      expect(error.errorCode).toBe("POINTS_PHONE_UNVERIFIED");
      expect(await pulOf(h, personId)).toBe(100);
    });

    it("EARS-19: attendance at or above the presence share debits the hold to the sink exactly once; a replay is duplicate; below the share nothing settles", async () => {
      const personId = await payer(h, 100);
      const item = await pricedItem(h, { mode: "threshold", pulCost: 50 });
      const fact = signUp(personId, item);
      await h.engine.record(fact);

      const below = await h.engine.record(attended(fact, 10));
      expect(below.applied.map((a) => a.ruleId)).not.toContain("spend.settle");
      expect((await reserveOf(h, fact.attributes.registrationId))?.state).toBe("held");

      const at = attended(fact, 30);
      const settled = await h.engine.record(at);
      expect(settled.applied.map((a) => a.ruleId)).toContain("spend.settle");
      expect((await reserveOf(h, fact.attributes.registrationId))?.state).toBe("settled");
      expect((await h.engine.record(at)).outcome).toBe("duplicate");

      // A second attendance fact for the same registration settles nothing.
      const again = await h.engine.record(attended(fact, 90));
      expect(again.applied.map((a) => a.ruleId)).not.toContain("spend.settle");
      expect(again.trace.find((t) => t.ruleId === "spend.settle")?.verdict).toMatch(
        /limit-reached|no-open-hold/,
      );
      const { rows } = await h.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM points_postings WHERE event_id LIKE $1 AND leg = 'settle:pul'",
        [`%#spend.settle`],
      );
      expect(rows[0]!.n).toBeGreaterThan(0);
      // The person account paid the price once: 100 − 50.
      expect(await pulOf(h, personId)).toBe(50);
      expect((await h.ledger.readPersonAccount(personId)).pul).toEqual({
        unit: "Pul",
        available: 50,
        reserved: 0,
      });
    });

    it("EARS-21: parallel sign-ups on limited-seat items hold at most setting.reserve.limitedSeats.max [3]; the next one is refused points-reserve-limit and writes nothing", async () => {
      const personId = await payer(h, 1000);
      const items = await Promise.all(
        Array.from({ length: 5 }, () =>
          pricedItem(h, { mode: "threshold", pulCost: 50, limitedSeats: true }),
        ),
      );
      const facts = items.map((item) => signUp(personId, item));
      const settled = await Promise.allSettled(
        facts.map((f) => h.engine.record(f)),
      );
      const applied = settled.filter((s) => s.status === "fulfilled");
      const refused = settled.filter(
        (s): s is PromiseRejectedResult => s.status === "rejected",
      );
      expect(applied).toHaveLength(3);
      expect(refused).toHaveLength(2);
      for (const r of refused) {
        expect((r.reason as PointsLedgerError).errorCode).toBe(
          "POINTS_RESERVE_LIMIT",
        );
      }
      expect(await pulOf(h, personId)).toBe(1000 - 3 * 50);
      // A non-limited item is not counted by the limit.
      const free = await pricedItem(h, { mode: "threshold", pulCost: 50 });
      expect((await h.engine.record(signUp(personId, free))).outcome).toBe("applied");
    });

    it("EARS-14 / EARS-17: the 005 sign-up reports registration.created in its transaction — a covered doctor is reserved, a short doctor's sign-up fails closed with no registration row", async () => {
      const eventId = await seedEvent(h, { state: "published" });
      await h.prices.put(eventId, { itemKind: "event", mode: "threshold", pulCost: 50 }, null);

      const rich = await doctor(h);
      await verifyPhone(h, rich.personId);
      await fund(h, rich.personId, 60);
      const ok = await h.app.inject({
        method: "POST",
        url: `/v1/events/${eventId}/registration`,
        headers: sessionHeaders(rich.cookie),
      });
      expect(ok.statusCode, ok.payload).toBe(200);
      const { rows: regs } = await h.pool.query<{ id: string }>(
        "SELECT id FROM registrations WHERE user_id = $1 AND event_id = $2",
        [rich.personId, eventId],
      );
      expect(regs).toHaveLength(1);
      expect(await journalRows(registrationCreatedFactEventId(regs[0]!.id))).toBe(1);
      expect((await reserveOf(h, regs[0]!.id))?.state).toBe("held");
      expect(await pulOf(h, rich.personId)).toBe(10);
      // The idempotent repeat reserves nothing more.
      const repeat = await h.app.inject({
        method: "POST",
        url: `/v1/events/${eventId}/registration`,
        headers: sessionHeaders(rich.cookie),
      });
      expect(repeat.statusCode).toBe(200);
      expect(await pulOf(h, rich.personId)).toBe(10);

      const poor = await doctor(h);
      await verifyPhone(h, poor.personId);
      await fund(h, poor.personId, 20);
      const short = await h.app.inject({
        method: "POST",
        url: `/v1/events/${eventId}/registration`,
        headers: sessionHeaders(poor.cookie),
      });
      expect(short.statusCode, short.payload).toBe(422);
      expect(short.json()).toMatchObject({
        errorCode: "POINTS_THRESHOLD_SHORT",
        reason: "points-threshold-short",
        shortfall: 30,
      });
      const { rows: none } = await h.pool.query(
        "SELECT 1 FROM registrations WHERE user_id = $1 AND event_id = $2",
        [poor.personId, eventId],
      );
      expect(none).toHaveLength(0);
      expect(await pulOf(h, poor.personId)).toBe(20);
    });
  },
);
