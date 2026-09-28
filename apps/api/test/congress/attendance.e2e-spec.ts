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
  CongressAttendanceResponseSchema,
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

/**
 * 044 EARS-34 / EARS-38 — V-25: the registrar marks attendance per congress
 * day, `PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day`,
 * and filters the roster by it.
 *
 * Driven through the REAL route on the REAL module. The assertions read the
 * `registration_attendance` row the route wrote and the 010 ledger rows the
 * capture trigger appended for it — the table has no author/time columns, so
 * the ledger is the ONLY answer to «who marked it, and when».
 *
 * The configured days are the runner's `CONGRESS_SIGNUP_EVENT_DAYS`
 * (`2027-04-23,2027-04-24`, `test/setup/test-env.ts`), pinned here too so the
 * suite does not depend on the order files run in.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const DAY_1 = "2027-04-23";
const DAY_2 = "2027-04-24";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 EARS-34 — attendance per congress day (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventA = randomUUID();
    const eventB = randomUUID();
    const slugA = `congress-att-a-${eventA.slice(0, 8)}`;
    const slugB = `congress-att-b-${eventB.slice(0, 8)}`;
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    let daysBefore: string | undefined;
    let registrarA: { headers: Record<string, string>; sub: string };
    let registrarB: { headers: Record<string, string>; sub: string };
    let admin: { headers: Record<string, string>; sub: string };
    /** Two registrations of event A and one of event B, entered at the desk. */
    let ivanova: string;
    let petrov: string;
    let otherEvent: string;

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function adminPrincipal(
      prefix: string,
      role: "platform_admin" | "event-registrar",
      boundTo?: string,
    ): Promise<{ headers: Record<string, string>; sub: string }> {
      const email = uniqueEmail(prefix);
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
      await fake.grantProjectRole(sub, role);
      if (boundTo) {
        await pool.query(
          `INSERT INTO event_role_grants (user_id, role, event_id)
           SELECT id, 'event-registrar', $2 FROM users WHERE zitadel_sub = $1`,
          [sub, boundTo],
        );
      }
      const session = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return { headers: session.headers, sub };
    }

    async function deskEntry(
      headers: Record<string, string>,
      event: string,
      surname: string,
    ): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${event}/registrations`,
        headers,
        payload: {
          surname,
          firstName: "Анна",
          email: uniqueEmail("att-participant"),
          specialtyId: randomUUID(),
          workplace: "ГКБ №1",
          city: "Москва",
          region: "Москва",
          contactPhone: "+7 (900) 765-43-21",
          paperConsent: true,
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      return CongressDeskRegistrationResponseSchema.parse(res.json())
        .registrationId;
    }

    async function mark(
      headers: Record<string, string>,
      event: string,
      registrationId: string,
      day: string,
      present: unknown,
    ) {
      return app.inject({
        method: "PUT",
        url: `/v1/admin/events/${event}/registrations/${registrationId}/attendance/${day}`,
        headers,
        payload: { present },
      });
    }

    async function attendanceRows(registrationId: string) {
      const { rows } = await pool.query<{ day: string; present: boolean }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, present
           FROM registration_attendance
          WHERE registration_id = $1 ORDER BY day`,
        [registrationId],
      );
      return rows;
    }

    async function ledgerRows(registrationId: string) {
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
        source: string;
        day: string;
      }>(
        `SELECT event_type, subject_id, metadata ->> 'source' AS source,
                metadata -> 'pk' ->> 'day' AS day
           FROM audit_ledger
          WHERE metadata ->> 'table' = 'registration_attendance'
            AND metadata -> 'pk' ->> 'registration_id' = $1
          ORDER BY created_at`,
        [registrationId],
      );
      return rows;
    }

    async function roster(headers: Record<string, string>, query: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/events/${slugA}/roster?${query}`,
        headers,
      });
    }

    async function insertEvent(id: string, slug: string, title: string) {
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline')`,
        [
          id,
          slug,
          title,
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
    }

    beforeAll(async () => {
      daysBefore = process.env.CONGRESS_SIGNUP_EVENT_DAYS;
      process.env.CONGRESS_SIGNUP_EVENT_DAYS = `${DAY_1},${DAY_2}`;
      // The desk entries below run the congress intake use-case, which reads
      // the whole configuration; the days are what this suite is about.
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventA;
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = `2026-10-01.sha256-${"d".repeat(64)}`;

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
      await insertEvent(eventA, slugA, "Конгресс А");
      await insertEvent(eventB, slugB, "Конгресс Б");

      registrarA = await adminPrincipal("att-registrar-a", "event-registrar", eventA);
      registrarB = await adminPrincipal("att-registrar-b", "event-registrar", eventB);
      admin = await adminPrincipal("att-admin", "platform_admin");

      ivanova = await deskEntry(registrarA.headers, slugA, "Иванова");
      petrov = await deskEntry(registrarA.headers, slugA, "Петров");
      otherEvent = await deskEntry(registrarB.headers, slugB, "Сидоров");
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        await deleteEventFixture(pool, eventA);
        await deleteEventFixture(pool, eventB);
      }
      if (app) await app.close();
      if (daysBefore === undefined) delete process.env.CONGRESS_SIGNUP_EVENT_DAYS;
      else process.env.CONGRESS_SIGNUP_EVENT_DAYS = daysBefore;
    });

    it("044 EARS-34.1: a registrar bound to the event marks 23 April — the row is present, 24 April is untouched, and the ledger names the registrar with source admin-ui", async () => {
      const res = await mark(registrarA.headers, slugA, ivanova, DAY_1, true);

      expect(res.statusCode, res.body).toBe(200);
      expect(CongressAttendanceResponseSchema.parse(res.json())).toEqual({
        registrationId: ivanova,
        day: DAY_1,
        present: true,
      });
      expect(await attendanceRows(ivanova)).toEqual([
        { day: DAY_1, present: true },
      ]);
      expect(await ledgerRows(ivanova)).toEqual([
        {
          event_type: "data.registration_attendance.insert",
          subject_id: registrarA.sub,
          source: "admin-ui",
          day: DAY_1,
        },
      ]);
    });

    it("044 EARS-34.2: the registrar clears 23 April — the row reads present=false and a second ledger row records the change", async () => {
      const res = await mark(registrarA.headers, slugA, ivanova, DAY_1, false);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({
        registrationId: ivanova,
        day: DAY_1,
        present: false,
      });
      expect(await attendanceRows(ivanova)).toEqual([
        { day: DAY_1, present: false },
      ]);
      const ledger = await ledgerRows(ivanova);
      expect(ledger).toHaveLength(2);
      expect(ledger[1]).toEqual({
        event_type: "data.registration_attendance.update",
        subject_id: registrarA.sub,
        source: "admin-ui",
        day: DAY_1,
      });
    });

    it("044 EARS-34.3: writing the value a day already holds answers 200 and appends NO ledger row", async () => {
      const before = await ledgerRows(ivanova);

      const cleared = await mark(registrarA.headers, slugA, ivanova, DAY_1, false);
      expect(cleared.statusCode, cleared.body).toBe(200);
      // A never-marked day cleared is a no-op too: no row, no ledger entry.
      const neverMarked = await mark(registrarA.headers, slugA, ivanova, DAY_2, false);
      expect(neverMarked.statusCode, neverMarked.body).toBe(200);
      expect(neverMarked.json()).toEqual({
        registrationId: ivanova,
        day: DAY_2,
        present: false,
      });

      expect(await ledgerRows(ivanova)).toEqual(before);
      expect(await attendanceRows(ivanova)).toEqual([
        { day: DAY_1, present: false },
      ]);

      // Marked twice: the second write changes nothing and records nothing.
      await mark(registrarA.headers, slugA, ivanova, DAY_2, true);
      const afterMark = await ledgerRows(ivanova);
      const again = await mark(registrarA.headers, slugA, ivanova, DAY_2, true);
      expect(again.statusCode, again.body).toBe(200);
      expect(await ledgerRows(ivanova)).toEqual(afterMark);
      expect(afterMark).toHaveLength(before.length + 1);
    });

    it("044 EARS-34.4: a day outside the configured congress days is refused with 422 CONGRESS_DAY_UNKNOWN, a non-date with 400, and nothing is written", async () => {
      const before = await attendanceRows(petrov);

      const offCalendar = await mark(registrarA.headers, slugA, petrov, "2027-05-01", true);
      expect(offCalendar.statusCode, offCalendar.body).toBe(422);
      expect(offCalendar.json()).toMatchObject({ code: "CONGRESS_DAY_UNKNOWN" });

      const notADate = await mark(registrarA.headers, slugA, petrov, "23-04-2027", true);
      expect(notADate.statusCode, notADate.body).toBe(400);

      const badBody = await mark(registrarA.headers, slugA, petrov, DAY_1, "yes");
      expect(badBody.statusCode, badBody.body).toBe(400);

      expect(await attendanceRows(petrov)).toEqual(before);
    });

    it("044 EARS-34.5: a registration of another event addressed through this event's URL is a 404, and nothing is written", async () => {
      const res = await mark(registrarA.headers, slugA, otherEvent, DAY_1, true);
      expect(res.statusCode, res.body).toBe(404);

      const unknown = await mark(registrarA.headers, slugA, randomUUID(), DAY_1, true);
      expect(unknown.statusCode, unknown.body).toBe(404);

      expect(await attendanceRows(otherEvent)).toEqual([]);
    });

    it("044 EARS-38: a registrar bound to event B is refused event A's attendance (403); the platform administrator marks any event (200)", async () => {
      const refused = await mark(registrarB.headers, slugA, petrov, DAY_1, true);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(await attendanceRows(petrov)).toEqual([]);

      const byAdmin = await mark(admin.headers, eventA, petrov, DAY_2, true);
      expect(byAdmin.statusCode, byAdmin.body).toBe(200);
      expect(await attendanceRows(petrov)).toEqual([
        { day: DAY_2, present: true },
      ]);
      expect((await ledgerRows(petrov)).at(-1)).toMatchObject({
        subject_id: admin.sub,
        source: "admin-ui",
      });
    });

    it("044 EARS-34.6: the roster filter attendanceDay + present answers marked / unmarked for that day and composes with q", async () => {
      // State now: Иванова — 23 cleared, 24 present; Петров — 24 present.
      await mark(registrarA.headers, slugA, petrov, DAY_1, true);

      const markedDay1 = await roster(
        registrarA.headers,
        `attendanceDay=${DAY_1}&present=marked`,
      );
      expect(markedDay1.statusCode, markedDay1.body).toBe(200);
      const m1 = CongressRosterListSchema.parse(markedDay1.json());
      expect(m1.items.map((r) => r.registrationId)).toEqual([petrov]);
      expect(m1.total).toBe(1);

      const unmarkedDay1 = CongressRosterListSchema.parse(
        (
          await roster(registrarA.headers, `attendanceDay=${DAY_1}&present=unmarked`)
        ).json(),
      );
      expect(unmarkedDay1.items.map((r) => r.registrationId)).toEqual([ivanova]);

      const markedDay2 = CongressRosterListSchema.parse(
        (
          await roster(registrarA.headers, `attendanceDay=${DAY_2}&present=marked`)
        ).json(),
      );
      expect(markedDay2.items.map((r) => r.registrationId).sort()).toEqual(
        [ivanova, petrov].sort(),
      );

      const composed = CongressRosterListSchema.parse(
        (
          await roster(
            registrarA.headers,
            `attendanceDay=${DAY_2}&present=marked&q=${encodeURIComponent("Петров")}`,
          )
        ).json(),
      );
      expect(composed.items.map((r) => r.registrationId)).toEqual([petrov]);
      expect(composed.total).toBe(1);
    });

    it("044 EARS-34.7: present without attendanceDay is a 400; an attendanceDay outside the congress days is a 422", async () => {
      const noDay = await roster(registrarA.headers, "present=marked");
      expect(noDay.statusCode, noDay.body).toBe(400);

      const unknownDay = await roster(
        registrarA.headers,
        "attendanceDay=2027-05-01&present=marked",
      );
      expect(unknownDay.statusCode, unknownDay.body).toBe(422);
      expect(unknownDay.json()).toMatchObject({ code: "CONGRESS_DAY_UNKNOWN" });
    });

    it("044 EARS-34.8: every roster row carries its attendance for each configured day (a missing row reads present=false) and the page carries congressDays", async () => {
      const res = await roster(registrarA.headers, "");
      expect(res.statusCode, res.body).toBe(200);
      const page = CongressRosterListSchema.parse(res.json());

      expect(page.congressDays).toEqual([DAY_1, DAY_2]);
      const byId = new Map(page.items.map((r) => [r.registrationId, r]));
      expect(byId.get(ivanova)?.attendance).toEqual([
        { day: DAY_1, present: false },
        { day: DAY_2, present: true },
      ]);
      expect(byId.get(petrov)?.attendance).toEqual([
        { day: DAY_1, present: true },
        { day: DAY_2, present: true },
      ]);
    });
  },
);
