import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
 * 044 EARS-23 (with EARS-37) — the server-side per-column roster filters,
 * `GET /v1/admin/events/:idOrSlug/roster?<filter>=…`.
 *
 * Driven through the REAL route on the REAL module; the four rows are written
 * by the REAL desk intake (EARS-35). Once the intake's own confirmation letter
 * has recorded its outcome, the registration instant and that outcome are
 * pinned by SQL, because the date-range edges are Moscow midnights and the
 * fixture needs all three mail states:
 *
 *   row | ФИО           | место работы     | город     | область              | телефон as typed   | спец. | письмо | registered (MSK)
 *   A   | Жукова Анна   | ГКБ №1           | Москва    | Московская область   | +7 (900) 200-00-00 | S1    | sent   | 01.03 23:59:59
 *   B   | Ёлкина Анна   | Клиника Здоровье | казань    | Республика Татарстан | 8 (900) 000-00-00  | S2    | failed | 02.03 00:00:00
 *   C   | абрамова Анна | НИИ кардиологии  | МОСКВА    | московская область   | +7 900 100-00-00   | —     | none   | 02.03 23:59:59
 *   D   | Елкина Анна   | ГКБ №15          | Ярославль | Ярославская область  | +7 (900) 050-00-00 | S1    | sent   | 03.03 00:00:00
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 EARS-23 — the roster filters (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventId = randomUUID();
    const slug = `congress-filter-${eventId.slice(0, 8)}`;
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const run = Math.random().toString(36).slice(2, 8);
    let registrar: Record<string, string>;
    let s1 = "";
    let s2 = "";
    /** registrationId → fixture letter, so a page reads as «ABCD». */
    const letterOf = new Map<string, string>();

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function registrarHeaders(): Promise<Record<string, string>> {
      const email = uniqueEmail("filter-registrar");
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
        workplace: string;
        city: string;
        region: string;
        contactPhone: string;
        specialtyId: string;
        mail: "sent" | "failed" | null;
        registeredAt: string;
      },
    ): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${slug}/registrations`,
        headers: registrar,
        payload: {
          surname: row.surname,
          firstName: "Анна",
          // A per-row, per-run marker the email filter can name.
          email: uniqueEmail(`flt${run}-${letter.toLowerCase()}`),
          specialtyId: row.specialtyId,
          workplace: row.workplace,
          city: row.city,
          region: row.region,
          contactPhone: row.contactPhone,
          paperConsent: true,
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const id = CongressDeskRegistrationResponseSchema.parse(
        res.json(),
      ).registrationId;
      letterOf.set(id, letter);
      // The confirmation letter goes out AFTER the response and writes its own
      // outcome; wait for it (bounded) so the pin below is not overwritten.
      await vi.waitFor(
        async () => {
          const { rows: out } = await pool.query<{ s: string | null }>(
            "SELECT confirmation_mail_status AS s FROM registrations WHERE id = $1",
            [id],
          );
          expect(out[0]?.s).not.toBeNull();
        },
        { timeout: 10_000, interval: 50 },
      );
      await pool.query(
        `UPDATE registrations
            SET registered_at = $2::timestamptz,
                confirmation_mail_status = $3::confirmation_mail_status
          WHERE id = $1`,
        [id, row.registeredAt, row.mail],
      );
    }

    async function rosterRaw(query: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/events/${slug}/roster?${query}`,
        headers: registrar,
      });
    }

    /** The page for `query`, read as the fixture letters in row order. */
    async function rows(query: string): Promise<string> {
      const res = await rosterRaw(query);
      expect(res.statusCode, `${query}: ${res.body}`).toBe(200);
      const page = CongressRosterListSchema.parse(res.json());
      return page.items.map((r) => letterOf.get(r.registrationId)).join("");
    }

    const enc = encodeURIComponent;

    beforeAll(async () => {
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

      const specialties = await pool.query<{ id: string }>(
        `SELECT id FROM specialties_minzdrav
          ORDER BY name COLLATE "ru-x-icu", id LIMIT 2`,
      );
      expect(
        specialties.rows,
        "specialties_minzdrav must be seeded (017)",
      ).toHaveLength(2);
      [s1, s2] = specialties.rows.map((r) => r.id) as [string, string];

      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline', ${eventClassificationSql()})`,
        [
          eventId,
          slug,
          "Конгресс фильтров",
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

      await deskEntry("A", {
        surname: "Жукова",
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Московская область",
        contactPhone: "+7 (900) 200-00-00",
        specialtyId: s1,
        mail: "sent",
        // 1 March 23:59:59 in Moscow (UTC+3).
        registeredAt: "2027-03-01T20:59:59.000Z",
      });
      await deskEntry("B", {
        surname: "Ёлкина",
        workplace: "Клиника Здоровье",
        city: "казань",
        region: "Республика Татарстан",
        contactPhone: "8 (900) 000-00-00",
        specialtyId: s2,
        mail: "failed",
        // 2 March 00:00:00 in Moscow.
        registeredAt: "2027-03-01T21:00:00.000Z",
      });
      await deskEntry("C", {
        surname: "абрамова",
        workplace: "НИИ кардиологии",
        city: "МОСКВА",
        region: "московская область",
        contactPhone: "+7 900 100-00-00",
        // Not a row of the Minzdrav table: the specialty cell is empty.
        specialtyId: randomUUID(),
        mail: null,
        // 2 March 23:59:59 in Moscow.
        registeredAt: "2027-03-02T20:59:59.000Z",
      });
      await deskEntry("D", {
        surname: "Елкина",
        workplace: "ГКБ №15",
        city: "Ярославль",
        region: "Ярославская область",
        contactPhone: "+7 (900) 050-00-00",
        specialtyId: s1,
        mail: "sent",
        // 3 March 00:00:00 in Moscow.
        registeredAt: "2027-03-02T21:00:00.000Z",
      });
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        await deleteEventFixture(pool, eventId);
      }
      if (app) await app.close();
    });

    it("044 EARS-23.1: ФИО filters by a case-insensitive, trimmed «contains» over the displayed full name", async () => {
      expect(await rows("")).toBe("ABCD");
      expect(await rows(`name=${enc("кина")}`)).toBe("BD");
      expect(await rows(`name=${enc("  АБРАМОВА анна ")}`)).toBe("C");
      // The caller's wildcard is a literal, not a match-all.
      expect(await rows(`name=${enc("%")}`)).toBe("");
    });

    it("044 EARS-23.2: место работы — a column EARS-37 moved to the card — still filters by «contains»", async () => {
      expect(await rows(`workplace=${enc("гкб")}`)).toBe("AD");
      expect(await rows(`workplace=${enc("ГКБ №15")}`)).toBe("D");
      expect(await rows(`workplace=${enc("кардиол")}`)).toBe("C");
    });

    it("044 EARS-23.3: email — a column EARS-37 moved to the card — still filters by a case-insensitive «contains»", async () => {
      expect(await rows(`email=${enc(`FLT${run}-B`)}`)).toBe("B");
      expect(await rows(`email=${enc(`flt${run}-`)}`)).toBe("ABCD");
    });

    it("044 EARS-23.4: телефон filters by digits against the normalised number — «8 …» finds the row typed «+7 …» and vice versa", async () => {
      // B was typed «8 (900) 000-00-00»; a «+7» search finds it.
      expect(await rows(`phone=${enc("+7 900 000-00-00")}`)).toBe("B");
      // A was typed «+7 (900) 200-00-00»; an «8 …» search finds it.
      expect(await rows(`phone=${enc("8 (900) 200-00-00")}`)).toBe("A");
      // A fragment is a «contains» on the digits.
      expect(await rows(`phone=${enc("050-00")}`)).toBe("D");
      expect(await rows(`phone=${enc("900")}`)).toBe("ABCD");
      // A term with no digit at all cannot be a phone filter.
      expect((await rosterRaw(`phone=${enc("abc")}`)).statusCode).toBe(400);
    });

    it("044 EARS-23.15: телефон of a platform-origin row (no congress answer) filters and sorts by the SAME normalised number the row displays — a stored «8 …» is found by «+7 …»", async () => {
      // D becomes a platform-origin row: the answers carry no contact phone, so
      // the cell falls back to the account's own `users.phone`, stored «8 …».
      const d = [...letterOf].find(([, l]) => l === "D")?.[0];
      expect(d).toBeDefined();
      const { rows: before } = await pool.query<{
        answers: Record<string, unknown>;
        user_id: string;
        phone: string | null;
      }>(
        `SELECT r.answers, r.user_id, u.phone
           FROM registrations r JOIN users u ON u.id = r.user_id
          WHERE r.id = $1`,
        [d],
      );
      const original = before[0]!;
      await pool.query(
        `UPDATE registrations
            SET answers = answers - 'contactPhone' - 'contactPhoneNormalised'
          WHERE id = $1`,
        [d],
      );
      await pool.query("UPDATE users SET phone = $2 WHERE id = $1", [
        original.user_id,
        "8 (900) 000-00-01",
      ]);
      try {
        const res = await rosterRaw(`phone=${enc("+7 900 000-00-01")}`);
        expect(res.statusCode, res.body).toBe(200);
        const page = CongressRosterListSchema.parse(res.json());
        expect(page.items.map((r) => letterOf.get(r.registrationId))).toEqual([
          "D",
        ]);
        // …and the row it finds displays that same normalised number.
        expect(page.items[0]?.phone).toBe("+79000000001");
        // The phone sort keys the same value: 7 900 000-00-01 sits right
        // after B (7 900 000-00-00), never last as the raw «8…» digits would.
        expect(await rows("sort=phone&dir=asc")).toBe("BDCA");
      } finally {
        await pool.query("UPDATE registrations SET answers = $2 WHERE id = $1", [
          d,
          original.answers,
        ]);
        await pool.query("UPDATE users SET phone = $2 WHERE id = $1", [
          original.user_id,
          original.phone,
        ]);
      }
    });

    it("044 EARS-23.5: специальность filters by the directory id the row resolves its name from", async () => {
      expect(await rows(`specialtyId=${s1}`)).toBe("AD");
      expect(await rows(`specialtyId=${s2}`)).toBe("B");
      expect(await rows(`specialtyId=${randomUUID()}`)).toBe("");
      expect((await rosterRaw("specialtyId=nonsense")).statusCode).toBe(400);
    });

    it("044 EARS-23.6: город filters by the directory value — case-insensitive equality on the stored text, never a «contains»", async () => {
      expect(await rows(`city=${enc("Москва")}`)).toBe("AC");
      expect(await rows(`city=${enc(" москва ")}`)).toBe("AC");
      expect(await rows(`city=${enc("Моск")}`)).toBe("");
      expect(await rows(`city=${enc("Казань")}`)).toBe("B");
    });

    it("044 EARS-23.7: область filters by the directory value — case-insensitive equality on the stored text", async () => {
      expect(await rows(`region=${enc("Московская область")}`)).toBe("AC");
      expect(await rows(`region=${enc("Ярославская область")}`)).toBe("D");
      expect(await rows(`region=${enc("Московская")}`)).toBe("");
    });

    it("044 EARS-23.8: статус письма filters by sent, failed or none (no attempt)", async () => {
      expect(await rows("mailStatus=sent")).toBe("AD");
      expect(await rows("mailStatus=failed")).toBe("B");
      expect(await rows("mailStatus=none")).toBe("C");
      expect((await rosterRaw("mailStatus=pending")).statusCode).toBe(400);
    });

    it("044 EARS-23.9: дата регистрации filters by an inclusive range of Moscow calendar days", async () => {
      // 2 March in Moscow: from its first second to its last.
      expect(
        await rows("registeredFrom=2027-03-02&registeredTo=2027-03-02"),
      ).toBe("BC");
      expect(await rows("registeredFrom=2027-03-02")).toBe("BCD");
      expect(await rows("registeredTo=2027-03-01")).toBe("A");
      expect(await rows("registeredFrom=2027-03-04")).toBe("");
      for (const query of [
        "registeredFrom=2027-03-03&registeredTo=2027-03-02",
        "registeredFrom=2027-02-30",
        "registeredTo=03.03.2027",
      ]) {
        expect((await rosterRaw(query)).statusCode, query).toBe(400);
      }
    });

    it("044 EARS-23.10: the filters compose with each other, the search, the sort and the page — and the total counts the filtered set", async () => {
      expect(await rows(`city=${enc("москва")}&mailStatus=sent`)).toBe("A");
      const paged = await rosterRaw(
        `q=${enc("анна")}&specialtyId=${s1}&registeredFrom=2027-03-01&sort=fullName&dir=desc&page=2&pageSize=1`,
      );
      expect(paged.statusCode, paged.body).toBe(200);
      const page = CongressRosterListSchema.parse(paged.json());
      // Жукова (A) then Елкина (D) by ФИО descending; page 2 of size 1 is D.
      expect(page.total).toBe(2);
      expect(page.items.map((r) => letterOf.get(r.registrationId))).toEqual([
        "D",
      ]);
    });
  },
);
