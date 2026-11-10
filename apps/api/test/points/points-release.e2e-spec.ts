import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  noShowFactEventId,
  PointsNoShowSweep,
} from "../../src/points/points-no-show.sweep.js";
import {
  attended,
  bootSpend,
  lessonDone,
  obligationOf,
  payer,
  pricedItem,
  postingsOfPerson,
  pulOf,
  reserveOf,
  seedEvent,
  signUp,
  type SpendHarness,
} from "./spend-harness.js";

// 025 EARS-18 (#3810, advance annulment #3811) — the no-show release. The no-show sweep records
// `registration.no-show` (event id `no-show:<registrationId>`) for each hold
// still `held` once its event ended more than `setting.noShow.window` [24 h]
// ago, and the seeded `spend.release` reverses the hold. The cancel and void
// facts have no server-side producer yet (025 requirements EARS-18 deferral),
// so the sweep is the release path driven here. Skips without DATABASE_URL /
// IDP_ISSUER.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 spend — release on no-show (e2e)",
  () => {
    let h: SpendHarness;
    let sweep: PointsNoShowSweep;

    /** An event that started `hoursAgo` hours ago, priced 50 Pul in `mode`. */
    async function endedPricedEvent(
      hoursAgo: number,
      mode: "threshold" | "advance" = "threshold",
    ): Promise<string> {
      const eventId = await seedEvent(h, {
        state: "live",
        startedHoursAgo: hoursAgo,
        durationMin: 60,
      });
      await h.prices.put(
        eventId,
        { itemKind: "event", mode, pulCost: 50 },
        null,
      );
      return eventId;
    }

    async function end(eventId: string): Promise<void> {
      await h.pool.query("UPDATE events SET state = 'ended' WHERE id = $1", [
        eventId,
      ]);
    }

    async function journal(eventId: string) {
      const { rows } = await h.pool.query<{ outcome: string }>(
        "SELECT outcome FROM points_facts WHERE event_id = $1",
        [eventId],
      );
      return rows;
    }

    beforeAll(async () => {
      h = await bootSpend();
      sweep = h.app.get(PointsNoShowSweep);
    });

    afterAll(async () => {
      await h?.app.close();
    });

    it("EARS-18: a hold whose event ended beyond the no-show window is released by a compensating posting; no participation award; a re-run is idempotent", async () => {
      const eventId = await endedPricedEvent(30);
      const personId = await payer(h, 70);
      const fact = signUp(personId, eventId);
      await h.engine.record(fact);
      expect(await pulOf(h, personId)).toBe(20);
      await end(eventId);

      expect(await sweep.runOnce()).toBeGreaterThanOrEqual(1);
      const registrationId = String(fact.attributes.registrationId);
      expect((await reserveOf(h, registrationId))?.state).toBe("released");
      expect(await journal(noShowFactEventId(registrationId))).toEqual([
        { outcome: "applied" },
      ]);
      expect(await pulOf(h, personId)).toBe(70);
      const postings = await postingsOfPerson(h, personId);
      const reserve = postings.find((p) => p.leg === "reserve:balance")!;
      const reversal = postings.filter((p) => p.reverses_posting_id !== null);
      expect(reversal).toHaveLength(1);
      expect(reversal[0]!.amount).toBe(50);
      expect(reversal[0]!.leg).toBe(`reverse:${await postingIdOf(reserve.event_id)}`);
      // No participation award: nothing but the funding is on Bre / Con.
      const account = await h.ledger.readPersonAccount(personId);
      expect([account.bre, account.con, account.pul.reserved]).toEqual([0, 0, 0]);

      // A re-run records nothing new for this registration.
      await sweep.runOnce();
      expect(await journal(noShowFactEventId(registrationId))).toHaveLength(1);
      expect(
        (await postingsOfPerson(h, personId)).filter(
          (p) => p.reverses_posting_id !== null,
        ),
      ).toHaveLength(1);
    });

    async function postingIdOf(eventId: string): Promise<string> {
      const { rows } = await h.pool.query<{ id: string }>(
        "SELECT id FROM points_postings WHERE event_id = $1 AND leg = 'reserve:balance'",
        [eventId],
      );
      return rows[0]!.id;
    }

    it("EARS-18: within the no-show window, or before the event ended, the hold stays held", async () => {
      const recent = await endedPricedEvent(2);
      const running = await endedPricedEvent(30);
      const personId = await payer(h, 200);
      const a = signUp(personId, recent);
      const b = signUp(personId, running);
      await h.engine.record(a);
      await h.engine.record(b);
      await end(recent);
      await sweep.runOnce();
      expect((await reserveOf(h, a.attributes.registrationId))?.state).toBe("held");
      expect((await reserveOf(h, b.attributes.registrationId))?.state).toBe("held");
    });

    it("EARS-18: attendance confirmed after the no-show release settles nothing (no-open-hold) and still credits the participation award", async () => {
      const eventId = await endedPricedEvent(30);
      const personId = await payer(h, 50);
      const fact = signUp(personId, eventId);
      await h.engine.record(fact);
      await end(eventId);
      await sweep.runOnce();
      expect((await reserveOf(h, fact.attributes.registrationId))?.state).toBe(
        "released",
      );

      const late = await h.engine.record(attended(fact, 80));
      expect(late.trace.find((t) => t.ruleId === "spend.settle")?.verdict).toBe(
        "no-open-hold",
      );
      expect(late.applied.map((a) => a.ruleId)).toEqual(["accrual.participation"]);
      expect((await reserveOf(h, fact.attributes.registrationId))?.state).toBe(
        "released",
      );
      const account = await h.ledger.readPersonAccount(personId);
      expect(account.pul).toEqual({ unit: "Pul", available: 50, reserved: 0 });
      expect([account.bre, account.con]).toEqual([2, 1]);
    });

    it("EARS-18: releasing an advance-covered hold whose obligation was partly netted reverses the reserve, the advance and that obligation's own netting; every other obligation keeps its true remaining amount", async () => {
      const eventId = await endedPricedEvent(30, "advance");
      const personId = await payer(h, 10);
      const fact = signUp(personId, eventId);
      await h.engine.record(fact);
      const registrationId = String(fact.attributes.registrationId);
      expect(await obligationOf(h, registrationId)).toMatchObject({
        opened: 40,
        remaining: 40,
      });
      const lesson = await h.engine.record(lessonDone(personId));
      const credit = lesson.applied
        .flatMap((a) => a.postings)
        .find((p) => p.leg === "accrual:pul")!.amount;
      const netted = Math.min(credit, 40);
      expect(await obligationOf(h, registrationId)).toMatchObject({
        netted,
        remaining: 40 - netted,
      });
      // A later obligation on an item still running: untouched by the release.
      const other = signUp(
        personId,
        await pricedItem(h, { mode: "advance", pulCost: 20 }),
      );
      await h.engine.record(other);
      const otherBefore = (await obligationOf(h, other.attributes.registrationId))!;
      await end(eventId);

      await sweep.runOnce();
      expect((await reserveOf(h, registrationId))?.state).toBe("released");
      expect(await obligationOf(h, registrationId)).toMatchObject({
        state: "annulled",
        remaining: 0,
      });
      expect(await obligationOf(h, other.attributes.registrationId)).toEqual(
        otherBefore,
      );
      // As if the registration had never been made: the start Pul plus the
      // lesson's credit, less what the later sign-up took from the balance.
      const otherBalance = credit - netted >= 20 ? 20 : credit - netted;
      expect(await pulOf(h, personId)).toBe(10 + credit - otherBalance);
      const reversals = (await postingsOfPerson(h, personId)).filter(
        (p) => p.reverses_posting_id !== null,
      );
      expect(reversals.map((p) => p.amount).sort((a, b) => a - b)).toEqual(
        [10, netted].sort((a, b) => a - b),
      );
      const account = await h.ledger.readPersonAccount(personId);
      expect(account.advance).toEqual(
        otherBefore.state === "open"
          ? { open: 1, remaining: otherBefore.remaining }
          : { open: 0, remaining: 0 },
      );
    });
  },
);
