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
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 006 EARS-1 — the server-side room admission gate (RoomAccess grant).
//
// The room content (the `RoomConfig` grant) is served by `GET
// /v1/events/:idOrSlug/room` ONLY to a caller the backend gate admits:
// authenticated AND registered for the event (the 005 `EventRoster`, reused
// not reimplemented) AND the event `live`. A guest, an authenticated-but-
// unregistered doctor, and a registered doctor for a non-`live` event are each
// refused SERVER-SIDE (401 / 403 / 409) — no soft UI wall renders the room for
// an ungated caller, and a direct/crafted request that fails any of the three
// conditions never receives a grant (EARS-1, EARS-8).
//
// Registration is exercised through the REAL 005 command (POST
// /v1/events/:slug/registration) so the gate reads the actual durable roster,
// never a fabricated one. Event lifecycle transitions are owned by feature 007
// (tracked seam → parent #576), so this spec SEEDS events directly and flips
// state with a scoped UPDATE to simulate the 007 open/close on its own branch
// DB. Runs against the dev-stand Postgres + the fake IdP; skips when
// DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job stays green
// (requirements Verification, row 1).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-1 server-side room admission gate (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
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
      const slug = `room1-${id.slice(0, 8)}`;
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

    /** Simulate a 007 director transition on a seeded event (scoped UPDATE). */
    async function setState(
      id: string,
      state: EventLifecycleState,
    ): Promise<void> {
      await pool.query("UPDATE events SET state = $2 WHERE id = $1", [
        id,
        state,
      ]);
    }

    /** Register + login a doctor_guest; return the session cookie value. */
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

    /** Register the authenticated doctor for the event via the real 005 command. */
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
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0))
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-1.1: when an authenticated, registered doctor requests room content for a live event, the system shall serve the RoomAccess grant (RoomConfig)", async () => {
      // Seed published so registration is offered, register via the real 005
      // command, then simulate the 007 director opening the room (→ live).
      const { id, slug } = await seedEvent("published");
      const cookie = await doctorSession(uniqueEmail("doc-admit"));
      await register(slug, cookie);
      await setState(id, "live");

      const res = await getRoom(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(200);
      const config = RoomConfigSchema.parse(res.json());
      expect(config.eventId).toBe(id);
      expect(config.heartbeatIntervalSeconds).toBeGreaterThan(0);
    });

    it("EARS-1.2: when a guest (no authenticated session) requests room content, the system shall refuse it server-side (401) — no room grant", async () => {
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");

      const res = await getRoom(slug, device);
      expect(res.statusCode).toBe(401);
      // No room content leaks into the refusal body.
      expect(res.body).not.toContain("heartbeatIntervalSeconds");
    });

    it("EARS-1.3: when an authenticated but unregistered doctor requests room content for a live event, the system shall refuse it server-side (403) — no room grant", async () => {
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");
      // A logged-in doctor who never registered for this event.
      const cookie = await doctorSession(uniqueEmail("doc-unreg"));

      const res = await getRoom(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain("heartbeatIntervalSeconds");
    });

    it("EARS-1.4: when a registered doctor requests room content for a non-live (published) event, the system shall refuse it server-side (409) — the room is not open", async () => {
      const { slug } = await seedEvent("published");
      const cookie = await doctorSession(uniqueEmail("doc-notlive"));
      await register(slug, cookie);
      // Event stays `published` — the director has not opened the room.

      const res = await getRoom(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(409);
      expect(res.body).not.toContain("heartbeatIntervalSeconds");
    });

    it("EARS-1.5: when a registered doctor requests room content for an ended event, the system shall refuse it server-side (409) — the room has closed", async () => {
      const { id, slug } = await seedEvent("published");
      const cookie = await doctorSession(uniqueEmail("doc-ended"));
      await register(slug, cookie);
      // Simulate 007 opening then closing the room (→ ended).
      await setState(id, "live");
      await setState(id, "ended");

      const res = await getRoom(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(409);
    });

    it("EARS-8: the gate refuses every ungated caller server-side and never issues a grant on a crafted/direct request — a doctor is admitted only after passing all three conditions", async () => {
      const { id, slug } = await seedEvent("published");
      const cookie = await doctorSession(uniqueEmail("doc-gate"));

      // (a) Registered but not-yet-live: a direct GET is refused (409).
      await register(slug, cookie);
      expect((await getRoom(slug, cookieHeader(cookie))).statusCode).toBe(409);

      // (b) Live but the request carries a bogus session cookie (crafted): the
      //     gate authenticates against the real session store, so a forged
      //     cookie value never yields a subject → refused (401), never a grant.
      await setState(id, "live");
      const forged = cookieHeader("forged-session-id-that-does-not-exist");
      expect((await getRoom(slug, forged)).statusCode).toBe(401);

      // (c) Only the genuine, registered session on the live event is admitted.
      const admitted = await getRoom(slug, cookieHeader(cookie));
      expect(admitted.statusCode).toBe(200);
      expect(RoomConfigSchema.parse(admitted.json()).eventId).toBe(id);
    });
  },
);
