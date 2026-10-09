import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  CongressDeskRegistrationResponseSchema,
  CongressRosterListSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { establishAdminSession } from "../setup/admin-session.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 044 EARS-22 as narrowed by EARS-37 — the server-side roster sort,
 * `GET /v1/admin/events/:idOrSlug/roster?sort=<key>&dir=<asc|desc>`.
 *
 * Driven through the REAL route on the REAL module; the four rows are written
 * by the REAL desk intake (EARS-35), and the presence marks by the REAL
 * attendance route (EARS-34). The fixture is shaped so each order is
 * DISTINCT from registration order and from every naive alternative it could
 * be confused with:
 *
 *   row | ФИО             | город       | телефон as typed      | специальность
 *   A   | Жукова Анна     | Москва      | +7 (900) 200-00-00    | S1
 *   B   | Ёлкина Анна     | казань      | 8 (900) 300-00-00     | S2
 *   C   | абрамова Анна   | Архангельск | +7 900 100-00-00      | — (unresolved)
 *   D   | Елкина Анна     | Ярославль   | +7 (900) 050-00-00    | S1
 *
 * - ФИО/город: a byte order would put the lowercase «абрамова»/«казань» and
 *   «Ё» (U+0401, before «А») out of place; the Russian collation does not.
 * - телефон: the typed text orders D, A, C, B; the normalised digits D, C, A, B.
 * - специальность: C has none, so it is last in BOTH directions; A and D tie
 *   and are kept in registration order by the tie-break.
 * - присутствие (23 April): B and D are marked present.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const DAY_1 = "2027-04-23";
