import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DoctorEventsFeedSchema,
  DoctorEventsMonthGridSchema,
  EventsLiveReadSchema,
  IDEMPOTENCY_KEY_HEADER,
  MonthlyEventCountsSchema,
  doctorEventsFeedDayOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 019 EARS-3 (#2885) — the four doctor events reads (feed, month, month counts,
 * «Идёт сейчас») target a SIGNED-IN doctor on the specialty their profile holds.
 *
 * Feature 017 moves a doctor's specialty onto the profile and clears the guest
 * cookie (`/v1/me/specialty`), so a read that consulted only the cookie handed a
 * signed-in doctor the untargeted feed under «События по вашей специальности и
 * смежным». The fixture puts one upcoming and one running эфир on each of two
 * specialties' directions: a read targeted on `own` reaches only `own`'s pair,
 * and the untargeted read reaches both.
 */
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "019 EARS-3 doctor events reads for a signed-in doctor (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];

    const createdEmails: string[] = [];
    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const eventIds: string[] = [];
    const eventDirectionIds: string[] = [];

    let ownId = "";
    let otherId = "";
    let ownDirection = "";
    let otherDirection = "";
    let ownUpcoming = "";
    let otherUpcoming = "";
    let ownLive = "";
    let otherLive = "";
    let month = "";
    /** A doctor whose profile holds `own`. */
    let profileSession = "";

    const makeDirection = async (title: string): Promise<string> => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `signed-${randomUUID()}`, `${title} ${randomUUID().slice(0, 8)}`],
      );
      directionIds.push(id);
      return id;
    };

    const linkSpecialty = async (directionId: string, specialtyId: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_specialties (id, direction_id, specialty_minzdrav_id, status) VALUES ($1, $2, $3, 'active')",
        [id, directionId, specialtyId],
      );
      linkIds.push(id);
    };

    const makeEvent = async (input: {
      title: string;
      startsAt: Date;
      durationMin: number;
      directionId: string;
    }): Promise<string> => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience) VALUES ($1, $2, $3, $4, $5, $6, 'published', ${eventClassificationSql("doctors")})`,
        [
          id,
          `signed-${id.slice(0, 8)}`,
          input.title,
          "Школа",
          input.startsAt.toISOString(),
          input.durationMin,
        ],
      );
      eventIds.push(id);
      const linkId = randomUUID();
      await pool.query(
        "INSERT INTO event_directions (id, event_id, direction_id, status) VALUES ($1, $2, $3, 'active')",
        [linkId, id, input.directionId],
      );
      eventDirectionIds.push(linkId);
      return id;
    };

    const doctorSession = async (prefix: string): Promise<string> => {
      const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      return signIn(app, email, password, { device, client: "doctor" });
    };

    type Viewer = { session?: string; specialty?: string };

    const headersFor = (viewer: Viewer): Record<string, string> => {
      const jar: string[] = [];
      if (viewer.specialty !== undefined) {
        jar.push(
          `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(viewer.specialty)}`,
        );
      }
      if (viewer.session !== undefined) {
        jar.push(`${SESSION_COOKIE_NAME}=${viewer.session}`);
      }
      return jar.length === 0
        ? { ...device }
        : { ...device, cookie: jar.join("; ") };
    };

    const get = async (url: string, viewer: Viewer) => {
      const response = await app.inject({
        method: "GET",
        url,
        headers: headersFor(viewer),
      });
      expect(response.statusCode).toBe(200);
      return response;
    };

    const feedIds = async (viewer: Viewer) => {
      const response = await get("/v1/storefront/doctor/events", viewer);
      const feed = DoctorEventsFeedSchema.parse(response.json());
      return {
        response,
        targeting: feed.targeting,
        ids: feed.days.flatMap((day) => day.items.map((card) => card.id)),
      };
    };

    const monthIds = async (viewer: Viewer) => {
      const response = await get(
        `/v1/storefront/doctor/events/month?month=${month}`,
        viewer,
      );
      const grid = DoctorEventsMonthGridSchema.parse(response.json());
      return {
        response,
        targeting: grid.targeting,
        total: grid.days.reduce((sum, day) => sum + day.count, 0),
      };
    };

    const monthCount = async (viewer: Viewer) => {
      const response = await get(
        `/v1/storefront/doctor/events/month-counts?year=${month.slice(0, 4)}`,
        viewer,
      );
      const counts = MonthlyEventCountsSchema.parse(response.json());
      return {
        response,
        count: counts[Number(month.slice(5)) - 1]!.count,
      };
    };

    const liveIds = async (viewer: Viewer) => {
      const response = await get("/v1/storefront/doctor/events/live", viewer);
      return {
        response,
        ids: EventsLiveReadSchema.parse(response.json()).map(
          (strip) => strip.eventId,
        ),
      };
    };

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      const specialties = await pool.query<{ id: string }>(
        "SELECT id FROM specialties_minzdrav WHERE is_other = false ORDER BY code DESC LIMIT 2",
      );
      ownId = specialties.rows[0]!.id;
      otherId = specialties.rows[1]!.id;
      ownDirection = await makeDirection("Своё направление");
      otherDirection = await makeDirection("Чужое направление");
      await linkSpecialty(ownDirection, ownId);
      await linkSpecialty(otherDirection, otherId);

      // The running эфиры started 30 minutes ago; the upcoming ones start in an
      // hour, so all four sit in today's МСК month unless the clock is within an
      // hour of a month boundary — the month is read off the upcoming event.
      const soon = new Date(Date.now() + 60 * 60_000);
      month = doctorEventsFeedDayOf(soon).slice(0, 7);
      const started = new Date(Date.now() - 30 * 60_000);
      ownUpcoming = await makeEvent({
        title: "Своё предстоящее",
        startsAt: soon,
        durationMin: 60,
        directionId: ownDirection,
      });
      otherUpcoming = await makeEvent({
        title: "Чужое предстоящее",
        startsAt: soon,
        durationMin: 60,
        directionId: otherDirection,
      });
      ownLive = await makeEvent({
        title: "Своё идущее",
        startsAt: started,
        durationMin: 180,
        directionId: ownDirection,
      });
      otherLive = await makeEvent({
        title: "Чужое идущее",
        startsAt: started,
        durationMin: 180,
        directionId: otherDirection,
      });
      await pool.query(
        "UPDATE events SET state = 'live' WHERE id = ANY($1::uuid[])",
        [[ownLive, otherLive]],
      );

      // The doctor sets the profile specialty the way the storefront does —
      // `PUT /v1/me/specialty` — which also clears any guest cookie (017).
      profileSession = await doctorSession("signed-in-profile");
      const chosen = await app.inject({
        method: "PUT",
        url: "/v1/me/specialty",
        headers: {
          ...headersFor({ session: profileSession }),
          [IDEMPOTENCY_KEY_HEADER]: randomUUID(),
        },
        payload: { specialty: ownId },
      });
      expect(chosen.statusCode).toBe(200);
    }, 120_000);

    afterAll(async () => {
      for (const id of eventDirectionIds) {
        await pool.query("DELETE FROM event_directions WHERE id = $1", [id]);
      }
      for (const id of eventIds) await deleteEventFixture(pool, id);
      for (const id of linkIds) {
        await pool.query("DELETE FROM direction_specialties WHERE id = $1", [
          id,
        ]);
      }
      for (const email of createdEmails) {
        // The profile link row `PUT /v1/me/specialty` wrote outlives the user
        // cascade, so it goes first.
        await pool.query(
          "DELETE FROM doctor_specialties WHERE doctor_id IN (SELECT id FROM users WHERE email = $1)",
          [email],
        );
        await deleteUserFixture(pool, "email", email);
      }
      for (const id of directionIds) {
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      }
      await app.close();
    });

    it("019 EARS-3: the feed targets a signed-in doctor on the profile specialty with no cookie", async () => {
      const { targeting, ids } = await feedIds({ session: profileSession });
      expect(targeting.mode).toBe("targeted");
      expect(targeting.specialtyReference).toBe(ownId);
      expect(targeting.directionIds).toEqual([ownDirection]);
      expect(ids).toContain(ownUpcoming);
      expect(ids).not.toContain(otherUpcoming);
    });

    it("019 EARS-3: the profile wins over a stale cookie of another specialty on the feed", async () => {
      const { targeting, ids } = await feedIds({
        session: profileSession,
        specialty: otherId,
      });
      expect(targeting.specialtyReference).toBe(ownId);
      expect(ids).toContain(ownUpcoming);
      expect(ids).not.toContain(otherUpcoming);
    });

    it("019 EARS-3: a guest's feed follows the cookie, and without it is untargeted", async () => {
      const guest = await feedIds({ specialty: otherId });
      expect(guest.targeting.specialtyReference).toBe(otherId);
      expect(guest.ids).toContain(otherUpcoming);
      expect(guest.ids).not.toContain(ownUpcoming);

      const anonymous = await feedIds({});
      expect(anonymous.targeting.mode).toBe("all");
      expect(anonymous.targeting.specialtyReference).toBeNull();
      expect(anonymous.ids).toEqual(
        expect.arrayContaining([ownUpcoming, otherUpcoming]),
      );
    });

    it("019 EARS-3: the month grid targets a signed-in doctor on the profile, a stale cookie notwithstanding", async () => {
      const ownGuest = await monthIds({ specialty: ownId });
      for (const viewer of [
        { session: profileSession },
        { session: profileSession, specialty: otherId },
      ]) {
        const read = await monthIds(viewer);
        expect(read.targeting.specialtyReference).toBe(ownId);
        expect(read.targeting.directionIds).toEqual([ownDirection]);
        expect(read.total).toBe(ownGuest.total);
      }
      const anonymous = await monthIds({});
      expect(anonymous.targeting.mode).toBe("all");
      expect(anonymous.total).toBeGreaterThan(ownGuest.total);
    });

    it("019 EARS-3: the month counts target a signed-in doctor on the profile, a stale cookie notwithstanding", async () => {
      const ownGuest = await monthCount({ specialty: ownId });
      const otherGuest = await monthCount({ specialty: otherId });
      const anonymous = await monthCount({});
      expect(anonymous.count).toBeGreaterThan(ownGuest.count);
      for (const viewer of [
        { session: profileSession },
        { session: profileSession, specialty: otherId },
      ]) {
        expect((await monthCount(viewer)).count).toBe(ownGuest.count);
      }
      expect(otherGuest.count).toBeGreaterThan(0);
    });

    it("019 EARS-3: «Идёт сейчас» targets a signed-in doctor on the profile, a stale cookie notwithstanding", async () => {
      for (const viewer of [
        { session: profileSession },
        { session: profileSession, specialty: otherId },
      ]) {
        const { ids } = await liveIds(viewer);
        expect(ids).toContain(ownLive);
        expect(ids).not.toContain(otherLive);
      }
      const guest = await liveIds({ specialty: otherId });
      expect(guest.ids).toContain(otherLive);
      expect(guest.ids).not.toContain(ownLive);
      const anonymous = await liveIds({});
      expect(anonymous.ids).toEqual(
        expect.arrayContaining([ownLive, otherLive]),
      );
    });

    it("019 EARS-3: a read that varies by session is never shared-cacheable", async () => {
      for (const read of [
        (await feedIds({ session: profileSession })).response,
        (await monthIds({ session: profileSession })).response,
        (await monthCount({ session: profileSession })).response,
      ]) {
        expect(read.headers["cache-control"]).toBe("private, max-age=30");
        // The session rides in `__Host-ds_session`, so `Vary: Cookie` keys the
        // browser cache on the session as well as on the guest specialty.
        expect(read.headers.vary).toMatch(/\bCookie\b/i);
      }
      const live = (await liveIds({ session: profileSession })).response;
      expect(live.headers["cache-control"]).toBe("private, no-store");
    });
  },
);
