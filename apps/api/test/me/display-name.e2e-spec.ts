import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import {
  MyDisplayNameSchema,
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

// 006 EARS-14 + EARS-16 + EARS-17 — the self-scoped display-name write/read and
// the name's one participant-visible surface: live-chat authorship.
//
// The «Имя и фамилия» collected just-in-time at first room entry (never at
// registration) is the `users`-mirror `display_name` SSOT, written via the authed
// `PUT /v1/me/display-name` and read back only by its owner's own session
// (`GET /v1/me/display-name`). EARS-14: reject empty / whitespace-only + an
// unauthenticated caller; accept a real name and TRIM it onto the caller's own
// row. EARS-16 (self-only PROFILE exposure): a caller reads/writes ONLY their own
// name (`authenticated` / `doctor_guest` / `fast-path`); no profile-read endpoint
// returns another user's name. EARS-17 (named chat authorship, owner decision
// 2026-07-23, Option A): a chat publish payload carries the poster's OWN
// `display_name` in `authorName` when set (shown to every participant), and
// `authorName: null` (tag-only fallback) when unset — never a name fabricated
// from the email; the stable non-PII `authorTag` still rides every payload.
//
// Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
// IDP_ISSUER is absent so the shared CI unit job stays green (requirements
// Verification, rows 14 & 16). The one chat-payload assertion additionally needs
// the real Centrifugo and skips without CENTRIFUGO_URL.
const CENTRIFUGO_URL = process.env.CENTRIFUGO_URL;
const CENTRIFUGO_API_KEY = process.env.CENTRIFUGO_API_KEY;

/** The per-event room channel, keyed by event id (design §4). */
function roomChannel(eventId: string): string {
  return `room:event:${eventId}`;
}

/** Read a channel's publication history over the Centrifugo HTTP API. */
async function centrifugoHistory(channel: string): Promise<
  Array<{ data: Record<string, unknown> }>
> {
  const res = await fetch(`${CENTRIFUGO_URL}/api/history`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": CENTRIFUGO_API_KEY as string,
    },
    body: JSON.stringify({ channel, limit: 100, reverse: false }),
  });
  const body = (await res.json()) as {
    result?: { publications?: Array<{ data: Record<string, unknown> }> };
  };
  return body.result?.publications ?? [];
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-14/16 self-scoped display name (e2e)",
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
      const slug = `room14-${id.slice(0, 8)}`;
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

    function getName(
      headers: Record<string, string>,
    ): ReturnType<NestFastifyApplication["inject"]> {
      return app.inject({
        method: "GET",
        url: "/v1/me/display-name",
        headers,
      });
    }

    function putName(
      headers: Record<string, string>,
      payload: unknown,
    ): ReturnType<NestFastifyApplication["inject"]> {
      return app.inject({
        method: "PUT",
        url: "/v1/me/display-name",
        headers,
        payload,
      });
    }

    /** Read the caller's own `users.display_name` straight from Postgres. */
    async function dbDisplayName(email: string): Promise<string | null> {
      const { rows } = await pool.query<{ display_name: string | null }>(
        "SELECT display_name FROM users WHERE email = $1",
        [email],
      );
      return rows[0]?.display_name ?? null;
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

    // ---- EARS-14: write side (reject empty/whitespace/unauth; accept+trim) ----

    it("EARS-14: when a gated doctor sets an empty or whitespace-only display name, the system shall reject it with a truthful validation error (400) and write nothing", async () => {
      const email = uniqueEmail("doc-dn-reject");
      const cookie = await doctorSession(email);
      for (const bad of [
        { displayName: "" },
        { displayName: "   " },
        { displayName: "\t\n " },
        {},
      ]) {
        const res = await putName(cookieHeader(cookie), bad);
        expect(res.statusCode).toBe(400);
      }
      // Nothing was written — the mirror column stays unset (null).
      expect(await dbDisplayName(email)).toBeNull();
    });

    it("EARS-14: when an unauthenticated caller sets a display name, the system shall refuse it server-side (401) and write nothing", async () => {
      const res = await putName(device, { displayName: "Иван Петров" });
      expect(res.statusCode).toBe(401);
    });

    it("EARS-14: when a gated doctor sets a real name, the system shall trim it and write it to the caller's own users.display_name (SSOT)", async () => {
      const email = uniqueEmail("doc-dn-accept");
      const cookie = await doctorSession(email);

      const res = await putName(cookieHeader(cookie), {
        displayName: "  Иван Петров  ",
      });
      expect(res.statusCode).toBe(200);
      // The response carries the trimmed name (no leading/trailing padding).
      expect(MyDisplayNameSchema.parse(res.json()).displayName).toBe(
        "Иван Петров",
      );
      // The value landed on the caller's OWN users-mirror row, trimmed.
      expect(await dbDisplayName(email)).toBe("Иван Петров");
    });

    it("EARS-14: an over-long display name (>100 chars) is rejected (400) and writes nothing", async () => {
      const email = uniqueEmail("doc-dn-long");
      const cookie = await doctorSession(email);
      const res = await putName(cookieHeader(cookie), {
        displayName: "Я".repeat(101),
      });
      expect(res.statusCode).toBe(400);
      expect(await dbDisplayName(email)).toBeNull();
    });

    it("EARS-14: setting a display name is an idempotent overwrite — a second set replaces the first", async () => {
      const email = uniqueEmail("doc-dn-idem");
      const cookie = await doctorSession(email);
      expect(
        (await putName(cookieHeader(cookie), { displayName: "Первое Имя" }))
          .statusCode,
      ).toBe(200);
      expect(
        (await putName(cookieHeader(cookie), { displayName: "Второе Имя" }))
          .statusCode,
      ).toBe(200);
      expect(await dbDisplayName(email)).toBe("Второе Имя");
    });

    // ---- EARS-16: self-only exposure ----

    it("EARS-16: the caller's own read returns null until set, then their own saved name — never fabricated", async () => {
      const email = uniqueEmail("doc-dn-read");
      const cookie = await doctorSession(email);

      // Before the JIT prompt runs, the caller's own name is unset (null) — no
      // email-derived or placeholder-derived fabrication.
      const before = await getName(cookieHeader(cookie));
      expect(before.statusCode).toBe(200);
      expect(MyDisplayNameSchema.parse(before.json()).displayName).toBeNull();

      await putName(cookieHeader(cookie), { displayName: "Анна Смирнова" });

      const after = await getName(cookieHeader(cookie));
      expect(MyDisplayNameSchema.parse(after.json()).displayName).toBe(
        "Анна Смирнова",
      );
    });

    it("EARS-16: an unauthenticated caller cannot read a display name (401)", async () => {
      expect((await getName(device)).statusCode).toBe(401);
    });

    it("EARS-16: a caller reads ONLY their own name — one doctor's saved name is never reachable from another doctor's session", async () => {
      const aEmail = uniqueEmail("doc-dn-a");
      const bEmail = uniqueEmail("doc-dn-b");
      const aCookie = await doctorSession(aEmail);
      const bCookie = await doctorSession(bEmail);

      await putName(cookieHeader(aCookie), { displayName: "Алексей Соколов" });
      await putName(cookieHeader(bCookie), { displayName: "Борис Иванов" });

      // Each session reads strictly its OWN name — there is no endpoint that
      // takes a target user id, so B's name is not reachable from A's session
      // (and vice versa). The read is keyed on the authenticated session only.
      expect(
        MyDisplayNameSchema.parse((await getName(cookieHeader(aCookie))).json())
          .displayName,
      ).toBe("Алексей Соколов");
      expect(
        MyDisplayNameSchema.parse((await getName(cookieHeader(bCookie))).json())
          .displayName,
      ).toBe("Борис Иванов");
    });

    it.skipIf(!CENTRIFUGO_URL)(
      "EARS-17: a chat publish payload carries the poster's OWN display name in authorName when set",
      async () => {
        // A registered doctor WITH a saved display name posts to a live room; the
        // fanned-out chat payload carries that name in `authorName`, shown to every
        // participant as the message author (owner decision 2026-07-23, Option A).
        // The non-PII `authorTag` still rides the payload as the self-identity key.
        const email = uniqueEmail("doc-dn-chat");
        const displayName = "Пётр Чатов";
        const { id, slug } = await seedEvent("published");
        const cookie = await doctorSession(email);
        await register(slug, cookie);
        await setState(id, "live");
        await putName(cookieHeader(cookie), { displayName });

        const roomRes = await app.inject({
          method: "GET",
          url: `/v1/events/${slug}/room`,
          headers: cookieHeader(cookie),
        });
        const config = RoomConfigSchema.parse(roomRes.json());
        // When the stand's Centrifugo lacks a token HMAC secret the grant carries
        // `chat: null` (the truthful unavailable state) — there is no publish path
        // to inspect, so the payload assertion cannot run.
        if (!config.chat) return;
        // The selfTag stays the non-PII tag — the name rides the message, not the tag.
        expect(config.chat.selfTag).not.toContain(displayName);

        const text = "Здравствуйте, коллеги!";
        const post = await app.inject({
          method: "POST",
          url: `/v1/events/${slug}/chat`,
          headers: cookieHeader(cookie),
          payload: { text },
        });
        expect(post.statusCode).toBe(200);

        const history = await centrifugoHistory(roomChannel(id));
        expect(history).toHaveLength(1);
        const payload = history[0].data;
        // The poster's own display name authors the message.
        expect(payload.authorName).toBe(displayName);
        // The stable non-PII author tag still rides every payload.
        expect(typeof payload.authorTag).toBe("string");
        expect((payload.authorTag as string).length).toBeGreaterThan(0);
      },
    );

    it.skipIf(!CENTRIFUGO_URL)(
      "EARS-17: a poster with NO display name set carries authorName: null (tag-only fallback, never a name fabricated from email)",
      async () => {
        // A doctor who never completed the JIT prompt has a null `display_name`;
        // their chat payload carries `authorName: null` (the portal falls back to
        // the «Участник <tag>» label) — never a name fabricated from the email
        // local-part or any roster identity (EARS-8/EARS-15 spirit).
        const email = uniqueEmail("doc-dn-chat-anon");
        const { id, slug } = await seedEvent("published");
        const cookie = await doctorSession(email);
        await register(slug, cookie);
        await setState(id, "live");
        // No putName — the doctor has no display name.

        const roomRes = await app.inject({
          method: "GET",
          url: `/v1/events/${slug}/room`,
          headers: cookieHeader(cookie),
        });
        const config = RoomConfigSchema.parse(roomRes.json());
        if (!config.chat) return;

        const text = "Пока без имени, коллеги.";
        const post = await app.inject({
          method: "POST",
          url: `/v1/events/${slug}/chat`,
          headers: cookieHeader(cookie),
          payload: { text },
        });
        expect(post.statusCode).toBe(200);

        const history = await centrifugoHistory(roomChannel(id));
        expect(history).toHaveLength(1);
        const payload = history[0].data;
        expect(payload.authorName).toBeNull();
        // No fabricated name: the email local-part never leaks into the payload.
        expect(JSON.stringify(payload)).not.toContain(email.split("@")[0]);
        expect(typeof payload.authorTag).toBe("string");
      },
    );
  },
);
