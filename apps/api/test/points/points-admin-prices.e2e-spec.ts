import { randomUUID } from "node:crypto";
import { PointsPriceSchema } from "@ds/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";
import {
  attended,
  bootSpend,
  DEVICE,
  doctor,
  payer,
  pulOf,
  reserveOf,
  seedEvent,
  sessionHeaders,
  signUp,
  type SpendHarness,
} from "./spend-harness.js";

// 025 EARS-26 (#3810) — `PUT /v1/admin/points/prices/:itemRef` over the real
// stack: any mode for a priceable kind, only `open` for a lesson, a module
// (and an НМО-accredited event — unit-pinned in points-prices.service.spec.ts,
// since `eventEconomyFacts()` reports no event as НМО today), audited to the
// admin, applied to later reserves only. Skips without DATABASE_URL /
// IDP_ISSUER. The admin stays: `points_prices.updated_by` references it.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 spend — admin price list (e2e)",
  () => {
    let h: SpendHarness;
    let sid: string;
    let sub: string;
    const password = "Aa1!ufficiently-long-pw";

    async function adminSession() {
      const { email, sub } = await registerUniqueFakeUserFixture({
        app: h.app,
        pool: h.pool,
        fake: h.fake,
        nextEmail: () => `points-prices-admin-${randomUUID()}@ds.test`,
        password,
        consent: [{ purpose: "tos", version: "2026-01" }],
      });
      await h.fake.grantProjectRole(sub, "platform_admin");
      const { sid } = await establishAdminSession(h.app, {
        identifier: email,
        password,
        device: DEVICE,
      });
      return { sid, sub };
    }

    function put(
      itemRef: string,
      payload: unknown,
      session: string | null = sid,
    ) {
      return h.app.inject({
        method: "PUT",
        url: `/v1/admin/points/prices/${encodeURIComponent(itemRef)}`,
        headers: {
          ...DEVICE,
          "content-type": "application/json",
          ...(session ? adminHeaders(session) : {}),
        },
        payload: payload as Record<string, unknown>,
      });
    }

    async function rowOf(itemRef: string) {
      const { rows } = await h.pool.query(
        "SELECT mode, pul_cost FROM points_prices WHERE item_ref = $1",
        [itemRef],
      );
      return rows[0];
    }

    beforeAll(async () => {
      h = await bootSpend();
      ({ sid, sub } = await adminSession());
    });

    afterAll(async () => {
      await h?.app.close();
    });

    it("EARS-26: an admin prices an event in advance mode — stored, returned, audited to the admin", async () => {
      const itemRef = await seedEvent(h);
      const res = await put(itemRef, {
        itemKind: "event",
        mode: "advance",
        pulCost: 100,
        limitedSeats: true,
      });
      expect(res.statusCode, res.payload).toBe(200);
      expect(PointsPriceSchema.parse(res.json())).toMatchObject({
        itemRef,
        itemKind: "event",
        mode: "advance",
        pulCost: 100,
        unit: "Pul",
        limitedSeats: true,
      });
      expect(await rowOf(itemRef)).toEqual({ mode: "advance", pul_cost: 100 });
      const { rows } = await h.pool.query<{
        subject_id: string;
        source: string;
      }>(
        `SELECT subject_id, metadata ->> 'source' AS source FROM audit_ledger
          WHERE event_type = 'data.points_prices.insert'
            AND metadata -> 'pk' ->> 'item_ref' = $1`,
        [itemRef],
      );
      expect(rows).toEqual([{ subject_id: sub, source: "admin-ui" }]);
    });

    it("EARS-26: a lesson or a module is refused any mode but open (points-gating-invalid); an unknown event is refused; nothing is stored", async () => {
      for (const itemKind of ["lesson", "module"]) {
        const itemRef = `${itemKind}:${randomUUID()}`;
        const res = await put(itemRef, {
          itemKind,
          mode: "threshold",
          pulCost: 50,
        });
        expect(res.statusCode, res.payload).toBe(422);
        expect(res.json()).toMatchObject({
          errorCode: "POINTS_GATING_INVALID",
        });
        expect(await rowOf(itemRef)).toBeUndefined();
      }
      const ghost = randomUUID();
      const res = await put(ghost, {
        itemKind: "event",
        mode: "threshold",
        pulCost: 50,
      });
      expect(res.statusCode).toBe(422);
      expect(await rowOf(ghost)).toBeUndefined();
    });

    it("EARS-26: a ref must resolve as its declared kind — an event's id priced as any other kind is refused (points-gating-invalid), as is every kind with no platform table yet; nothing is stored", async () => {
      const eventId = await seedEvent(h);
      for (const itemKind of [
        "course",
        "training",
        "internship",
        "offline-event",
      ]) {
        const asOther = await put(eventId, {
          itemKind,
          mode: "threshold",
          pulCost: 50,
        });
        expect(asOther.statusCode, asOther.payload).toBe(422);
        expect(asOther.json()).toMatchObject({
          errorCode: "POINTS_GATING_INVALID",
        });
        const ownRef = `${itemKind}:${randomUUID()}`;
        const own = await put(ownRef, {
          itemKind,
          mode: "threshold",
          pulCost: 50,
        });
        expect(own.statusCode, own.payload).toBe(422);
        expect(await rowOf(ownRef)).toBeUndefined();
      }
      for (const itemKind of ["lesson", "module"]) {
        const own = await put(`${itemKind}:${randomUUID()}`, {
          itemKind,
          mode: "open",
          pulCost: 0,
        });
        expect(own.statusCode, own.payload).toBe(422);
      }
      expect(await rowOf(eventId)).toBeUndefined();
    });

    it("EARS-26: a malformed body (400 validation-failed) or item ref (400 points-item-ref-invalid) stores nothing", async () => {
      const itemRef = `course:${randomUUID()}`;
      const res = await put(itemRef, {
        itemKind: "course",
        mode: "threshold",
        pulCost: -1,
      });
      expect(res.statusCode, res.payload).toBe(400);
      expect(res.json().errorCode).toBe("VALIDATION_FAILED");
      expect(await rowOf(itemRef)).toBeUndefined();
      const bad = await put("course x", {
        itemKind: "course",
        mode: "open",
        pulCost: 0,
      });
      expect(bad.statusCode, bad.payload).toBe(400);
      expect(bad.json().errorCode).toBe("POINTS_ITEM_REF_INVALID");
      expect(await rowOf("course x")).toBeUndefined();
    });

    it("EARS-26: without an admin session → 401, with a portal session → 401, without platform_admin → 403", async () => {
      const itemRef = `course:${randomUUID()}`;
      const body = { itemKind: "course", mode: "threshold", pulCost: 50 };
      expect((await put(itemRef, body, null)).statusCode).toBe(401);
      const portal = await doctor(h);
      const viaPortal = await h.app.inject({
        method: "PUT",
        url: `/v1/admin/points/prices/${encodeURIComponent(itemRef)}`,
        headers: {
          ...sessionHeaders(portal.cookie),
          "content-type": "application/json",
        },
        payload: body,
      });
      expect(viaPortal.statusCode).toBe(401);
      const other = await adminSession();
      await h.fake.revokeProjectRole(other.sub, "platform_admin");
      expect((await put(itemRef, body, other.sid)).statusCode).toBe(403);
      expect(await rowOf(itemRef)).toBeUndefined();
    });

    it("EARS-26: a price change applies to later reserves only — an existing hold keeps the price it was reserved at", async () => {
      const eventId = await seedEvent(h, { state: "live" });
      expect(
        (
          await put(eventId, {
            itemKind: "event",
            mode: "threshold",
            pulCost: 50,
          })
        ).statusCode,
      ).toBe(200);
      const personId = await payer(h, 300);
      const early = signUp(personId, eventId);
      await h.engine.record(early);
      expect(
        (
          await put(eventId, {
            itemKind: "event",
            mode: "threshold",
            pulCost: 100,
          })
        ).statusCode,
      ).toBe(200);
      const later = signUp(personId, eventId);
      await h.engine.record(later);
      expect((await reserveOf(h, early.attributes.registrationId))?.price).toBe(
        50,
      );
      expect((await reserveOf(h, later.attributes.registrationId))?.price).toBe(
        100,
      );
      await h.engine.record(attended(early, 100));
      expect((await reserveOf(h, early.attributes.registrationId))?.state).toBe(
        "settled",
      );
      expect(await pulOf(h, personId)).toBe(300 - 50 - 100);
    });
  },
);
