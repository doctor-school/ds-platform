import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DoctorEventsFeedSchema,
  EventPageViewSchema,
  type EventPageView,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// 020 EARS-3 (#1767) and owner H2 row 43 (wave-3 entry gate §4.2) — the two
// counts the public event read carries on BOTH storefront hosts.
//
// `signUps` is the social proof: `total` is the SAME colleagues' count the 019
// feed card projects as `signUpCount` (one count query, so the card and the
// page a doctor opens from it cannot disagree), partitioned against the event's
// directions by each registrant's profile specialty through 017's managed
// targeting — own directions → «same», adjacent directions → «adjacent».
// `null` — never a zero-shaped object — at zero sign-ups and while the event's
// «Скрыть число записавшихся» option is on.
//
// `viewers` is «Смотрели N коллег»: the distinct participants with a durable
// room presence beat for an ENDED event, no freshness window; `null` for any
// other state and at zero.
//
// Needs the fake IdP for a real signed-in read, so it skips without
// DATABASE_URL or IDP_ISSUER, like the participation-CTA suite.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "020 EARS-3 social proof + H2 viewers count on the public event read (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];

    const eventIds: string[] = [];
    const subs: string[] = [];
    const emails: string[] = [];
    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const edgeIds: string[] = [];

    /**
     * Three real closed-book specialties no direction owns yet — same /
     * adjacent / unrelated — so the «моя и смежные» feed of the «same» one
     * holds exactly this suite's event and its card is on the first page.
     */
    let sameSpecialty: { id: string; code: string };
    let adjacentSpecialty: { id: string; code: string };
    let unrelatedSpecialty: { id: string; code: string };
    /** The event's direction and the two directions the other specialties own. */
    let eventDirection = "";

    async function makeDirection(title: string): Promise<string> {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `proof-${randomUUID()}`, `${title} ${id.slice(0, 8)}`],
      );
      directionIds.push(id);
      return id;
    }

    async function linkSpecialty(directionId: string, specialtyId: string) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_specialties (id, direction_id, specialty_minzdrav_id, status) VALUES ($1, $2, $3, 'active')",
        [id, directionId, specialtyId],
      );
      linkIds.push(id);
    }

    async function makeEdge(from: string, to: string) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_adjacency (id, direction_id, adjacent_direction_id, kind, weight, status) VALUES ($1, $2, $3, 'related', 10, 'active')",
        [id, from, to],
      );
      edgeIds.push(id);
    }

    async function seedEvent(opts: {
      state: "published" | "live" | "ended";
      hideSignUpCount?: boolean;
    }): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `proof-${opts.state}-${id.slice(0, 8)}`;
      // Two days out keeps a `published` event inside the doctor feed's
      // upcoming horizon, so its card can be read beside the page.
      const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, state, hide_sign_up_count, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, ${eventClassificationSql("doctors")})`,
        [
          id,
          slug,
          "Ведение пациентов с ХСН",
          "Кардиология сегодня",
          startsAt.toISOString(),
          90,
          "Разбор клинических рекомендаций.",
          [],
          opts.state,
          opts.hideSignUpCount ?? false,
        ],
      );
      eventIds.push(id);
      await pool.query(
        "INSERT INTO event_directions (id, event_id, direction_id, status) VALUES ($1, $2, $3, 'active')",
        [randomUUID(), id, eventDirection],
      );
      return { id, slug };
    }

    /** One user mirror row; `specialtyId` adds its active primary specialty. */
    async function seedUser(
      role: "doctor_guest" | "platform_admin",
      specialtyId?: string,
    ): Promise<string> {
      const sub = `proof-${randomUUID()}`;
      subs.push(sub);
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (zitadel_sub, email, role) VALUES ($1, $2, $3) RETURNING id",
        [sub, `${sub}@ds.test`, role],
      );
      const userId = rows[0]!.id;
      if (specialtyId) {
        await pool.query(
          "INSERT INTO doctor_specialties (doctor_id, specialty_id) VALUES ($1, $2)",
          [userId, specialtyId],
        );
      }
      return userId;
    }

    async function register(userId: string, eventId: string) {
      await pool.query(
        "INSERT INTO registrations (user_id, event_id) VALUES ($1, $2)",
        [userId, eventId],
      );
    }

    async function beat(userId: string, eventId: string) {
      await pool.query(
        "INSERT INTO presence_beats (user_id, event_id) VALUES ($1, $2)",
        [userId, eventId],
      );
    }

    /** Register + login a fresh doctor through the real auth path. */
    async function doctorSession(): Promise<string> {
      const email = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      emails.push(email);
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

    async function readPage(url: string, session?: string) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: session
          ? { ...device, cookie: `${SESSION_COOKIE_NAME}=${session}` }
          : device,
      });
      expect(res.statusCode).toBe(200);
      return EventPageViewSchema.parse(res.json());
    }

    async function readBothHosts(slug: string): Promise<EventPageView> {
      const academy = await readPage(`/v1/public/events/${slug}`);
      const doctor = await readPage(`/v1/storefront/doctor/events/${slug}`);
      expect(doctor).toEqual(academy);
      return academy;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      const specialties = await pool.query<{ id: string; code: string }>(
        `SELECT s.id, s.code FROM specialties_minzdrav s
          WHERE s.is_other = false
            AND NOT EXISTS (SELECT 1 FROM direction_specialties ds WHERE ds.specialty_minzdrav_id = s.id)
          ORDER BY s.code LIMIT 3`,
      );
      [sameSpecialty, adjacentSpecialty, unrelatedSpecialty] =
        specialties.rows as [
          { id: string; code: string },
          { id: string; code: string },
          { id: string; code: string },
        ];

      eventDirection = await makeDirection("Кардиология");
      const neighbour = await makeDirection("Функциональная диагностика");
      const unrelated = await makeDirection("Дерматология");
      await linkSpecialty(eventDirection, sameSpecialty.id);
      await linkSpecialty(neighbour, adjacentSpecialty.id);
      await linkSpecialty(unrelated, unrelatedSpecialty.id);
      // The adjacent specialty's own direction reaches the event's direction
      // through one managed adjacency edge (017 EARS-8) — the same traversal
      // the «моя и смежные» feed scope walks.
      await makeEdge(neighbour, eventDirection);
    });

    afterEach(async () => {
      for (const id of eventIds.splice(0)) {
        await pool.query("DELETE FROM event_directions WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      for (const sub of subs.splice(0)) {
        await pool.query(
          "DELETE FROM doctor_specialties WHERE doctor_id IN (SELECT id FROM users WHERE zitadel_sub = $1)",
          [sub],
        );
        await deleteUserFixture(pool, "zitadel_sub", sub);
      }
      for (const email of emails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await pool.query("DELETE FROM direction_adjacency WHERE id = ANY($1)", [
        edgeIds,
      ]);
      await pool.query("DELETE FROM direction_specialties WHERE id = ANY($1)", [
        linkIds,
      ]);
      await pool.query("DELETE FROM directions WHERE id = ANY($1)", [
        directionIds,
      ]);
      await app.close();
    });

    it("020 EARS-3: the public event read carries SignUpProof — total equals the feed card signUpCount for the same event; same/adjacent partition", async () => {
      const { id, slug } = await seedEvent({ state: "published" });
      // Two colleagues of the event's specialty, one of an adjacent one, one
      // of an unrelated one, one with no specialty chosen yet — and a staff
      // account, which is no colleague (#2456) and counts nowhere.
      for (const specialtyId of [
        sameSpecialty.id,
        sameSpecialty.id,
        adjacentSpecialty.id,
        unrelatedSpecialty.id,
        undefined,
      ]) {
        await register(await seedUser("doctor_guest", specialtyId), id);
      }
      await register(await seedUser("platform_admin", sameSpecialty.id), id);

      const page = await readBothHosts(slug);
      expect(page.signUps).toEqual({
        total: 5,
        sameSpecialty: 2,
        adjacentSpecialties: 1,
      });

      const feed = await app.inject({
        method: "GET",
        url: "/v1/storefront/doctor/events",
        headers: {
          cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(sameSpecialty.code)}`,
        },
      });
      expect(feed.statusCode).toBe(200);
      const card = DoctorEventsFeedSchema.parse(feed.json())
        .days.flatMap((day) => day.items)
        .find((item) => item.id === id);
      expect(card).toBeDefined();
      expect(page.signUps?.total).toBe(card?.signUpCount);
    });

    it("020 EARS-3: the public event read serves `signUps: null` at zero sign-ups — absent, not zero-shaped", async () => {
      const { id, slug } = await seedEvent({ state: "published" });
      // A staff sign-up alone is still zero colleagues.
      await register(await seedUser("platform_admin", sameSpecialty.id), id);

      const page = await readBothHosts(slug);
      expect(page.signUps).toBeNull();
    });

    it("020 EARS-3: the public event read serves `signUps: null` while «Скрыть число записавшихся» is on", async () => {
      const { id, slug } = await seedEvent({
        state: "published",
        hideSignUpCount: true,
      });
      await register(await seedUser("doctor_guest", sameSpecialty.id), id);

      const page = await readBothHosts(slug);
      expect(page.signUps).toBeNull();
    });

    it("020 EARS-3: the social proof is identical for a guest and for a signed-in doctor", async () => {
      const { id, slug } = await seedEvent({ state: "published" });
      await register(await seedUser("doctor_guest", sameSpecialty.id), id);
      await register(await seedUser("doctor_guest", adjacentSpecialty.id), id);
      const session = await doctorSession();

      for (const url of [
        `/v1/public/events/${slug}`,
        `/v1/storefront/doctor/events/${slug}`,
      ]) {
        const guest = await readPage(url);
        const signedIn = await readPage(url, session);
        expect(guest.signUps).toEqual({
          total: 2,
          sameSpecialty: 1,
          adjacentSpecialties: 1,
        });
        expect(signedIn).toEqual(guest);
      }
    });

    it("020 EARS-1 (H2 row 43): the public event read carries the distinct-doctor presence count of an ended event; repeated beats of one doctor count once", async () => {
      const { id, slug } = await seedEvent({ state: "ended" });
      const first = await seedUser("doctor_guest");
      const second = await seedUser("doctor_guest", sameSpecialty.id);
      const staff = await seedUser("platform_admin");
      for (let i = 0; i < 3; i += 1) await beat(first, id);
      await beat(second, id);
      await beat(staff, id);

      const page = await readBothHosts(slug);
      expect(page.viewers).toBe(2);
    });

    it("020 EARS-1 (H2 row 43): the viewers count is `null` for a non-ended event", async () => {
      const { id, slug } = await seedEvent({ state: "live" });
      await beat(await seedUser("doctor_guest"), id);

      const page = await readBothHosts(slug);
      expect(page.viewers).toBeNull();
    });

    it("020 EARS-1 (H2 row 43): the viewers count is `null` for an ended event no doctor watched", async () => {
      const { id, slug } = await seedEvent({ state: "ended" });
      await beat(await seedUser("platform_admin"), id);

      const page = await readBothHosts(slug);
      expect(page.viewers).toBeNull();
    });
  },
);
