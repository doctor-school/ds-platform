import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventClassificationSql } from "../setup/event-classification.js";
import {
  bootSpend,
  doctor,
  fund,
  postingsOfPerson,
  pulOf,
  verifyPhone,
  type SpendHarness,
} from "./spend-harness.js";

// 044 EARS-41 (#3810) — the public 044 congress intake is an
// unauthenticated door (an email is enough), so it stays OUT of the spend
// path: a priced item answers one generic refusal that depends only on the
// event, never runs `quote` or `record`, and writes no account, registration,
// posting or hold. A priced item is registered only through the authenticated
// doctor path. Over the REAL stack on the branch DB.

const CONSENT_VERSION = `2026-10-01.sha256-${"a".repeat(64)}`;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 × 044 — the congress intake is out of the spend path (e2e)",
  () => {
    let h: SpendHarness;
    const saved: Record<string, string | undefined> = {};
    const ENV = {
      CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
      CONGRESS_SIGNUP_WINDOW_OPENS_AT: "2026-01-01T00:00:00.000+03:00",
      CONGRESS_SIGNUP_WINDOW_CLOSES_AT: "2030-01-01T00:00:00.000+03:00",
      CONGRESS_SIGNUP_TIMING_FLOOR_MS: "5",
    };

    async function congressEvent(): Promise<string> {
      const id = randomUUID();
      await h.pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state, venue, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, 'Москва, тестовая площадка', ${eventClassificationSql()})`,
        [
          id,
          `pts-congress-${id.slice(0, 8)}`,
          "Конгресс с ценой",
          "Конгресс",
          new Date(Date.now() + 30 * 86_400_000).toISOString(),
          480,
          "",
          ["cardiology"],
          null,
          null,
          "published",
        ],
      );
      return id;
    }

    function submission(email: string) {
      return {
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        email,
        specialtyId: randomUUID(),
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Москва",
        contactPhone: "+7 (900) 123-45-67",
        personalDataConsent: true,
      };
    }

    function signUpAt(eventId: string, email: string) {
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventId;
      return h.app.inject({
        method: "POST",
        url: "/v1/congress/sign-up",
        payload: submission(email),
      });
    }

    async function countsFor(eventId: string, email: string) {
      const { rows } = await h.pool.query<{
        users: string;
        registrations: string;
        reserves: string;
      }>(
        `SELECT
           (SELECT count(*) FROM users WHERE email = $2) AS users,
           (SELECT count(*) FROM registrations WHERE event_id = $1) AS registrations,
           (SELECT count(*) FROM points_reserves WHERE item_ref = $1::text) AS reserves`,
        [eventId, email],
      );
      return rows[0]!;
    }

    beforeAll(async () => {
      for (const [k, v] of Object.entries(ENV)) {
        saved[k] = process.env[k];
        process.env[k] = v;
      }
      saved.CONGRESS_SIGNUP_EVENT_ID = process.env.CONGRESS_SIGNUP_EVENT_ID;
      h = await bootSpend();
    });

    afterAll(async () => {
      if (h) await h.app.close();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it("EARS-41: when the public congress intake receives a sign-up for a priced event, system shall refuse it with one generic response identical for every email, writing no account, registration, posting or hold", async () => {
      const eventId = await congressEvent();
      await h.prices.put(
        eventId,
        { itemKind: "event", mode: "threshold", pulCost: 50 },
        null,
      );
      // An existing doctor who could pay: verified phone and enough Pul.
      const { personId } = await doctor(h);
      await verifyPhone(h, personId);
      await fund(h, personId, 500);
      const { rows } = await h.pool.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1",
        [personId],
      );
      const known = rows[0]!.email;
      const postingsBefore = await postingsOfPerson(h, personId);

      const forKnown = await signUpAt(eventId, known);
      const unknown = `points-congress-unknown-${randomUUID()}@ds.test`;
      const forUnknown = await signUpAt(eventId, unknown);

      expect(forKnown.statusCode).toBe(422);
      expect(forKnown.json()).toMatchObject({ code: "sign-up-unavailable" });
      // The refusal depends only on the event: byte-identical for both emails.
      expect(forUnknown.statusCode).toBe(forKnown.statusCode);
      expect(forUnknown.payload).toBe(forKnown.payload);

      expect(await postingsOfPerson(h, personId)).toEqual(postingsBefore);
      expect(await pulOf(h, personId)).toBe(500);
      expect(await countsFor(eventId, known)).toEqual({
        users: "1",
        registrations: "0",
        reserves: "0",
      });
      // No account was created for the unknown email.
      expect(await countsFor(eventId, unknown)).toEqual({
        users: "0",
        registrations: "0",
        reserves: "0",
      });
    });

    it("EARS-41: when the public congress intake receives a sign-up for an unpriced event, system shall accept it and record nothing in points", async () => {
      const eventId = await congressEvent();
      const email = `points-congress-free-${randomUUID()}@ds.test`;

      const res = await signUpAt(eventId, email);

      expect(res.statusCode, res.payload).toBe(200);
      expect(await countsFor(eventId, email)).toEqual({
        users: "1",
        registrations: "1",
        reserves: "0",
      });
      const { rows } = await h.pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      expect(await postingsOfPerson(h, rows[0]!.id)).toEqual([]);
      const journal = await h.pool.query(
        "SELECT 1 FROM points_facts WHERE person_id = $1",
        [rows[0]!.id],
      );
      expect(journal.rowCount).toBe(0);
    });
  },
);
