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
import { ParticipationCtaSchema } from "@ds/schemas";
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

// 020 EARS-1 / LD-2 / LD-5 (#1764) — the ONE participation-CTA policy served
// over both storefront routes.
//
// The unit spec (`src/events/participation-cta.resolver.spec.ts`) proves the
// policy itself across all six actions. What THIS spec proves is that the live
// routes actually run that policy over real lifecycle + real registration facts,
// and that both hosts run the SAME one — differing only in the `href` each
// host's own route table produces. It also pins the transport decision: the CTA
// is a per-viewer SIBLING read, `@Public()` with an optional principal, so a
// guest is told «Участвовать» instead of 401, and 004 EARS-1's guest/principal
// byte-identity on the cacheable page body stays intact.
//
// Needs the fake IdP for a real doctor session, so it skips without DATABASE_URL
// or IDP_ISSUER, like the 005 suites it borrows the session fixture shape from.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "020 EARS-1 participation CTA (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    const ACADEMY = (slug: string) => `/v1/public/events/${slug}/participation`;
    const DOCTOR = (slug: string) =>
      `/v1/storefront/doctor/events/${slug}/participation`;

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function seedEvent(opts: {
      state: "draft" | "published" | "live" | "ended" | "hidden";
      format?: "online" | "offline" | "hybrid";
      seatsLeft?: number | null;
    }): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `cta-${opts.state}-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, seats_left)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          slug,
          "Актуальная терапия ХСН",
          "Кардиология сегодня",
          "2026-07-20T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          opts.state,
          opts.format ?? "online",
          opts.seatsLeft ?? null,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    /** Register + login a doctor_guest; return the session cookie value. */
    async function doctorSession(): Promise<string> {
      const email = uniqueEmail("cta");
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

    /** Register THIS doctor for the event through feature 005's own command. */
    async function register(slug: string, cookie: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
    }

    async function cta(
      url: string,
      cookie?: string,
    ): Promise<{ action: string; label: string; href: string | null; reason: string | null }> {
      const res = await app.inject({
        method: "GET",
        url,
        headers: cookie ? cookieHeader(cookie) : device,
      });
      expect(res.statusCode).toBe(200);
      return ParticipationCtaSchema.parse(res.json());
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

    it("020 EARS-1: a guest on an upcoming event is offered registration, never a 401", async () => {
      const { slug } = await seedEvent({ state: "published" });

      const answer = await cta(ACADEMY(slug));

      expect(answer.action).toBe("register");
      expect(answer.label).toBe("Участвовать");
      expect(answer.href).toBe(`/register?returnTo=%2Fwebinars%2F${slug}`);
    });

    it("020 EARS-1: a registered doctor on an upcoming event sees the registered state", async () => {
      const { slug } = await seedEvent({ state: "published" });
      const cookie = await doctorSession();
      await register(slug, cookie);

      const answer = await cta(ACADEMY(slug), cookie);

      expect(answer.action).toBe("registered");
      expect(answer.href).toBeNull();
    });

    it("020 EARS-1: a signed-in doctor WITHOUT a registration is offered registration like a guest", async () => {
      const { slug } = await seedEvent({ state: "published" });
      const cookie = await doctorSession();

      const answer = await cta(ACADEMY(slug), cookie);

      expect(answer.action).toBe("register");
    });

    it("020 EARS-1: one doctor's registration never becomes another viewer's CTA", async () => {
      const { slug } = await seedEvent({ state: "published" });
      const registered = await doctorSession();
      await register(slug, registered);
      const other = await doctorSession();

      expect((await cta(ACADEMY(slug), registered)).action).toBe("registered");
      expect((await cta(ACADEMY(slug), other)).action).toBe("register");
      expect((await cta(ACADEMY(slug))).action).toBe("register");
    });

    it("020 EARS-1: a registered doctor on a live event is sent into the room on the Academy host", async () => {
      const { slug } = await seedEvent({ state: "published" });
      const cookie = await doctorSession();
      await register(slug, cookie);
      await pool.query(`UPDATE events SET state = 'live' WHERE slug = $1`, [
        slug,
      ]);

      const answer = await cta(ACADEMY(slug), cookie);

      expect(answer.action).toBe("enter-room");
      expect(answer.href).toBe(`/webinars/${slug}/room`);
    });

    it("020 EARS-7: a registered doctor on a live event gets enter-room with href /events/<slug>/room on the doctor host", async () => {
      const { slug } = await seedEvent({ state: "published" });
      const cookie = await doctorSession();
      await register(slug, cookie);
      await pool.query(`UPDATE events SET state = 'live' WHERE slug = $1`, [
        slug,
      ]);

      const answer = await cta(DOCTOR(slug), cookie);

      // Since #1722 the doctor storefront MOUNTS the shared room unit at
      // `/events/:slug/room`, so the same action carries this host's own target
      // instead of the `null` it carried while the route did not exist. The
      // ACTION was never host-specific — it is a fact of the event and the
      // registration; only the link is a fact of the host, which is why the two
      // storefronts differ here and nowhere else in this answer.
      expect(answer.action).toBe("enter-room");
      expect(answer.href).toBe(`/events/${slug}/room`);
    });

    it("020 EARS-1: a hybrid event whose offline seats are exhausted switches the guest to the online half", async () => {
      const { slug } = await seedEvent({
        state: "published",
        format: "hybrid",
        seatsLeft: 0,
      });

      const answer = await cta(ACADEMY(slug));

      expect(answer.action).toBe("switch-to-online");
      expect(answer.href).toBe(`/register?returnTo=%2Fwebinars%2F${slug}`);
      expect(answer.reason).toBe(
        "Очные места закончились — участвовать можно онлайн",
      );
    });

    it("020 EARS-1: a pure offline event with no seats left says so with no participation target", async () => {
      const { slug } = await seedEvent({
        state: "published",
        format: "offline",
        seatsLeft: 0,
      });

      const answer = await cta(ACADEMY(slug));

      expect(answer.action).toBe("sold-out");
      expect(answer.href).toBeNull();
    });

    it("020 EARS-1: a finished event offers no participation affordance", async () => {
      const { slug } = await seedEvent({ state: "ended" });

      const answer = await cta(ACADEMY(slug));

      expect(answer.action).toBe("unavailable");
      expect(answer.href).toBeNull();
    });

    it("020 EARS-1: both hosts resolve the SAME action for the same viewer on the same event", async () => {
      const { slug } = await seedEvent({
        state: "published",
        format: "hybrid",
        seatsLeft: 0,
      });

      const academy = await cta(ACADEMY(slug));
      const doctor = await cta(DOCTOR(slug));

      // One policy, two route tables: the action and the reason are the same
      // fact, the href is the host's own path.
      expect(doctor.action).toBe(academy.action);
      expect(doctor.reason).toBe(academy.reason);
      expect(doctor.href).toBe(`/register?returnTo=%2Fevents%2F${slug}`);
    });

    it("020 EARS-1: the participation read is never cached by a shared cache", async () => {
      const { slug } = await seedEvent({ state: "published" });

      for (const url of [ACADEMY(slug), DOCTOR(slug)]) {
        const res = await app.inject({ method: "GET", url, headers: device });
        expect(res.headers["cache-control"]).toBe("private, no-store");
      }
    });

    it("020 EARS-1: a draft event is not found on either participation route", async () => {
      const { slug } = await seedEvent({ state: "draft" });

      for (const url of [ACADEMY(slug), DOCTOR(slug)]) {
        const res = await app.inject({ method: "GET", url, headers: device });
        expect(res.statusCode).toBe(404);
      }
    });
  },
);
