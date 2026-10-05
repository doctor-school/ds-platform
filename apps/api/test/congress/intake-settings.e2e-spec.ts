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
  CONGRESS_INTAKE_DEFAULTS,
  type CongressIntakeSettingsRequest,
  CongressIntakeSettingsSchema,
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
 * 046 EARS-1…EARS-3 — V-2: the platform administrator reads and saves the
 * congress intake settings of one event,
 * `GET` / `PUT /v1/admin/events/:id/congress-intake-settings`.
 *
 * Driven through the REAL route on the REAL module; assertions read the stored
 * rows (instants, not the days the body carried) and the 010 ledger rows the
 * capture triggers appended.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "046 EARS-1…3 — congress intake settings (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventId = randomUUID();
    const freshEventId = randomUUID();
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    let admin: { headers: Record<string, string>; sub: string };
    let registrar: { headers: Record<string, string>; sub: string };

    const url = (id: string) =>
      `/v1/admin/events/${id}/congress-intake-settings`;

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

    async function insertEvent(id: string, slug: string) {
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline', ${eventClassificationSql()})`,
        [
          id,
          slug,
          "Конгресс",
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

    function settings(
      patch: Partial<CongressIntakeSettingsRequest> = {},
      kinds: Partial<CongressIntakeSettingsRequest["kinds"]> = {},
    ): CongressIntakeSettingsRequest {
      return {
        ...CONGRESS_INTAKE_DEFAULTS,
        ...patch,
        kinds: { ...CONGRESS_INTAKE_DEFAULTS.kinds, ...kinds },
      };
    }

    const put = (
      headers: Record<string, string>,
      id: string,
      payload: unknown,
    ) => app.inject({ method: "PUT", url: url(id), headers, payload });

    async function storedKinds(id: string) {
      const { rows } = await pool.query<{
        kind: string;
        opens_at: string | null;
        closes_at: string | null;
        submit_limit: number | null;
        max_age_years: number | null;
      }>(
        `SELECT kind,
                to_char(opens_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS opens_at,
                to_char(closes_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS closes_at,
                submit_limit, max_age_years
           FROM congress_submission_kind_settings
          WHERE event_id = $1 ORDER BY kind`,
        [id],
      );
      return rows;
    }

    async function ledgerRows(table: string, id: string) {
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
        source: string;
      }>(
        `SELECT event_type, subject_id, metadata ->> 'source' AS source
           FROM audit_ledger
          WHERE metadata ->> 'table' = $1
            AND metadata -> 'pk' ->> 'event_id' = $2
          ORDER BY created_at`,
        [table, id],
      );
      return rows;
    }

    beforeAll(async () => {
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
      await insertEvent(eventId, `congress-intake-${eventId.slice(0, 8)}`);
      await insertEvent(
        freshEventId,
        `congress-intake-f-${freshEventId.slice(0, 8)}`,
      );

      admin = await adminPrincipal("intake-admin", "platform_admin");
      registrar = await adminPrincipal(
        "intake-registrar",
        "event-registrar",
        eventId,
      );
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        await deleteEventFixture(pool, eventId);
        await deleteEventFixture(pool, freshEventId);
      }
      await app?.close();
    });

    it("046 EARS-2: an event with no settings reads the product defaults and is not configured (no congress section)", async () => {
      const res = await app.inject({
        method: "GET",
        url: url(freshEventId),
        headers: admin.headers,
      });
      expect(res.statusCode, res.body).toBe(200);
      // No congress-wide revision deadline on the wire — each submission's
      // revision term is its own.
      expect(Object.keys(res.json()).sort()).toEqual([
        "configured",
        "eventId",
        "firstAuthorCounts",
        "kinds",
        "registrationUrl",
      ]);
      const body = CongressIntakeSettingsSchema.parse(res.json());
      expect(body).toEqual({
        eventId: freshEventId,
        configured: false,
        registrationUrl: null,
        firstAuthorCounts: false,
        kinds: {
          oral: {
            kind: "oral",
            opensOn: null,
            lastDay: null,
            opensAt: null,
            closesAt: null,
            submitLimit: null,
            maxAgeYears: null,
          },
          poster: {
            kind: "poster",
            opensOn: null,
            lastDay: null,
            opensAt: null,
            closesAt: null,
            submitLimit: null,
            maxAgeYears: 40,
          },
          abstract: {
            kind: "abstract",
            opensOn: null,
            lastDay: null,
            opensAt: null,
            closesAt: null,
            submitLimit: 3,
            maxAgeYears: null,
          },
        },
      });
      // Reading the defaults writes nothing.
      const { rows } = await pool.query(
        "SELECT 1 FROM congress_submission_settings WHERE event_id = $1",
        [freshEventId],
      );
      expect(rows).toEqual([]);
    });

    it("046 EARS-1 / EARS-3: saved Moscow days are stored as instants — opening at 00:00, each closing at 00:00 of the day after the last day", async () => {
      const res = await put(
        admin.headers,
        eventId,
        settings(
          {
            registrationUrl: "https://orthobio.ru/registration",
            firstAuthorCounts: true,
          },
          {
            oral: {
              opensOn: "2026-11-01",
              lastDay: "2027-01-29",
              submitLimit: null,
              maxAgeYears: null,
            },
            poster: {
              opensOn: null,
              lastDay: "2027-01-15",
              submitLimit: 2,
              maxAgeYears: 40,
            },
          },
        ),
      );
      expect(res.statusCode, res.body).toBe(200);
      const body = CongressIntakeSettingsSchema.parse(res.json());
      expect(body).toMatchObject({
        eventId,
        configured: true,
        registrationUrl: "https://orthobio.ru/registration",
        firstAuthorCounts: true,
      });
      expect(body.kinds.oral).toEqual({
        kind: "oral",
        opensOn: "2026-11-01",
        lastDay: "2027-01-29",
        opensAt: "2026-10-31T21:00:00.000Z",
        closesAt: "2027-01-29T21:00:00.000Z",
        submitLimit: null,
        maxAgeYears: null,
      });

      const { rows } = await pool.query<{
        url: string;
        rule: boolean;
      }>(
        `SELECT registration_url AS url, first_author_counts AS rule
           FROM congress_submission_settings WHERE event_id = $1`,
        [eventId],
      );
      expect(rows).toEqual([
        {
          url: "https://orthobio.ru/registration",
          rule: true,
        },
      ]);
      expect(await storedKinds(eventId)).toEqual([
        {
          kind: "abstract",
          opens_at: null,
          closes_at: null,
          submit_limit: 3,
          max_age_years: null,
        },
        {
          kind: "oral",
          opens_at: "2026-10-31T21:00:00Z",
          closes_at: "2027-01-29T21:00:00Z",
          submit_limit: null,
          max_age_years: null,
        },
        {
          kind: "poster",
          opens_at: null,
          closes_at: "2027-01-15T21:00:00Z",
          submit_limit: 2,
          max_age_years: 40,
        },
      ]);
    });

    it("046 EARS-2: a saved change takes effect on the next request and is recorded by the 010 change audit", async () => {
      const ledgerBefore = await ledgerRows(
        "congress_submission_kind_settings",
        eventId,
      );
      // The event-level change: the first-author rule is switched off again.
      const res = await put(
        admin.headers,
        eventId,
        settings(
          {
            registrationUrl: "https://orthobio.ru/registration",
            firstAuthorCounts: false,
          },
          {
            oral: {
              opensOn: "2026-11-01",
              lastDay: "2027-01-29",
              submitLimit: null,
              maxAgeYears: null,
            },
            poster: {
              opensOn: null,
              lastDay: "2027-01-15",
              submitLimit: 2,
              maxAgeYears: 40,
            },
            abstract: {
              opensOn: null,
              lastDay: null,
              submitLimit: 5,
              maxAgeYears: null,
            },
          },
        ),
      );
      expect(res.statusCode, res.body).toBe(200);

      const next = await app.inject({
        method: "GET",
        url: url(eventId),
        headers: admin.headers,
      });
      expect(next.statusCode).toBe(200);
      const body = CongressIntakeSettingsSchema.parse(next.json());
      expect(body.kinds.abstract.submitLimit).toBe(5);
      expect(body.firstAuthorCounts).toBe(false);

      // Every row the first save created is in the ledger, attributed to the
      // acting administrator from the admin UI.
      const settingsLedger = await ledgerRows(
        "congress_submission_settings",
        eventId,
      );
      expect(settingsLedger[0]).toEqual({
        event_type: "data.congress_submission_settings.insert",
        subject_id: admin.sub,
        source: "admin-ui",
      });
      expect(settingsLedger.at(-1)).toMatchObject({
        event_type: "data.congress_submission_settings.update",
        subject_id: admin.sub,
      });
      const kindLedger = await ledgerRows(
        "congress_submission_kind_settings",
        eventId,
      );
      expect(
        kindLedger.filter((r) => r.event_type.endsWith(".insert")),
      ).toHaveLength(3);
      // This save changed only the abstract limit — exactly one kind row updated;
      // the unchanged oral and poster rows write no ledger row.
      expect(kindLedger.slice(ledgerBefore.length)).toEqual([
        {
          event_type: "data.congress_submission_kind_settings.update",
          subject_id: admin.sub,
          source: "admin-ui",
        },
      ]);
    });

    it("046 EARS-2: refuses an opening without a last day, inverted dates, a zero limit and age 17 — and stores nothing", async () => {
      const before = await storedKinds(eventId);
      const refused = [
        settings(
          {},
          {
            oral: {
              opensOn: "2026-11-01",
              lastDay: null,
              submitLimit: null,
              maxAgeYears: null,
            },
          },
        ),
        settings(
          {},
          {
            oral: {
              opensOn: "2026-11-02",
              lastDay: "2026-11-01",
              submitLimit: null,
              maxAgeYears: null,
            },
          },
        ),
        settings(
          {},
          {
            abstract: {
              opensOn: null,
              lastDay: null,
              submitLimit: 0,
              maxAgeYears: null,
            },
          },
        ),
        settings(
          {},
          {
            poster: {
              opensOn: null,
              lastDay: null,
              submitLimit: null,
              maxAgeYears: 17,
            },
          },
        ),
        settings(
          {},
          {
            poster: {
              opensOn: null,
              lastDay: null,
              submitLimit: null,
              maxAgeYears: 100,
            },
          },
        ),
      ];
      for (const payload of refused) {
        const res = await put(admin.headers, eventId, payload);
        expect(res.statusCode, JSON.stringify(payload.kinds)).toBe(400);
      }
      expect(await storedKinds(eventId)).toEqual(before);
    });

    it("046 EARS-2: an unknown event is 404", async () => {
      const res = await put(admin.headers, randomUUID(), settings());
      expect(res.statusCode).toBe(404);
      const read = await app.inject({
        method: "GET",
        url: url(randomUUID()),
        headers: admin.headers,
      });
      expect(read.statusCode).toBe(404);
    });

    it("046 EARS-2: only the platform administrator reaches the endpoints — a registrar is 403, no session is 401", async () => {
      const read = await app.inject({
        method: "GET",
        url: url(eventId),
        headers: registrar.headers,
      });
      expect(read.statusCode).toBe(403);
      const write = await put(registrar.headers, eventId, settings());
      expect(write.statusCode).toBe(403);
      const anon = await app.inject({ method: "GET", url: url(eventId) });
      expect(anon.statusCode).toBe(401);
    });
  },
);
