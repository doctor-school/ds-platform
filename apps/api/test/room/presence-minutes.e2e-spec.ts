import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { EventPresenceSchema, type EventLifecycleState } from "@ds/schemas";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { PresenceDerivationService } from "../../src/room/presence-derivation.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 006 EARS-5 — per-doctor presence-minute derivation (parameterized over N,
// tab-coalesced).
//
// The append-only `presence_beats` rows EARS-4 captures are the durable basis for
// the sponsor's per-doctor minutes. This handler DERIVES those minutes at read
// time — never a write-time count. Two properties the design (§5) makes load
// bearing and this suite asserts:
//
//   (a) **Parameterized over N.** Minutes = (distinct N-second buckets a doctor
//       emitted a beat in) × N / 60. N is the server heartbeat cadence
//       (`ROOM_HEARTBEAT_INTERVAL_SECONDS`, default 60 s). Passing a different N
//       recomputes minutes from the SAME beats with NO code change — an
//       operator-confirmed different cadence changes CONFIG, not the derivation.
//   (b) **Concurrent tabs never inflate.** Beats from a doctor's parallel sessions
//       for the same event coalesce into ONE presence timeline: two tabs beating
//       in the same N-second bucket count as ONE bucket, not two. The derivation
//       is over DISTINCT covered time, not the raw beat count.
//
// The derivation yields a per-doctor `{ userId, eventId, minutes }` set (the
// `EventPresence` read model) sufficient for the wave-1 manual sponsor export —
// there is NO report UI and NO public endpoint (EARS-8: the presence data is
// never exposed on a public surface). Beats are seeded directly with controlled
// `beat_at` timestamps so the bucket math is deterministic; one test drives the
// REAL EARS-4 heartbeat command to prove the derivation reads what capture writes.
// Runs against dev-stand Postgres; skips when DATABASE_URL / IDP_ISSUER is absent
// so the shared CI unit job stays green (requirements Verification, row 5).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-5 per-doctor presence-minute derivation (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let derivation: PresenceDerivationService;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    // Bucket boundaries align to the largest N under test (120 s) so seeded
    // offsets land in deterministic buckets regardless of the wall clock.
    const base = new Date(Math.floor(Date.now() / 120_000) * 120_000);
    const at = (offsetSeconds: number): string =>
      new Date(base.getTime() + offsetSeconds * 1000).toISOString();

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
      const slug = `room5-${id.slice(0, 8)}`;
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

    /** Resolve the domain `users.id` the beat rows attribute to a seeded doctor. */
    async function userIdForEmail(email: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(1);
      return rows[0].id;
    }

    /**
     * Seed one raw append-only beat with an explicit `beat_at` — the durable
     * record EARS-4 writes, here with a controlled instant so the bucket math is
     * deterministic. Two beats at the SAME instant model two concurrent tabs.
     */
    async function seedBeat(
      userId: string,
      eventId: string,
      beatAtIso: string,
    ): Promise<void> {
      await pool.query(
        "INSERT INTO presence_beats (user_id, event_id, beat_at) VALUES ($1,$2,$3)",
        [userId, eventId, beatAtIso],
      );
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

    /** Seed a live event with a registered doctor; return ids + the doctor id. */
    async function liveRoomWithDoctor(prefix: string): Promise<{
      eventId: string;
      slug: string;
      cookie: string;
      userId: string;
    }> {
      const { id: eventId, slug } = await seedEvent("published");
      const email = uniqueEmail(prefix);
      const cookie = await doctorSession(email);
      await register(slug, cookie);
      await setState(eventId, "live");
      const userId = await userIdForEmail(email);
      return { eventId, slug, cookie, userId };
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
      derivation = app.get(PresenceDerivationService);
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

    it("EARS-5: the derivation computes per-doctor minutes from the beat timestamps parameterized over N — the same beats recompute to different minutes as N changes, with no code change", async () => {
      const { eventId, userId } = await liveRoomWithDoctor("doc-param");
      // Three beats one N=60 cadence apart: offsets 0 s, 60 s, 120 s.
      await seedBeat(userId, eventId, at(0));
      await seedBeat(userId, eventId, at(60));
      await seedBeat(userId, eventId, at(120));

      // N = 60 → three distinct 60-second buckets → 3 × 60 / 60 = 3 minutes.
      const n60 = await derivation.deriveForEvent(eventId, 60);
      expect(n60.intervalSeconds).toBe(60);
      const doc60 = n60.doctors.find((d) => d.userId === userId);
      expect(doc60?.minutes).toBe(3);

      // N = 120 recomputes from the SAME beats with NO code change: offsets
      // 0 s + 60 s fall in one 120-second bucket, 120 s in the next → two
      // distinct buckets → 2 × 120 / 60 = 4 minutes. Different N ⇒ different
      // minutes, proving the derivation is parameterized over N (config, not code).
      const n120 = await derivation.deriveForEvent(eventId, 120);
      expect(n120.intervalSeconds).toBe(120);
      const doc120 = n120.doctors.find((d) => d.userId === userId);
      expect(doc120?.minutes).toBe(4);
      expect(doc120?.minutes).not.toBe(doc60?.minutes);
    });

    it("EARS-5: concurrent tabs for the same doctor do not inflate minutes — parallel-session beats coalesce into one presence timeline", async () => {
      const { eventId, slug, cookie } = await liveRoomWithDoctor("doc-single");
      const singleUserId = await userIdForEmail(createdEmails[createdEmails.length - 1]);
      // One-tab doctor: three beats at 0 s / 60 s / 120 s.
      await seedBeat(singleUserId, eventId, at(0));
      await seedBeat(singleUserId, eventId, at(60));
      await seedBeat(singleUserId, eventId, at(120));

      // Two-tab doctor: SAME three instants, but each emitted TWICE (two tabs
      // beating together) → six raw beats. Registered for the same live event.
      const twoTabEmail = uniqueEmail("doc-twotab");
      const twoTabCookie = await doctorSession(twoTabEmail);
      await register(slug, twoTabCookie);
      const twoTabUserId = await userIdForEmail(twoTabEmail);
      for (const offset of [0, 60, 120]) {
        await seedBeat(twoTabUserId, eventId, at(offset));
        await seedBeat(twoTabUserId, eventId, at(offset));
      }

      const presence = await derivation.deriveForEvent(eventId, 60);
      const single = presence.doctors.find((d) => d.userId === singleUserId);
      const twoTab = presence.doctors.find((d) => d.userId === twoTabUserId);

      // The two-tab doctor's SIX raw beats coalesce to the SAME three distinct
      // buckets as the one-tab doctor's three beats → identical minutes (3), NOT
      // the six the raw count would imply. Concurrent tabs never inflate.
      expect(single?.minutes).toBe(3);
      expect(twoTab?.minutes).toBe(3);
      expect(twoTab?.minutes).toBe(single?.minutes);
      expect(twoTab?.minutes).not.toBe(6);
      // keep the unused cookie referenced (single-tab doctor stays registered)
      expect(cookie).toBeTruthy();
    });

    it("EARS-5: with no override the derivation uses the server-config cadence N (parameterized via config, default 60 s) — not a hardcoded constant", async () => {
      const { eventId, userId } = await liveRoomWithDoctor("doc-default-n");
      await seedBeat(userId, eventId, at(0));
      await seedBeat(userId, eventId, at(60));

      // No explicit N → the derivation reads ROOM_HEARTBEAT_INTERVAL_SECONDS.
      const presence = await derivation.deriveForEvent(eventId);
      expect(presence.eventId).toBe(eventId);
      expect(presence.intervalSeconds).toBe(60);
      const doc = presence.doctors.find((d) => d.userId === userId);
      // Two distinct 60-second buckets → 2 minutes at the config default.
      expect(doc?.minutes).toBe(2);
    });

    it("EARS-5: the derivation reads the REAL EARS-4 captured beats and yields a per-doctor { doctor, event, minutes } export shape sufficient for the manual sponsor report", async () => {
      const { eventId, slug, cookie, userId } =
        await liveRoomWithDoctor("doc-real");
      // Drive the REAL gated heartbeat command three times — three durable rows
      // captured within the same minute (server-stamped instants).
      for (let i = 0; i < 3; i++) {
        const res = await postHeartbeat(slug, cookieHeader(cookie));
        expect(res.statusCode).toBe(200);
      }

      const presence = await derivation.deriveForEvent(eventId);
      // The export shape is the typed EventPresence read model (SSOT-validated).
      const parsed = EventPresenceSchema.parse(presence);
      expect(parsed.eventId).toBe(eventId);
      expect(parsed.doctors).toHaveLength(1);
      const [doc] = parsed.doctors;
      // Per-doctor { doctor, event, minutes } — sufficient for the manual export.
      expect(doc.userId).toBe(userId);
      expect(doc.eventId).toBe(eventId);
      // Three real beats in the same minute coalesce to one 60-second bucket → 1
      // minute (concurrent/same-interval beats never inflate, even from capture).
      expect(doc.minutes).toBe(1);
    });

    it("EARS-5: an event with no captured beats derives an empty per-doctor set (no phantom minutes)", async () => {
      const { eventId } = await liveRoomWithDoctor("doc-empty");
      const presence = await derivation.deriveForEvent(eventId);
      expect(presence.eventId).toBe(eventId);
      expect(presence.doctors).toHaveLength(0);
    });

    it("EARS-5/8: the per-doctor presence derivation is never exposed on a public surface — no presence/minutes endpoint answers, and no registrant PII leaves the derivation", async () => {
      const { slug, cookie, userId } = await liveRoomWithDoctor("doc-boundary");
      // No public route surfaces the derivation: a plausible presence path is a
      // 404 even for a gated doctor (the minutes are a manual-export-only read).
      for (const path of [
        `/v1/events/${slug}/presence`,
        `/v1/events/${slug}/minutes`,
        `/v1/events/${slug}/room/presence`,
      ]) {
        const res = await app.inject({
          method: "GET",
          url: path,
          headers: cookieHeader(cookie),
        });
        expect(res.statusCode).toBe(404);
      }
      // The derivation attributes minutes by the opaque domain user id only — it
      // carries no email / phone / roster identity (EARS-8, no registrant PII).
      const { eventId } = await liveRoomWithDoctor("doc-boundary2");
      await seedBeat(userId, eventId, at(0));
      const presence = await derivation.deriveForEvent(eventId);
      const serialized = JSON.stringify(presence);
      expect(serialized).not.toContain("@ds.test");
      for (const doc of presence.doctors) {
        expect(Object.keys(doc).sort()).toEqual(["eventId", "minutes", "userId"]);
      }
    });
  },
);