const DAY_2 = "2027-04-24";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 EARS-22 — the roster sort (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventId = randomUUID();
    const slug = `congress-sort-${eventId.slice(0, 8)}`;
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    let daysBefore: string | undefined;
    let registrar: Record<string, string>;
    /** registrationId → fixture letter, so an order reads as «ABCD». */
    const letterOf = new Map<string, string>();

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function registrarHeaders(): Promise<Record<string, string>> {
      const email = uniqueEmail("sort-registrar");
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      const sub = rows[0]!.zitadel_sub;
      await fake.grantProjectRole(sub, "event-registrar");
      await pool.query(
        `INSERT INTO event_role_grants (user_id, role, event_id)
         SELECT id, 'event-registrar', $2 FROM users WHERE zitadel_sub = $1`,
        [sub, eventId],
      );
      const session = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return session.headers;
    }

    async function deskEntry(
      letter: string,
      row: {
        surname: string;
        city: string;
        contactPhone: string;
        specialtyId: string;
      },
    ): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${slug}/registrations`,
        headers: registrar,
        payload: {
          surname: row.surname,
          firstName: "Анна",
          email: uniqueEmail("sort-participant"),
          specialtyId: row.specialtyId,
          workplace: "ГКБ №1",
          city: row.city,
          region: "Регион",
          contactPhone: row.contactPhone,
          paperConsent: true,
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const id = CongressDeskRegistrationResponseSchema.parse(
        res.json(),
      ).registrationId;
      letterOf.set(id, letter);
      return id;
    }

    async function markPresent(registrationId: string, day: string) {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/admin/events/${slug}/registrations/${registrationId}/attendance/${day}`,
        headers: registrar,
        payload: { present: true },
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    async function rosterRaw(query: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/events/${slug}/roster?${query}`,
        headers: registrar,
      });
    }

    /** The page for `query`, read as the fixture letters in row order. */
    async function order(query: string): Promise<string> {
      const res = await rosterRaw(query);
      expect(res.statusCode, `${query}: ${res.body}`).toBe(200);
      const page = CongressRosterListSchema.parse(res.json());
      return page.items.map((r) => letterOf.get(r.registrationId)).join("");
    }

    beforeAll(async () => {
      daysBefore = process.env.CONGRESS_SIGNUP_EVENT_DAYS;
      process.env.CONGRESS_SIGNUP_EVENT_DAYS = `${DAY_1},${DAY_2}`;
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventId;
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = `2026-10-01.sha256-${"e".repeat(64)}`;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      // Two specialties in Russian-collation order: S1 sorts before S2.
      const specialties = await pool.query<{ id: string }>(
        `SELECT id FROM specialties_minzdrav
          ORDER BY name COLLATE "ru-x-icu", id LIMIT 2`,
      );
      expect(
        specialties.rows,
        "specialties_minzdrav must be seeded (017)",
      ).toHaveLength(2);
      const [s1, s2] = specialties.rows.map((r) => r.id) as [string, string];

      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline', ${eventClassificationSql()})`,
        [
          eventId,
          slug,
          "Конгресс сортировки",
          "Конгресс",
          "2027-04-23T09:00:00.000Z",
          480,
          "Ежегодный конгресс.",
          ["cardiology"],
          "sponsor:congress",
          null,
          "published",
        ],
      );
      registrar = await registrarHeaders();

      // Registration order is A, B, C, D (one desk entry after another).
      await deskEntry("A", {
        surname: "Жукова",
        city: "Москва",
        contactPhone: "+7 (900) 200-00-00",
        specialtyId: s1,
      });
      const b = await deskEntry("B", {
        surname: "Ёлкина",
        city: "казань",
        contactPhone: "8 (900) 300-00-00",
        specialtyId: s2,
      });
      await deskEntry("C", {
        surname: "абрамова",
        city: "Архангельск",
        contactPhone: "+7 900 100-00-00",
        // Not a row of the Minzdrav table: the specialty cell is empty.
        specialtyId: randomUUID(),
      });
      const d = await deskEntry("D", {
        surname: "Елкина",
        city: "Ярославль",
        contactPhone: "+7 (900) 050-00-00",
        specialtyId: s1,
      });
      await markPresent(b, DAY_1);
      await markPresent(d, DAY_1);
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        await deleteEventFixture(pool, eventId);
      }
      if (app) await app.close();
      if (daysBefore === undefined)
        delete process.env.CONGRESS_SIGNUP_EVENT_DAYS;
      else process.env.CONGRESS_SIGNUP_EVENT_DAYS = daysBefore;
    });

    it("044 EARS-22.2: without a sort the roster keeps registration date ascending — and sort=registeredAt&dir=asc is that same order", async () => {
      expect(await order("")).toBe("ABCD");
      expect(await order("sort=registeredAt&dir=asc")).toBe("ABCD");
      expect(await order("sort=registeredAt")).toBe("ABCD");
      expect(await order("sort=registeredAt&dir=desc")).toBe("DCBA");
    });

    it("044 EARS-22.3: ФИО sorts in Russian collation both ways — case-insensitive, Ё beside Е", async () => {
      expect(await order("sort=fullName&dir=asc")).toBe("CDBA");
      expect(await order("sort=fullName&dir=desc")).toBe("ABDC");
    });

    it("044 EARS-22.4: город sorts in Russian collation both ways", async () => {
      expect(await order("sort=city&dir=asc")).toBe("CBAD");
      expect(await order("sort=city&dir=desc")).toBe("DABC");
    });

    it("044 EARS-22.5: телефон sorts by the normalised digits, not by the text as typed", async () => {
      expect(await order("sort=phone&dir=asc")).toBe("DCAB");
      expect(await order("sort=phone&dir=desc")).toBe("BACD");
    });

    it("044 EARS-22.6: специальность sorts by its name both ways, an empty cell last in both directions, ties kept in registration order", async () => {
      expect(await order("sort=specialty&dir=asc")).toBe("ADBC");
      expect(await order("sort=specialty&dir=desc")).toBe("BADC");
    });

    it("044 EARS-37.3: присутствие sorts by the chosen day's mark — not marked first ascending, marked first descending; another day has no marks", async () => {
      expect(await order(`sort=presence&dir=asc&attendanceDay=${DAY_1}`)).toBe(
        "ACBD",
      );
      expect(await order(`sort=presence&dir=desc&attendanceDay=${DAY_1}`)).toBe(
        "BDAC",
      );
      // Nobody is marked on 24 April: the tie-break alone orders the page.
      expect(await order(`sort=presence&dir=desc&attendanceDay=${DAY_2}`)).toBe(
        "ABCD",
      );
    });

    it("044 EARS-22.7: the sort composes with the search, the presence filter and the page — and the total counts the filtered set", async () => {
      // «кина» finds Ёлкина and Елкина only.
      expect(
        await order(`q=${encodeURIComponent("кина")}&sort=fullName&dir=desc`),
      ).toBe("BD");
      const paged = await rosterRaw(
        `q=${encodeURIComponent("кина")}&sort=fullName&dir=desc&page=2&pageSize=1`,
      );
      expect(paged.statusCode).toBe(200);
      const page = CongressRosterListSchema.parse(paged.json());
      expect(page.total).toBe(2);
      expect(page.items.map((r) => letterOf.get(r.registrationId))).toEqual([
        "D",
      ]);
      expect(
        await order(
          `attendanceDay=${DAY_1}&present=unmarked&sort=city&dir=desc`,
        ),
      ).toBe("AC");
      // Paging walks the sorted order: page 2 of size 2 is the second half.
      expect(await order("sort=phone&dir=asc&page=2&pageSize=2")).toBe("AB");
    });

    it("044 EARS-37.4: an unknown or no-longer-visible sort key, an unknown direction and sort=presence without a day are refused with 400", async () => {
      for (const query of [
        "sort=email",
        "sort=workplace",
        "sort=region",
        "sort=confirmationMailStatus",
        "sort=nonsense",
        "sort=city&dir=sideways",
        "sort=presence",
        "sort=presence&dir=desc&present=marked",
      ]) {
        const res = await rosterRaw(query);
        expect(res.statusCode, query).toBe(400);
      }
    });
  },
);
