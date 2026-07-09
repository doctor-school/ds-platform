import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import {
  EventPresenceSchema,
  PostChatMessageAckSchema,
  PresenceHeartbeatAckSchema,
  type EventLifecycleState,
} from "@ds/schemas";
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

// 006 EARS-7 — room-close stops heartbeat + chat capture.
//
// When the event leaves `live` (the director closes the room, feature 007), the
// system STOPS accepting heartbeats and chat posts for that event — a late beat
// or post is refused SERVER-SIDE — and the room degrades to the truthful ended
// state; per-doctor presence minutes are computed over the beats captured WHILE
// the room was open (the open window).
//
// The refusal is the SAME server-side admission gate as EARS-1 (authenticated ∧
// registered ∧ live): once the event's `EventLifecycleState` leaves `live` the
// `live` condition fails and every room operation — the `RoomConfig` grant read,
// the gated heartbeat, the gated chat post — is refused with a 409 carrying the
// truthful `state`. This handler adds no new code path; it PINS the close
// semantics as one coherent story: the SAME doctor in the SAME room is admitted
// while the room is open and refused the instant it closes, no beat/post lands
// after close, and the derived sponsor minutes reflect exactly the open window.
//
// Registration is exercised through the REAL 005 command so the gate reads the
// actual durable roster; the 007 room-close signal is the seeded event
// transitioning live → ended with a scoped UPDATE (the 006↔007 tracked seam →
// parent #576; "done against the real dependency" = close driven by 007 director
// controls). Beats are asserted by counting the durable `presence_beats` rows
// directly (the durable record, not a client echo) and the sponsor minutes by
// the real EARS-5 derivation. Runs against dev-stand Postgres + the fake IdP;
// skips when DATABASE_URL / IDP_ISSUER is absent so the shared CI unit job stays
// green (requirements Verification, row 7).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-7 room-close stops heartbeat + chat capture (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let derivation: PresenceDerivationService;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    // The gated chat post publishes to Centrifugo only AFTER admission; the
    // close-refusal legs never reach the publish (the gate refuses first), so
    // they run without Centrifugo. The "accepted while open" chat leg needs a
    // reachable Centrifugo — it is gated on this being present.
    const chatConfigured = Boolean(process.env.CENTRIFUGO_URL);
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
      const slug = `room7-${id.slice(0, 8)}`;
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

    /** Simulate the 007 director closing the room (scoped lifecycle UPDATE). */
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
     * record EARS-4 writes, here with a controlled instant so the open-window
     * bucket math is deterministic.
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

    function postChat(
      slug: string,
      headers: Record<string, string>,
      payload: unknown,
    ): ReturnType<NestFastifyApplication["inject"]> {
      return app.inject({
        method: "POST",
        url: `/v1/events/${slug}/chat`,
        headers,
        payload,
      });
    }

    /**
     * Seed a published event, register the doctor, open the room (→ live), and
     * return the ids + the doctor's session + domain user id.
     */
    async function liveRoom(prefix: string): Promise<{
      id: string;
      slug: string;
      cookie: string;
      userId: string;
    }> {
      const { id, slug } = await seedEvent("published");
      const email = uniqueEmail(prefix);
      const cookie = await doctorSession(email);
      await register(slug, cookie);
      await setState(id, "live");
      const userId = await userIdForEmail(email);
      return { id, slug, cookie, userId };
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

    it("EARS-7.1: when the event leaves `live` (the director closes the room), the system shall stop accepting heartbeats — a beat accepted while open is refused server-side (409) once closed, and no beat lands after close", async () => {
      const { id, slug, cookie } = await liveRoom("doc-close-beat");

      // While the room is OPEN the SAME gated doctor's beat is accepted (200) and
      // one durable row is appended — capture is running.
      const openBeat = await postHeartbeat(slug, cookieHeader(cookie));
      expect(openBeat.statusCode).toBe(200);
      expect(PresenceHeartbeatAckSchema.parse(openBeat.json()).eventId).toBe(id);
      expect(await beatCount(id)).toBe(1);

      // The director closes the room — the event leaves `live` (→ ended).
      await setState(id, "ended");

      // A late heartbeat from the SAME doctor in the SAME room is now refused
      // SERVER-SIDE with the truthful `ended` state, and NO beat is appended —
      // capture stopped the instant the room closed.
      const lateBeat = await postHeartbeat(slug, cookieHeader(cookie));
      expect(lateBeat.statusCode).toBe(409);
      expect(lateBeat.json()).toMatchObject({ state: "ended" });
      expect(lateBeat.body).not.toContain("beatAt");
      expect(await beatCount(id)).toBe(1);
    });

    it("EARS-7.2: when the event leaves `live`, the system shall stop accepting chat posts — a late post is refused server-side (409) with the truthful ended state", async () => {
      const { id, slug, cookie } = await liveRoom("doc-close-chat");

      // While the room is OPEN a gated post is accepted and fans out (only when
      // Centrifugo is reachable on the stand — the publish rides the transport).
      if (chatConfigured) {
        const openPost = await postChat(slug, cookieHeader(cookie), {
          text: "Пока идёт эфир — сообщение проходит",
        });
        expect(openPost.statusCode).toBe(200);
        expect(PostChatMessageAckSchema.parse(openPost.json()).eventId).toBe(id);
      }

      // The director closes the room — the event leaves `live` (→ ended).
      await setState(id, "ended");

      // A late post is refused SERVER-SIDE before any publish (the gate refuses
      // first, so this holds even with no reachable Centrifugo), carrying the
      // truthful `ended` state — chat stops at room close.
      const latePost = await postChat(slug, cookieHeader(cookie), {
        text: "Эфир уже закрыт — это сообщение отклонено",
      });
      expect(latePost.statusCode).toBe(409);
      expect(latePost.json()).toMatchObject({ state: "ended" });
    });

    it("EARS-7.3: per-doctor presence minutes are computed over the OPEN window only — beats captured while `live` count, and a beat refused after close never exists so it cannot inflate the minutes", async () => {
      const { id, slug, cookie, userId } = await liveRoom("doc-close-window");

      // The open window: three beats captured while the room was `live`, one N=60
      // cadence apart (offsets 0 s / 60 s / 120 s → three distinct 60-second
      // buckets). These are the durable record EARS-4 wrote while open.
      await seedBeat(userId, id, at(0));
      await seedBeat(userId, id, at(60));
      await seedBeat(userId, id, at(120));
      expect(await beatCount(id)).toBe(3);

      // Minutes over the open window: three distinct buckets → 3 × 60 / 60 = 3.
      const openWindow = await derivation.deriveForEvent(id, 60);
      const before = openWindow.doctors.find((d) => d.userId === userId);
      expect(before?.minutes).toBe(3);

      // The director closes the room (→ ended). A late heartbeat is refused
      // server-side and appends NOTHING — there is no post-close beat to widen
      // the window.
      await setState(id, "ended");
      const lateBeat = await postHeartbeat(slug, cookieHeader(cookie));
      expect(lateBeat.statusCode).toBe(409);
      expect(await beatCount(id)).toBe(3);

      // The sponsor minutes are unchanged after close: they are computed over the
      // beats captured while the room was open, and the refused late beat does not
      // exist. The EventPresence export shape is the SSOT-typed read model.
      const afterClose = EventPresenceSchema.parse(
        await derivation.deriveForEvent(id, 60),
      );
      const after = afterClose.doctors.find((d) => d.userId === userId);
      expect(after?.minutes).toBe(3);
      expect(after?.minutes).toBe(before?.minutes);
    });

    it("EARS-7.4: the room degrades to the truthful ended state — after close the `RoomConfig` grant is refused server-side (409, state ended), so no watchable room is issued", async () => {
      const { id, slug, cookie } = await liveRoom("doc-close-grant");

      // While open the gate issues the grant (the room is watchable).
      const openGrant = await getRoom(slug, cookieHeader(cookie));
      expect(openGrant.statusCode).toBe(200);

      // The director closes the room — the event leaves `live` (→ ended).
      await setState(id, "ended");

      // The grant read is now refused server-side with the truthful `ended`
      // state: the portal reads this 409 as the not-live branch and degrades to
      // the truthful 004 ended lifecycle state (EARS-6), never a soft wall over a
      // watchable room.
      const closedGrant = await getRoom(slug, cookieHeader(cookie));
      expect(closedGrant.statusCode).toBe(409);
      expect(closedGrant.json()).toMatchObject({ state: "ended" });
    });
  },
);
