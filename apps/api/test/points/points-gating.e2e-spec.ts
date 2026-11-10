import { randomUUID } from "node:crypto";
import { PointsGatingDecisionSchema } from "@ds/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootSpend,
  doctor,
  fund,
  pricedItem,
  seedEvent,
  sessionHeaders,
  signUp,
  type SpendHarness,
  verifyPhone,
} from "./spend-harness.js";

// 025 EARS-13 / EARS-41 (#3810, advance #3811) — `GET /v1/me/points/gating/:itemRef` is
// `quote` of a draft `registration.created`: every decision branch for an
// event and a non-event item, never a negative number, equal to what
// `record` then enforces, and nothing written. An account-state refusal is
// the `blocked` decision with its problem slug — the read never answers a
// state problem; only a malformed item ref is refused (400). Skips without DATABASE_URL / IDP_ISSUER.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 spend — gating read GET /v1/me/points/gating/:itemRef (e2e)",
  () => {
    let h: SpendHarness;

    function gating(itemRef: string, cookie?: string, query = "") {
      return h.app.inject({
        method: "GET",
        url: `/v1/me/points/gating/${encodeURIComponent(itemRef)}${query}`,
        headers: sessionHeaders(cookie),
      });
    }

    async function decisionOf(itemRef: string, cookie: string) {
      const res = await gating(itemRef, cookie);
      expect(res.statusCode, res.payload).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const body = PointsGatingDecisionSchema.parse(res.json());
      for (const n of [
        body.pulCost,
        body.reservedFromBalance,
        body.coveredByAdvance,
        body.shortfall,
        body.earnHint?.pulToEarn ?? 0,
        body.earnHint?.lessonsNeeded ?? 0,
      ]) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
      return body;
    }

    async function writes(): Promise<number> {
      const { rows } = await h.pool.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM points_postings)
              + (SELECT count(*) FROM points_facts)
              + (SELECT count(*) FROM points_reserves)
              + (SELECT count(*) FROM points_accounts) AS n`,
      );
      return Number(rows[0]!.n);
    }

    beforeAll(async () => {
      h = await bootSpend();
    });

    afterAll(async () => {
      await h?.app.close();
    });

    it("EARS-13: open for an unpriced item, an open row, a zero price and a lesson", async () => {
      const { cookie } = await doctor(h);
      const open = await pricedItem(h, { mode: "open", pulCost: 50 });
      const zero = await pricedItem(h, { mode: "threshold", pulCost: 0 });
      // A lesson has no price row (none can be stored until 024 ships its
      // catalog), and an unpriced ref reads open.
      const lesson = `lesson:${randomUUID()}`;
      for (const item of [`course:${randomUUID()}`, open, zero, lesson]) {
        expect(await decisionOf(item, cookie)).toMatchObject({
          itemRef: item,
          decision: "open",
          reservedFromBalance: 0,
          shortfall: 0,
        });
      }
    });

    it("EARS-13 / EARS-41: reserve on a priced event when the Pul covers it — the quote writes nothing and the sign-up's record does what it said", async () => {
      const { cookie, personId } = await doctor(h);
      await verifyPhone(h, personId);
      await fund(h, personId, 70);
      const eventId = await seedEvent(h);
      await h.prices.put(
        eventId,
        { itemKind: "event", mode: "threshold", pulCost: 50 },
        null,
      );

      const before = await writes();
      const decision = await decisionOf(eventId, cookie);
      expect(await writes()).toBe(before);
      expect(decision).toMatchObject({
        mode: "threshold",
        pulCost: 50,
        unit: "Pul",
        decision: "reserve",
        reservedFromBalance: 50,
        shortfall: 0,
      });
      const recorded = await h.engine.record(signUp(personId, eventId));
      expect(recorded.applied.map((a) => a.effect)).toEqual(["reserve"]);
    });

    it("EARS-13: short on a priced event with the exact shortfall and an earn hint (pulToEarn, lessonsNeeded from the active accrual.lesson)", async () => {
      const { cookie, personId } = await doctor(h);
      await verifyPhone(h, personId);
      await fund(h, personId, 20);
      const item = await pricedItem(h, { mode: "threshold", pulCost: 100 });
      const decision = await decisionOf(item, cookie);
      expect(decision).toMatchObject({
        decision: "short",
        pulCost: 100,
        shortfall: 80,
        reservedFromBalance: 0,
        earnHint: { pulToEarn: 80 },
      });
      const { rows } = await h.pool.query<{ pul: number }>(
        `SELECT (parameters->'effect'->'amounts'->>'pul')::int AS pul
           FROM points_rule_versions WHERE rule_id = 'accrual.lesson'
             AND effective_from <= now() ORDER BY version DESC LIMIT 1`,
      );
      const credit = rows[0]?.pul ?? 0;
      expect(decision.earnHint?.lessonsNeeded).toBe(
        credit > 0 ? Math.ceil(80 / credit) : null,
      );
    });

    it("EARS-13/41: reserve-with-advance on an advance-mode event short of Pul within the cap — the quote writes nothing and the sign-up's record does what it said", async () => {
      const { cookie, personId } = await doctor(h);
      await verifyPhone(h, personId);
      await fund(h, personId, 10);
      const item = await pricedItem(h, { mode: "advance", pulCost: 50 });

      const before = await writes();
      const decision = await decisionOf(item, cookie);
      expect(await writes()).toBe(before);
      expect(decision).toMatchObject({
        mode: "advance",
        pulCost: 50,
        decision: "reserve-with-advance",
        reservedFromBalance: 10,
        coveredByAdvance: 40,
        shortfall: 0,
      });
      expect(decision.earnHint).toBeUndefined();
      const fact = signUp(personId, item);
      const recorded = await h.engine.record(fact);
      expect(
        recorded.applied
          .flatMap((a) => a.postings)
          .map((p) => [p.leg, p.amount])
          .sort(),
      ).toEqual([
        ["reserve:advance", 40],
        ["reserve:balance", 10],
      ]);
    });

    it("EARS-13: pulToEarn of a short decision nets the remaining open obligations (shortfall + remaining)", async () => {
      const { cookie, personId } = await doctor(h);
      await verifyPhone(h, personId);
      const advance = await pricedItem(h, { mode: "advance", pulCost: 40 });
      await h.engine.record(signUp(personId, advance));
      const item = await pricedItem(h, { mode: "threshold", pulCost: 30 });
      expect(await decisionOf(item, cookie)).toMatchObject({
        decision: "short",
        shortfall: 30,
        earnHint: { pulToEarn: 70 },
      });
    });

    it("EARS-13: an unverified phone and the limited-seat reserve limit are blocked decisions carrying the problem slug, not refusals", async () => {
      const unverified = await doctor(h);
      await fund(h, unverified.personId, 100);
      const item = await pricedItem(h, { mode: "threshold", pulCost: 50 });
      expect(await decisionOf(item, unverified.cookie)).toMatchObject({
        decision: "blocked",
        reason: "points-phone-unverified",
      });

      const busy = await doctor(h);
      await verifyPhone(h, busy.personId);
      await fund(h, busy.personId, 1000);
      for (let i = 0; i < 3; i++) {
        const seat = await pricedItem(h, {
          mode: "threshold",
          pulCost: 50,
          limitedSeats: true,
        });
        await h.engine.record(signUp(busy.personId, seat));
      }
      const fourth = await pricedItem(h, {
        mode: "threshold",
        pulCost: 50,
        limitedSeats: true,
      });
      expect(await decisionOf(fourth, busy.cookie)).toMatchObject({
        decision: "blocked",
        reason: "points-reserve-limit",
      });
    });

    it("EARS-13: a malformed itemRef → 400, no session → 401, another person's decision → 403", async () => {
      const { cookie, personId } = await doctor(h);
      const other = await doctor(h);
      const malformed = await gating("course x", cookie);
      expect(malformed.statusCode, malformed.payload).toBe(400);
      expect(malformed.json()).toMatchObject({
        errorCode: "POINTS_ITEM_REF_INVALID",
        type: expect.stringContaining("points-item-ref-invalid"),
      });
      expect((await gating("course:x")).statusCode).toBe(401);
      const foreign = await gating(
        "course:x",
        cookie,
        `?personId=${other.personId}`,
      );
      expect(foreign.statusCode).toBe(403);
      const own = await gating("course:x", cookie, `?personId=${personId}`);
      expect(own.statusCode).toBe(200);
    });
  },
);
