import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import {
  PresenceHeartbeatAckSchema,
  RoomConfigSchema,
  type EventLifecycleState,
} from "@ds/schemas";
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

// 006 EARS-4 — server-authoritative heartbeat presence capture (append-only).
//
// While a gated doctor is in a live room, the client posts an authenticated
// heartbeat every N seconds (N = server config, default 60 s, delivered in
// `RoomConfig`) and the backend appends each ACCEPTED beat to a durable
// append-only Postgres table carrying `(doctor, event, instant)`. The SAME
// server-side gate as EARS-1 wraps the write: a guest (401), an unregistered
// doctor (403), and a registered doctor whose event is not `live` / already
// `ended` (409) are each refused SERVER-SIDE and append NO row — presence is
// server-authoritative and durable, never a client-trusted count and never via
// an exposed key (EARS-4, EARS-8; requirements Constraints).
//
// Registration is exercised through the REAL 005 command so the gate reads the
// actual durable roster; event lifecycle is SEEDED + flipped with a scoped UPDATE
// (the 006↔007 tracked seam → parent #576). Beats are asserted by counting the
// durable `presence_beats` rows for the `(event)` directly — the durable record,
// not a client echo. Runs against the dev-stand Postgres + the fake IdP; skips
// when DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job stays green
// (requirements Verification, row 4).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-4 server-authoritative heartbeat presence capture (e2e)",
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
      const slug = `room4-${id.slice(0, 8)}`;
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

    /** Count the durable append-only presence beats for an event. */
    async function beatCount(eventId: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM presence_beats WHERE event_id = $1",
        [eventId],
      );
      return Number(rows[0].count);
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

    function postHeartbeat(
      slug: string,
      headers: Record<string, string>,
    ): ReturnType<NestFastifyApplication["inject"]> {
      return app.inject({
        method: "POST",
        url: `/v1/events/${slug}/heartbeat`,
        headers,
      });
    }

    /** Seed a published event, register the doctor, open the room (→ live). */
    async function liveRoom(prefix: string): Promise<{
      id: string;
      slug: string;
      cookie: string;
    }> {
      const { id, slug } = await seedEvent("published");
      const cookie = await doctorSession(uniqueEmail(prefix));
      await register(slug, cookie);
      await setState(id, "live");
      return { id, slug, cookie };
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
      // presence_beats cascade-delete with their event; deleting the event is
      // enough, but be explicit so a leaked beat never bleeds across tests.
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

    it("EARS-4: when a gated doctor posts a heartbeat, the system shall append exactly one durable row (doctor, event, instant) and acknowledge it server-authoritatively", async () => {
      const { id, slug, cookie } = await liveRoom("doc-beat");
      expect(await beatCount(id)).toBe(0);

      const res = await postHeartbeat(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(200);
      const ack = PresenceHeartbeatAckSchema.parse(res.json());
      expect(ack.eventId).toBe(id);
      // The instant is server-stamped (the row's `beat_at`), never client-supplied.
      expect(Number.isNaN(Date.parse(ack.beatAt))).toBe(false);
      // Exactly one durable row was appended for this event.
      expect(await beatCount(id)).toBe(1);

      // The row carries `(doctor, event, instant)` and attributes the beat to the
      // acting doctor — the durable presence record (design §5).
      const { rows } = await pool.query<{
        user_id: string;
        event_id: string;
        beat_at: string;
      }>("SELECT user_id, event_id, beat_at FROM presence_beats WHERE event_id = $1", [
        id,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].event_id).toBe(id);
      expect(rows[0].user_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(rows[0].beat_at).not.toBeNull();
    });

    it("EARS-4: when a gated doctor posts N heartbeats over the interval, the system shall append N rows (append-only — every beat is a new immutable row, no in-place update)", async () => {
      const { id, slug, cookie } = await liveRoom("doc-append");

      for (let i = 0; i < 3; i++) {
        const res = await postHeartbeat(slug, cookieHeader(cookie));
        expect(res.statusCode).toBe(200);
      }
      // Three accepted beats → three distinct durable rows (append-only, not an
      // upsert): the raw beats are the EARS-5 derivation's input, coalesced there.
      expect(await beatCount(id)).toBe(3);
    });

    it("EARS-4: the heartbeat cadence N is delivered to the client via RoomConfig (server-side config, default 60 s)", async () => {
      const { slug, cookie } = await liveRoom("doc-cadence");
      const res = await getRoom(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(200);
      const config = RoomConfigSchema.parse(res.json());
      // N is a positive integer the client drives its post interval from; the
      // dev-stand/test default is 60 s (env ROOM_HEARTBEAT_INTERVAL_SECONDS).
      expect(Number.isInteger(config.heartbeatIntervalSeconds)).toBe(true);
      expect(config.heartbeatIntervalSeconds).toBeGreaterThan(0);
    });

    it("EARS-4/8: when a guest (no session) posts a heartbeat, the system shall refuse it server-side (401) and append no beat", async () => {
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");

      const res = await postHeartbeat(slug, device);
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain("beatAt");
      expect(await beatCount(id)).toBe(0);
    });

    it("EARS-4/8: when an authenticated but unregistered doctor posts a heartbeat, the system shall refuse it server-side (403) and append no beat", async () => {
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");
      const cookie = await doctorSession(uniqueEmail("doc-unreg-beat"));

      const res = await postHeartbeat(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(403);
      expect(await beatCount(id)).toBe(0);
    });

    it("EARS-4/8: when a registered doctor posts a heartbeat for a non-live (published) event, the system shall refuse it server-side (409) and append no beat", async () => {
      const { id, slug } = await seedEvent("published");
      const cookie = await doctorSession(uniqueEmail("doc-notlive-beat"));
      await register(slug, cookie);
      // Event stays `published` — the director has not opened the room.

      const res = await postHeartbeat(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(409);
      expect(await beatCount(id)).toBe(0);
    });

    it("EARS-4/8: when a registered doctor posts a heartbeat for an ended event, the system shall refuse it server-side (409) and append no beat — capture stops at room close", async () => {
      const { id, slug, cookie } = await liveRoom("doc-ended-beat");
      // The room was open, then the director closed it (→ ended).
      await setState(id, "ended");

      const res = await postHeartbeat(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(409);
      expect(await beatCount(id)).toBe(0);
    });

    it("EARS-4/8: when a heartbeat is posted for an unknown event, the system shall refuse it server-side (404) and append no beat", async () => {
      const cookie = await doctorSession(uniqueEmail("doc-missing-beat"));
      const res = await postHeartbeat("no-such-room-slug", cookieHeader(cookie));
      expect(res.statusCode).toBe(404);
    });
  },
);
