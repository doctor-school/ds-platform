import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { RoomConfigSchema, type EventLifecycleState } from "@ds/schemas";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { EventsService } from "../../src/events/events.service.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 006 EARS-1 / EARS-10 — the actual go-live instant (`live_at`) in the grant, the
// truthful basis for the room's «В эфире · N мин» live-duration pill.
//
// The scheduled `starts_at` is NOT the go-live moment (a broadcast may start late);
// the room must count elapsed minutes from when the director actually opened the
// room. So 007 `OpenRoom` (the `published → live` transition) stamps `live_at`
// exactly once, and the EARS-1 `RoomConfig` grant exposes it. A legacy `live` row
// predating the column carries `live_at = null`, and the grant carries `liveAt:
// null` — the room renders the pill with no suffix (truthful, never back-filled from
// the schedule). Runs against the dev-stand Postgres + the fake IdP; skips when
// DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-1 go-live instant in the room grant (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let events: EventsService;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Seed one event directly in `state` — the 006↔007 fixture seam. */
    async function seedEvent(
      state: EventLifecycleState,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `room1la-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          slug,
          "Актуальная терапия ХСН",
          "Кардиология сегодня",
          "2026-07-17T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          state,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    async function setState(
      id: string,
      state: EventLifecycleState,
    ): Promise<void> {
      await pool.query("UPDATE events SET state = $2 WHERE id = $1", [
        id,
        state,
      ]);
    }

    async function liveAtOf(id: string): Promise<string | null> {
      const { rows } = await pool.query<{ live_at: Date | null }>(
        "SELECT live_at FROM events WHERE id = $1",
        [id],
      );
      // node-pg parses `timestamptz` to a Date; normalise to ISO so equality
      // comparisons are on the canonical instant string, not object identity.
      return rows[0].live_at ? rows[0].live_at.toISOString() : null;
    }

    async function doctorSession(email: string): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      return cookie!.value;
    }

    function cookieHeader(cookie: string): Record<string, string> {
      return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
    }

    async function register(slug: string, cookie: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
    }

    function getRoom(
      slug: string,
      headers: Record<string, string>,
    ): ReturnType<NestFastifyApplication["inject"]> {
      return app.inject({
        method: "GET",
        url: `/v1/events/${slug}/room`,
        headers,
      });
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      events = app.get(EventsService);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM presence_beats WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-1: OpenRoom (published → live) stamps live_at once, and the grant exposes it as the go-live instant", async () => {
      const { id, slug } = await seedEvent("published");
      expect(await liveAtOf(id)).toBeNull();

      // The real 007 director transition opens the room.
      const before = Date.now();
      await events.openRoom(id, null);
      const stamped = await liveAtOf(id);
      expect(stamped).not.toBeNull();
      const stampedMs = new Date(stamped!).getTime();
      // Stamped at ~now (± a generous 60 s for a slow CI box).
      expect(Math.abs(stampedMs - before)).toBeLessThan(60_000);

      const cookie = await doctorSession(uniqueEmail("live-at-doc"));
      await register(slug, cookie);
      const grant = RoomConfigSchema.parse(
        (await getRoom(slug, cookieHeader(cookie))).json(),
      );
      expect(grant.liveAt).not.toBeNull();
      // The grant's liveAt is the same instant persisted on the row.
      expect(Date.parse(grant.liveAt!)).toBe(stampedMs);
    });

    it("EARS-1: a legacy live row with no live_at yields liveAt: null in the grant — the pill renders with no suffix, never back-filled from starts_at", async () => {
      // A live event flipped directly (the seam UPDATE, as a pre-column row would
      // be) carries no live_at.
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");
      expect(await liveAtOf(id)).toBeNull();

      const cookie = await doctorSession(uniqueEmail("legacy-live-doc"));
      await register(slug, cookie);
      const grant = RoomConfigSchema.parse(
        (await getRoom(slug, cookieHeader(cookie))).json(),
      );
      expect(grant.liveAt).toBeNull();
    });

    it("EARS-1: closing then the closed-set guard forbids re-live — live_at is set once and never overwritten", async () => {
      const { id } = await seedEvent("published");
      await events.openRoom(id, null);
      const first = await liveAtOf(id);
      expect(first).not.toBeNull();

      // Close the room; the lifecycle map forbids re-entering `live` from `ended`,
      // so there is no second go-live — the original instant stands.
      await events.closeRoom(id, null);
      expect(await liveAtOf(id)).toBe(first);
    });
  },
);
