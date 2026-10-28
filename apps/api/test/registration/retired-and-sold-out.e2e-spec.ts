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
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// #2466 / #2467 — the `RegisterForEvent` command refuses the two events the
// public event page already refuses to offer:
//
// - ADR-0003 design §3.6 rule 3 (#2466): a RETIRED event (`record_status = 'retired'`,
//   `deleted_at` set) is absent from every product read, so the command answers
//   the same not-found it answers for an unknown slug and writes no row — it
//   used to resolve the retired row and record a registration (200).
// - 020 EARS-9 (+ LD-5, F-020-3 Б) (#2467): a pure offline event whose offline
//   seats are exhausted is «мест нет» with no CTA, and the automatic
//   guest-through-auth POST must not discover it «after registering»: 409 with
//   the `sold-out` reason, no row. A hybrid event with no offline seats left
//   registers the doctor (the online half), and a doctor who already holds a
//   registration keeps the idempotent registered answer.
//
// Runs against the dev-stand Postgres + the fake IdP for the session; skips when
// DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "020 EARS-9 / ADR-0003 §3.6 rule 3 registration of a sold-out or retired event (e2e)",
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
      const slug = `reg-${format}-${id.slice(0, 8)}`;
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

    async function retire(eventId: string): Promise<void> {
      await pool.query(
        `UPDATE events SET record_status = 'retired', deleted_at = now() WHERE id = $1`,
        [eventId],
      );
    }

    async function setSeatsLeft(eventId: string, seats: number): Promise<void> {
      await pool.query(`UPDATE events SET seats_left = $2 WHERE id = $1`, [
        eventId,
        seats,
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

    function register(slugOrId: string, cookie: string) {
      return app.inject({
        method: "POST",
        url: `/v1/events/${slugOrId}/registration`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
    }

    async function eventRegistrationCount(eventId: string): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1",
        [eventId],
      );
      return Number(rows[0]?.n ?? 0);
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
        await deleteEventFixture(pool, id);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("ADR-0003 §3.6 rule 3: a retired event is the not-found answer by slug and by id, and no registration is recorded", async () => {
      const { id, slug } = await seedEvent("online", null);
      await retire(id);
      const cookie = await doctorSession(uniqueEmail("doc"));

      for (const key of [slug, id]) {
        const res = await register(key, cookie);
        expect(res.statusCode, res.body).toBe(404);
      }
      expect(await eventRegistrationCount(id)).toBe(0);
    });

    it("ADR-0003 §3.6 rule 3: the registration-state read of a retired event is the not-found answer too, never registered:false", async () => {
      const { id, slug } = await seedEvent("online", null);
      await retire(id);
      const cookie = await doctorSession(uniqueEmail("doc"));

      const res = await app.inject({
        method: "GET",
        url: `/v1/events/${slug}/registration`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode, res.body).toBe(404);
    });

    it("020 EARS-9: a pure offline event with no seats left refuses the registration with 409 sold-out, and no registration is recorded", async () => {
      const { id, slug } = await seedEvent("offline", 0);
      const cookie = await doctorSession(uniqueEmail("doc"));

      const res = await register(slug, cookie);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({
        reason: "sold-out",
        state: "published",
      });
      expect(await eventRegistrationCount(id)).toBe(0);
    });

    it("020 EARS-9: a hybrid event with no offline seats left registers the doctor for the online half", async () => {
      const { id, slug } = await seedEvent("hybrid", 0);
      const cookie = await doctorSession(uniqueEmail("doc"));

      const res = await register(slug, cookie);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { registered: boolean }).registered).toBe(true);
      expect(await eventRegistrationCount(id)).toBe(1);
    });

    it("020 EARS-9: a doctor already registered before the seats ran out keeps the idempotent registered answer, and no second row appears", async () => {
      const { id, slug } = await seedEvent("offline", 1);
      const cookie = await doctorSession(uniqueEmail("doc"));

      const first = await register(slug, cookie);
      expect(first.statusCode, first.body).toBe(200);
      const { registeredAt } = first.json() as { registeredAt: string };

      await setSeatsLeft(id, 0);
      const repeat = await register(slug, cookie);
      expect(repeat.statusCode, repeat.body).toBe(200);
      expect(repeat.json()).toEqual({ registered: true, registeredAt });
      expect(await eventRegistrationCount(id)).toBe(1);
    });
  },
);
