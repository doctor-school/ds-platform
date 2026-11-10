import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { EventParticipationFormat } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// 020 EARS-9 / LD-5 (#3424) — `events.seats_left` is the ONE stored figure the
// event read, the participation CTA and the `RegisterForEvent` refusal share,
// and a registration that takes an offline seat counts it down atomically in
// its own transaction. Without that the column moved only when an operator
// edited it: an offline event never became «мест нет» by itself, and two
// doctors racing for the last seat both registered.
//
// Runs against the dev-stand Postgres + the fake IdP for the session; skips when
// DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "020 EARS-9 offline seats counted down by registration (e2e)",
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

    /** Seed one `published` event with the given participation facts. */
    async function seedEvent(
      format: EventParticipationFormat,
      seatsLeft: number | null,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `seats-${format}-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state, venue,
            participation_format, seats_left, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',$11,$12,$13,
                 ${eventClassificationSql()})`,
        [
          id,
          slug,
          "Актуальная терапия ХСН",
          "Кардиология сегодня",
          "2099-07-17T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          format === "online" ? null : "Москва, тестовая площадка",
          format,
          seatsLeft,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    /** Register + login a doctor_guest; return the session cookie value. */
    async function doctorSession(email: string): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      return signIn(app, email, password, { device });
    }

    async function doctorSessions(n: number): Promise<string[]> {
      const cookies: string[] = [];
      for (let i = 0; i < n; i++)
        cookies.push(await doctorSession(uniqueEmail(`seat${i}`)));
      return cookies;
    }

    function register(slug: string, cookie: string) {
      return app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
    }

    async function seatsLeft(eventId: string): Promise<number | null> {
      const { rows } = await pool.query<{ seats_left: number | null }>(
        "SELECT seats_left FROM events WHERE id = $1",
        [eventId],
      );
      return rows[0]?.seats_left ?? null;
    }

    async function registrationCount(eventId: string): Promise<number> {
      const { rows } = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1",
        [eventId],
      );
      return Number(rows[0]?.n ?? 0);
    }

    /** The guest's participation action on the event page read. */
    async function guestAction(slug: string): Promise<string> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}/participation`,
        headers: device,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { action: string }).action;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT),
      ).compile();

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
        await deleteEventFixture(pool, id);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("020 EARS-9: an offline event with N seats accepts exactly N registrations, refuses the next with 409 sold-out, and its page then says «мест нет»", async () => {
      const seats = 3;
      const { id, slug } = await seedEvent("offline", seats);
      const cookies = await doctorSessions(seats + 1);

      for (const [i, cookie] of cookies.slice(0, seats).entries()) {
        const res = await register(slug, cookie);
        expect(res.statusCode, res.body).toBe(200);
        expect(await seatsLeft(id)).toBe(seats - i - 1);
      }
      const refused = await register(slug, cookies[seats]!);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({ reason: "sold-out" });

      expect(await seatsLeft(id)).toBe(0);
      expect(await registrationCount(id)).toBe(seats);
      expect(await guestAction(slug)).toBe("sold-out");
    });

    it("020 EARS-9: concurrent registrations for the last offline seat yield exactly one success and seats_left = 0, never negative and never a 500", async () => {
      const contenders = 6;
      const { id, slug } = await seedEvent("offline", 1);
      const cookies = await doctorSessions(contenders);

      const results = await Promise.all(
        cookies.map((cookie) => register(slug, cookie)),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes, results.map((r) => r.body).join("\n")).toEqual([
        200, 409, 409, 409, 409, 409,
      ]);
      for (const r of results.filter((x) => x.statusCode === 409))
        expect(r.json()).toMatchObject({ reason: "sold-out" });

      expect(await seatsLeft(id)).toBe(0);
      expect(await registrationCount(id)).toBe(1);
    });

    it("020 EARS-9: a hybrid event counts its offline seats down while they last, then registers online taking no seat, and its page switches to online", async () => {
      const { id, slug } = await seedEvent("hybrid", 1);
      const [first, second] = await doctorSessions(2);

      const offline = await register(slug, first!);
      expect(offline.statusCode, offline.body).toBe(200);
      expect(await seatsLeft(id)).toBe(0);
      expect(await guestAction(slug)).toBe("switch-to-online");

      const online = await register(slug, second!);
      expect(online.statusCode, online.body).toBe(200);
      expect(await seatsLeft(id)).toBe(0);
      expect(await registrationCount(id)).toBe(2);
    });

    it("020 EARS-9: a repeated registration by the same doctor takes no second seat", async () => {
      const { id, slug } = await seedEvent("offline", 2);
      const [cookie] = await doctorSessions(1);

      const first = await register(slug, cookie!);
      expect(first.statusCode, first.body).toBe(200);
      const repeat = await register(slug, cookie!);
      expect(repeat.statusCode, repeat.body).toBe(200);
      expect(repeat.json()).toEqual(first.json());

      expect(await seatsLeft(id)).toBe(1);
      expect(await registrationCount(id)).toBe(1);
    });

    it("020 EARS-9: an event with no seat limit (seats_left null) is never counted down", async () => {
      const offline = await seedEvent("offline", null);
      const hybrid = await seedEvent("hybrid", null);
      const [cookie] = await doctorSessions(1);

      for (const event of [offline, hybrid]) {
        const res = await register(event.slug, cookie!);
        expect(res.statusCode, res.body).toBe(200);
        expect(await seatsLeft(event.id)).toBeNull();
        expect(await guestAction(event.slug)).toBe("register");
      }
    });

    it("020 EARS-9: an online event takes no seat even when a stray seats_left is set", async () => {
      const { id, slug } = await seedEvent("online", 1);
      const [cookie] = await doctorSessions(1);

      const res = await register(slug, cookie!);
      expect(res.statusCode, res.body).toBe(200);
      expect(await seatsLeft(id)).toBe(1);
    });
  },
);
