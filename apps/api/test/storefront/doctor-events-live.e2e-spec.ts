import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DoctorEventsFeedSchema,
  DoctorEventsLiveReadSchema,
  doctorEventsFeedDayOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

/**
 * 019 EARS-6 (#1521) — «Идёт сейчас» over REAL rows.
 *
 * The fixture makes the two failure modes the strip exists to prevent visible:
 *
 * 1. **A global «anything live» read.** Two эфиры are live at once on two
 *    different managed directions, and a third specialty reaches neither. A
 *    read that skipped targeting would hand that third viewer a strip.
 * 2. **A second room-eligibility rule.** Three viewers see the SAME live эфир —
 *    a registered doctor, a signed-in doctor who never registered, and a guest
 *    — and only the first is sent to the room. That decision is 020's
 *    participation policy; if the strip ever grew its own, these three
 *    assertions would disagree with the event page.
 *
 * Runs against the dev-stand Postgres + the fake IdP, and skips when either is
 * absent so the shared CI unit job stays green.
 */
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "019 EARS-6 doctor events live strip (e2e)",
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

    /** The viewer's own specialty, a second one, and one that reaches no direction. */
    let ownCode = "";
    let otherCode = "";
    let unreachedCode = "";

    let liveEventId = "";
    let liveSlug = "";
    let liveStartsAt = new Date();
    let registeredSession = "";
    let unregisteredSession = "";

    const uniqueEmail = (prefix: string): string => {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    };

    const makeDirection = async (title: string): Promise<string> => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `live-${randomUUID()}`, `${title} ${randomUUID().slice(0, 8)}`],
      );
      directionIds.push(id);
      return id;
    };

    const linkSpecialty = async (
      directionId: string,
      specialtyId: string,
    ): Promise<void> => {
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
    }): Promise<{ id: string; slug: string }> => {
      const id = randomUUID();
      const slug = `live-${id.slice(0, 8)}`;
      await pool.query(
        "INSERT INTO events (id, slug, title, school, starts_at, duration_min, state) VALUES ($1, $2, $3, $4, $5, $6, 'published')",
        [
          id,
          slug,
          input.title,
          "Школа ортобиологии",
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
      return { id, slug };
    };

    const setState = async (id: string, state: string): Promise<void> => {
      await pool.query("UPDATE events SET state = $2 WHERE id = $1", [
        id,
        state,
      ]);
    };

    const doctorSession = async (email: string): Promise<string> => {
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
    };

    const headersFor = (input: {
      specialtyCode?: string;
      session?: string;
    }): Record<string, string> => {
      const jar: string[] = [];
      if (input.specialtyCode !== undefined) {
        jar.push(
          `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(input.specialtyCode)}`,
        );
      }
      if (input.session !== undefined) {
        jar.push(`${SESSION_COOKIE_NAME}=${input.session}`);
      }
      return jar.length === 0
        ? { ...device }
        : { ...device, cookie: jar.join("; ") };
    };

    const readLive = async (input: {
      specialtyCode?: string;
      session?: string;
    }) => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/storefront/doctor/events/live",
        headers: headersFor(input),
      });
      expect(response.statusCode).toBe(200);
      // The SSOT schema is `.strict()` and carries no `startsAt`, so a body that
      // leaked one — or a score — fails HERE rather than in a host.
      return DoctorEventsLiveReadSchema.parse(response.json());
    };

    const register = async (slug: string, session: string): Promise<void> => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: headersFor({ session }),
      });
      expect(res.statusCode).toBe(200);
    };

    const heartbeat = async (slug: string, session: string): Promise<void> => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/heartbeat`,
        headers: headersFor({ session }),
      });
      expect(res.statusCode).toBe(200);
    };

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

      const specialties = await pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM specialties_minzdrav WHERE is_other = false ORDER BY code LIMIT 3",
      );
      const [own, other, unreached] = specialties.rows;
      ownCode = own!.code;
      otherCode = other!.code;
      // Deliberately linked to NO direction: a viewer who reaches nothing must
      // see nothing, even while two эфиры are running elsewhere.
      unreachedCode = unreached!.code;

      const ownDirection = await makeDirection("Ортобиология");
      const otherDirection = await makeDirection("Ревматология");
      await linkSpecialty(ownDirection, own!.id);
      await linkSpecialty(otherDirection, other!.id);

      // Started 90 minutes ago and running for three hours: an эфир a doctor
      // walks in on mid-way, which is the whole reason the strip exists.
      liveStartsAt = new Date(Date.now() - 90 * 60_000);
      const live = await makeEvent({
        title: "Идущий эфир по ортобиологии",
        startsAt: liveStartsAt,
        durationMin: 180,
        directionId: ownDirection,
      });
      liveEventId = live.id;
      liveSlug = live.slug;

      const otherLive = await makeEvent({
        title: "Идущий эфир по ревматологии",
        startsAt: new Date(Date.now() - 30 * 60_000),
        durationMin: 120,
        directionId: otherDirection,
      });

      // Registration is taken while the event is still `published` — the same
      // order the room suites use — and the state is advanced afterwards.
      registeredSession = await doctorSession(uniqueEmail("live-registered"));
      const colleagueSession = await doctorSession(
        uniqueEmail("live-colleague"),
      );
      unregisteredSession = await doctorSession(uniqueEmail("live-guestish"));
      await register(liveSlug, registeredSession);
      await register(liveSlug, colleagueSession);

      await setState(liveEventId, "live");
      await setState(otherLive.id, "live");

      // Two doctors beat inside the window, so «в комнате» is 2 for anyone who
      // is not one of them and 1 for a viewer who is.
      await heartbeat(liveSlug, registeredSession);
      await heartbeat(liveSlug, colleagueSession);
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
      for (const id of directionIds) {
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      }
      for (const email of createdEmails) {
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    it("EARS-6.1: a targeted live эфир surfaces as a strip carrying its title, school and live room count", async () => {
      const strip = await readLive({ specialtyCode: ownCode });
      expect(strip).not.toBeNull();
      expect(strip!.eventId).toBe(liveEventId);
      expect(strip!.title).toBe("Идущий эфир по ортобиологии");
      expect(strip!.school).toBe("Школа ортобиологии");
      // Both beating doctors count for a viewer who is neither of them.
      expect(strip!.presenceCount).toBe(2);
      expect(strip!.viewerIsRegistered).toBe(false);
      // The эфир ends three hours after it started; nothing branches on this.
      expect(new Date(strip!.endsAt).getTime()).toBe(
        liveStartsAt.getTime() + 180 * 60_000,
      );
    });

    it("EARS-6.2: a registered doctor is sent to the room, and the count excludes themself", async () => {
      const strip = await readLive({
        specialtyCode: ownCode,
        session: registeredSession,
      });
      expect(strip).not.toBeNull();
      expect(strip!.viewerIsRegistered).toBe(true);
      expect(strip!.href).toBe(`/events/${liveSlug}/room`);
      // «N в комнате» is colleagues, and a colleague is someone other than you.
      expect(strip!.presenceCount).toBe(1);
    });

    it("EARS-6.3: a signed-in doctor who never registered is sent to the event page, never the room", async () => {
      const strip = await readLive({
        specialtyCode: ownCode,
        session: unregisteredSession,
      });
      expect(strip).not.toBeNull();
      expect(strip!.viewerIsRegistered).toBe(false);
      expect(strip!.href).toBe(`/events/${liveSlug}`);
      expect(strip!.href).not.toContain("/room");
    });

    it("EARS-6.4: a guest reads the same strip and the same count, and is sent to the event page", async () => {
      const strip = await readLive({ specialtyCode: ownCode });
      expect(strip).not.toBeNull();
      expect(strip!.href).toBe(`/events/${liveSlug}`);
      expect(strip!.presenceCount).toBe(2);
    });

    it("EARS-6.5: a viewer whose specialty reaches no direction sees null, even while two эфиры are live", async () => {
      expect(await readLive({ specialtyCode: unreachedCode })).toBeNull();
      // The targeting is per-specialty, not a global «what is live»: the second
      // specialty resolves to its OWN эфир, never the first one's.
      const otherStrip = await readLive({ specialtyCode: otherCode });
      expect(otherStrip).not.toBeNull();
      expect(otherStrip!.title).toBe("Идущий эфир по ревматологии");
    });

    it("EARS-6.7: the live эфир is ALSO present in today's day group of the feed, so the two reads agree", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/storefront/doctor/events",
        headers: headersFor({ specialtyCode: ownCode }),
      });
      expect(response.statusCode).toBe(200);
      const feed = DoctorEventsFeedSchema.parse(response.json());
      const day = feed.days.find(
        (group) => group.day === doctorEventsFeedDayOf(liveStartsAt),
      );
      expect(day?.items.map((item) => item.id)).toContain(liveEventId);
    });

    it("EARS-6.6: when the room closes the next read is null — the block clears itself rather than being hidden", async () => {
      await setState(liveEventId, "ended");
      try {
        expect(await readLive({ specialtyCode: ownCode })).toBeNull();
        expect(
          await readLive({
            specialtyCode: ownCode,
            session: registeredSession,
          }),
        ).toBeNull();
      } finally {
        await setState(liveEventId, "live");
      }
    });
  },
);
