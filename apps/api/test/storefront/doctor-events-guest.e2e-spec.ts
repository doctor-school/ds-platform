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
  addDoctorEventsFeedDays,
  DoctorEventsFeedSchema,
  doctorEventsFeedDayOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";

/**
 * 019 EARS-12 (#1527) — the GUEST read path, over REAL rows.
 *
 * The clause's claim is not «anonymous requests get a 200»; it is that the feed
 * is the SAME read for everyone. An anonymous doctor sees the whole targeted
 * feed — days, horizon, targeting report and every card — because 019's read
 * carries no per-viewer state at all (LD-8): there is no `myEvents`, no
 * viewer-dependent card state, and nothing on the payload that a session would
 * unlock. The gate lives one step later, at participation, which is 021's
 * registration hand-off — not here.
 *
 * That is why the proof below is written as an EQUALITY, not as a status code:
 * the body an anonymous reader receives and the body the same URL produces
 * under a garbage session cookie are identical, key for key. A per-viewer field
 * introduced upstream would break this file before it ever reached a UI.
 *
 * The `slug` assertions are the other half of EARS-12: the guest CTA mints its
 * `?resume=<slug>` return target from the card's OWN slug field, so the field
 * must be on the wire for every card rather than sliced back out of `href`.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "019 EARS-12 doctor events guest read (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const eventIds: string[] = [];
    const eventDirectionIds: string[] = [];

    let specialtyCode = "";
    let today = "";

    const at = (dayOffset: number, hour: number) =>
      new Date(
        `${addDoctorEventsFeedDays(today, dayOffset)}T${String(hour).padStart(2, "0")}:00:00+03:00`,
      );

    const makeDirection = async (title: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `guest-${randomUUID()}`, `${title} ${randomUUID().slice(0, 8)}`],
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
      directionId: string;
    }) => {
      const id = randomUUID();
      const slug = `guest-${randomUUID()}`;
      await pool.query(
        "INSERT INTO events (id, slug, title, school, starts_at, duration_min, state) VALUES ($1, $2, $3, $4, $5, 60, 'published')",
        [
          id,
          slug,
          input.title,
          "Школа 019",
          input.startsAt.toISOString(),
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

    /**
     * The feed read. `session` is the ONLY thing that varies across the cases
     * below — `undefined` is the anonymous reader, a string is a session cookie
     * the api must ignore on this public read.
     */
    const readFeed = async (input: { session?: string; path?: string } = {}) => {
      const cookies = [
        `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(specialtyCode)}`,
      ];
      if (input.session !== undefined) cookies.push(input.session);
      return app.inject({
        method: "GET",
        url: `/v1/storefront/doctor/events${input.path ?? ""}`,
        headers: { cookie: cookies.join("; ") },
      });
    };

    let seededSlugs: string[] = [];

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      today = doctorEventsFeedDayOf(new Date());

      const specialties = await pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM specialties_minzdrav WHERE is_other = false ORDER BY code LIMIT 1",
      );
      const specialty = specialties.rows[0]!;
      specialtyCode = specialty.code;

      const direction = await makeDirection("Кардиология гостевая");
      await linkSpecialty(direction, specialty.id);

      const morning = await makeEvent({
        title: "Гостевое чтение, утро",
        startsAt: at(1, 9),
        directionId: direction,
      });
      const evening = await makeEvent({
        title: "Гостевое чтение, вечер",
        startsAt: at(2, 18),
        directionId: direction,
      });
      seededSlugs = [morning.slug, evening.slug];
    }, 60_000);

    afterAll(async () => {
      for (const id of eventDirectionIds) {
        await pool.query("DELETE FROM event_directions WHERE id = $1", [id]);
      }
      for (const id of eventIds) {
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of linkIds) {
        await pool.query("DELETE FROM direction_specialties WHERE id = $1", [
          id,
        ]);
      }
      for (const id of directionIds) {
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      }
      await app?.close();
    });

    it("019 EARS-12.1: when an anonymous reader opens the feed, the system shall return the full feed — days, horizon and targeting — with no session", async () => {
      const response = await readFeed();
      expect(response.statusCode).toBe(200);

      const feed = DoctorEventsFeedSchema.parse(response.json());
      expect(feed.targeting.mode).toBe("targeted");
      // The bounded horizon (LD-2) is served in full to the anonymous reader —
      // it is not a teaser window narrowed for guests.
      expect(feed.from <= feed.to).toBe(true);
      expect(feed.to).not.toBe(feed.from);
      expect(feed.days.length).toBeGreaterThan(0);

      const cards = feed.days.flatMap((day) => day.items);
      const slugs = cards.map((card) => card.slug);
      for (const slug of seededSlugs) {
        expect(slugs, "the seeded event is readable with no session").toContain(
          slug,
        );
      }
      // The slug is on the wire as its OWN field, and `href` is minted from it —
      // so a host never re-derives an identifier by slicing a URL.
      for (const card of cards) {
        expect(card.slug.length).toBeGreaterThan(0);
        expect(card.href).toBe(`/events/${card.slug}`);
      }
    });

    it("019 EARS-12.2: the month read is fully readable with no session too", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/storefront/doctor/events/month",
        headers: {
          cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(specialtyCode)}`,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty("days");
    });

    it("019 EARS-12.3: the system shall deliver no gated payload to the anonymous reader", async () => {
      const anonymous = await readFeed();
      const body = anonymous.json();
      const feed = DoctorEventsFeedSchema.parse(body);

      // The top-level key set is EXACTLY the public contract — no `myEvents`,
      // no viewer block, nothing a session would have unlocked. The expectation
      // is DERIVED from the contract schema rather than restated as a literal
      // list, so the assertion cannot drift out of step with the SSOT: a key
      // added to `DoctorEventsFeedSchema` is admitted here the moment it is
      // declared, and a key the service emits WITHOUT declaring it is caught
      // (the strict schema above rejects it, and this set comparison names it).
      expect(Object.keys(body).sort()).toEqual(
        Object.keys(DoctorEventsFeedSchema.shape).sort(),
      );
      // `registered` is a per-viewer state; a read that carries no session can
      // never legitimately produce it.
      for (const card of feed.days.flatMap((day) => day.items)) {
        expect(card.state).not.toBe("registered");
      }

      // The SAME read under a garbage session cookie is identical: the public
      // read ignores the session entirely rather than partially honouring it.
      const withGarbageSession = await readFeed({
        session: `${SESSION_COOKIE_NAME}=not-a-real-session-token`,
      });
      expect(withGarbageSession.statusCode).toBe(200);
      expect(withGarbageSession.json()).toEqual(anonymous.json());
    });
  },
);
