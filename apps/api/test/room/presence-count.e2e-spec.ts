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
import { PresenceRepository } from "../../src/room/presence.repository.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 006 EARS-5 — the LIVE room-presence count («N врачей в комнате»).
//
// The canvas header shows a live count of distinct doctors currently in the room.
// It is a read-time AGGREGATE derived over the SAME durable append-only
// `presence_beats` the sponsor minutes draw from (never a separate presence store,
// never Centrifugo presence): the count of DISTINCT users with a beat inside the
// freshness window (≈ 2 × N). Two load-bearing rules fall out of the DISTINCT +
// window: a doctor's concurrent tabs coalesce to one (no inflation — the same rule
// as the minutes), and a doctor who left the room ages out within two cadences (the
// number is who is *currently* watching, not everyone who ever beat). The count is
// an integer only — never a per-doctor identity or the roster — so it leaks no PII
// (EARS-8). It rides the EARS-1 grant (initial value) and every heartbeat ack (the
// live refresh). Runs against the dev-stand Postgres + the fake IdP; skips when
// DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-5 live room-presence count (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let presence: PresenceRepository;
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
      const slug = `room5c-${id.slice(0, 8)}`;
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

    async function heartbeat(
      slug: string,
      cookie: string,
    ): Promise<number> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/heartbeat`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
      return PresenceHeartbeatAckSchema.parse(res.json()).presenceCount;
    }

    /** Seed a published event, register the doctor, open the room (→ live). */
    async function liveRoomFor(
      prefix: string,
    ): Promise<{ id: string; slug: string; cookie: string }> {
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
      presence = app.get(PresenceRepository);
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

    it("EARS-5: the heartbeat ack carries the live presence count — the caller's own just-appended beat makes it at least 1", async () => {
      const { slug, cookie } = await liveRoomFor("presence-solo");
      const count = await heartbeat(slug, cookie);
      expect(count).toBe(1);
    });

    it("EARS-5: two distinct gated doctors present in the room count as two — the live count is distinct users within the window", async () => {
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");
      const a = await doctorSession(uniqueEmail("presence-a"));
      const b = await doctorSession(uniqueEmail("presence-b"));
      await register(slug, a);
      await register(slug, b);

      expect(await heartbeat(slug, a)).toBe(1);
      // Once both doctors have beat inside the window, both count.
      expect(await heartbeat(slug, b)).toBe(2);
      // A subsequent beat from A still sees both — the count is distinct users,
      // not a beat tally.
      expect(await heartbeat(slug, a)).toBe(2);
    });

    it("EARS-5: a doctor's concurrent tabs do not inflate the count — DISTINCT user coalesces parallel sessions to one", async () => {
      const { slug, cookie } = await liveRoomFor("presence-tabs");
      // Three beats from the SAME doctor (as three tabs would send) — the count
      // stays 1, the same non-inflation rule the minutes derivation enforces.
      expect(await heartbeat(slug, cookie)).toBe(1);
      expect(await heartbeat(slug, cookie)).toBe(1);
      expect(await heartbeat(slug, cookie)).toBe(1);
    });

    it("EARS-5: the RoomConfig grant seeds the live count — a doctor entering after another has beaten sees them present", async () => {
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");
      const a = await doctorSession(uniqueEmail("presence-seed-a"));
      const b = await doctorSession(uniqueEmail("presence-seed-b"));
      await register(slug, a);
      await register(slug, b);
      // A beats; then B reads the grant — the initial count already reflects A.
      expect(await heartbeat(slug, a)).toBe(1);
      const grant = RoomConfigSchema.parse(
        (await getRoom(slug, cookieHeader(b))).json(),
      );
      expect(grant.presenceCount).toBe(1);
    });

    it("EARS-5: a beat older than the freshness window ages out — the live count reflects who is currently watching, not everyone who ever beat", async () => {
      const { id, slug } = await seedEvent("published");
      await setState(id, "live");
      const freshEmail = uniqueEmail("presence-fresh");
      const staleEmail = uniqueEmail("presence-stale");
      const fresh = await doctorSession(freshEmail);
      const stale = await doctorSession(staleEmail);
      await register(slug, fresh);
      await register(slug, stale);
      // The fresh doctor beats now; the stale doctor's only beat is backdated an
      // hour (a scoped raw insert simulates a doctor who left long ago).
      await heartbeat(slug, fresh);
      const staleUser = (
        await pool.query<{ id: string }>(
          "SELECT id FROM users WHERE email = $1",
          [staleEmail],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO presence_beats (user_id, event_id, beat_at) VALUES ($1,$2, now() - interval '1 hour')",
        [staleUser, id],
      );
      // Window = 2 × N (N default 60 s ⇒ 120 s): the hour-old beat is excluded, so
      // only the fresh doctor counts.
      expect(await presence.countLivePresence(id, 120)).toBe(1);
    });
  },
);
