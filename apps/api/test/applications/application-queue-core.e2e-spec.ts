import { createHash, randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { loadDocument } from "@ds/legal-content";
import { AUDIT_PD_COLUMNS, type DrizzleHandle } from "@ds/db";
import {
  APPLICATION_NOTE_ERASED_SENTINEL,
  ApplicationProblemCodes,
  ApplicationRefusalSchema,
  AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
  AuthorApplicationIntakeResultSchema,
  BotProtectionErrorCodes,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import {
  DRIZZLE_DB,
  DRIZZLE_POOL,
} from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import { ApplicationsPurge } from "../../src/applications/applications.purge.js";
import {
  ApplicationsService,
  eraseApplicationsOfAccount,
} from "../../src/applications/applications.service.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/**
 * 033 EARS-6, EARS-7, EARS-20, EARS-23, EARS-24, EARS-25 — the application
 * queue core (#4028): the author intake with its consent, idempotency and bot
 * protection through the REAL route on the REAL module with a real doctor
 * session; the retention purge, the erasure handler and the account-erasure
 * step against real rows; the 010 ledger rows of every write.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL
 * or IDP_ISSUER is absent so the shared CI unit job stays green.
 */

class StubBotProtection implements BotProtection {
  static readonly GOOD = "good-captcha";
  verify(token: string): Promise<BotProtectionResult> {
    if (!token) return Promise.resolve({ ok: false, reason: "missing-token" });
    return Promise.resolve(
      token === StubBotProtection.GOOD
        ? { ok: true }
        : { ok: false, reason: "rejected" },
    );
  }
}

/** EARS-6 — the current consent version, computed from the file itself. */
const CONSENT_VERSION = (() => {
  const document = loadDocument("consent-author-application");
  if (!document)
    throw new Error("the author consent document is not published");
  const digest = createHash("sha256").update(document.body).digest("hex");
  return `${document.frontmatter.edition}.sha256-${digest}`;
})();

const URL = "/v1/me/applications/author";
const DAY = 24 * 60 * 60 * 1000;
const YEAR_AGO_AND_A_DAY = () => new Date(Date.now() - 367 * DAY);

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "033 EARS-6, EARS-7, EARS-20, EARS-23, EARS-24, EARS-25 — application queue core (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];

    type Account = { headers: Record<string, string>; userId: string };

    async function account(prefix: string): Promise<Account> {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        headers: { "x-smartcaptcha-token": StubBotProtection.GOOD },
        payload: { email, password, consent },
      });
      expect(reg.statusCode, reg.payload).toBe(200);
      const sid = await signIn(app, email, password, { device });
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      return {
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${sid}` },
        userId: rows[0]!.id,
      };
    }

    const body = (over: Record<string, unknown> = {}) => ({
      topic: "Ведение пациентов с гонартрозом",
      format: "course_series",
      about: "Практикующий ортопед",
      consentVersion: CONSENT_VERSION,
      ...over,
    });

    const submit = (
      a: Account | null,
      payload: unknown,
      key: string | null = randomUUID(),
      token: string | null = StubBotProtection.GOOD,
    ) =>
      app.inject({
        method: "POST",
        url: URL,
        headers: {
          ...(a?.headers ?? device),
          ...(key === null ? {} : { "idempotency-key": key }),
          ...(token === null ? {} : { "x-smartcaptcha-token": token }),
        },
        payload: payload as Record<string, unknown>,
      });

    const codes = (res: { json: () => unknown }) =>
      ApplicationRefusalSchema.parse(res.json()).problems;

    async function countOf(userId: string) {
      const { rows } = await pool.query<{ apps: string; consents: string }>(
        `SELECT
           (SELECT count(*) FROM applications WHERE applicant_user_id = $1) AS apps,
           (SELECT count(*) FROM consent_records WHERE user_id = $1
              AND purpose = $2) AS consents`,
        [userId, AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE],
      );
      return {
        apps: Number(rows[0]!.apps),
        consents: Number(rows[0]!.consents),
      };
    }

    /** A stored author application with the given clock, written directly. */
    async function stored(
      userId: string,
      at: {
        submittedAt?: Date;
        status?: "new" | "in_review" | "closed";
        statusChangedAt?: Date | null;
        closedAt?: Date | null;
      } = {},
    ): Promise<string> {
      const status = at.status ?? "new";
      const { rows: c } = await pool.query<{ id: string }>(
        `INSERT INTO consent_records (user_id, purpose, version)
         VALUES ($1, $2, $3) RETURNING id`,
        [userId, AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE, CONSENT_VERSION],
      );
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO applications
           (kind, status, outcome, applicant_user_id, payload, subject_line,
            consent_record_id, consent_purpose, consent_version_tag,
            idempotency_key, submitted_at, status_changed_at, closed_at)
         VALUES ('author', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          status,
          status === "closed" ? "declined" : null,
          userId,
          JSON.stringify({ topic: "Секретная тема", format: "podcast" }),
          "Секретная тема",
          c[0]!.id,
          AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
          CONSENT_VERSION,
          randomUUID(),
          at.submittedAt ?? new Date(),
          at.statusChangedAt ?? null,
          status === "closed" ? (at.closedAt ?? new Date()) : null,
        ],
      );
      return rows[0]!.id;
    }

    async function note(applicationId: string, text: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO application_notes (application_id, author_admin_id, body)
         VALUES ($1, $2, $3) RETURNING id`,
        [applicationId, randomUUID(), text],
      );
      return rows[0]!.id;
    }

    async function row(id: string) {
      const { rows } = await pool.query<{
        kind: string;
        status: string;
        outcome: string | null;
        applicant_user_id: string | null;
        payload: unknown;
        contact: unknown;
        subject_line: string | null;
        submitted_at: Date;
        closed_at: Date | null;
        status_changed_at: Date | null;
        status_changed_by: string | null;
        pd_erased_at: Date | null;
        consent_record_id: string | null;
        consent_version_tag: string;
      }>("SELECT * FROM applications WHERE id = $1", [id]);
      return rows[0]!;
    }

    async function notesOf(id: string): Promise<string[]> {
      const { rows } = await pool.query<{ body: string }>(
        "SELECT body FROM application_notes WHERE application_id = $1",
        [id],
      );
      return rows.map((r) => r.body);
    }

    function expectTombstone(r: Awaited<ReturnType<typeof row>>) {
      expect(r.payload).toEqual({ erased: true });
      expect(r.contact).toBeNull();
      expect(r.subject_line).toBeNull();
      expect(r.applicant_user_id).toBeNull();
      expect(r.pd_erased_at).toBeInstanceOf(Date);
      expect(r.kind).toBe("author");
      expect(r.submitted_at).toBeInstanceOf(Date);
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(MAILER)
          .useValue(mailer)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT)
          .overrideProvider(BOT_PROTECTION)
          .useValue(new StubBotProtection()),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterAll(async () => {
      if (pool)
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
      await app?.close();
    });

    // ------------------------------------------------------------- EARS-6

    it("EARS-6: when an author application is stored, system shall record one consent row of its purpose and version in the same transaction and link it; a body without the current version tag is refused 400 on the consent", async () => {
      const a = await account("app-consent");

      const ok = await submit(a, body());
      expect(ok.statusCode, ok.payload).toBe(201);
      const { id } = AuthorApplicationIntakeResultSchema.parse(ok.json());
      const r = await row(id);
      const { rows: consentRows } = await pool.query<{
        id: string;
        user_id: string;
        purpose: string;
        version: string;
      }>("SELECT * FROM consent_records WHERE id = $1", [r.consent_record_id]);
      expect(consentRows[0]).toMatchObject({
        user_id: a.userId,
        purpose: AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
        version: CONSENT_VERSION,
      });
      expect(r.consent_version_tag).toBe(CONSENT_VERSION);

      const stale = await submit(
        a,
        body({ consentVersion: `2020-01-01.sha256-${"0".repeat(64)}` }),
      );
      expect(stale.statusCode).toBe(400);
      expect(codes(stale)).toEqual([
        {
          code: ApplicationProblemCodes.consentVersionStale,
          field: "consent",
        },
      ]);
      const { consentVersion: _drop, ...noConsent } = body();
      expect((await submit(a, noConsent)).statusCode).toBe(400);
      expect(await countOf(a.userId)).toEqual({ apps: 1, consents: 1 });
    });

    // ------------------------------------------------------------- EARS-7

    it("EARS-7: when a signed-in caller posts a valid author application, system shall store one row and answer 201 { id, submittedAt }; a replay answers the same and creates nothing", async () => {
      const a = await account("app-intake");
      const key = randomUUID();
      const sent = body({ specialtyOther: "Спортивная медицина" });

      const first = await submit(a, sent, key);
      expect(first.statusCode, first.payload).toBe(201);
      const result = AuthorApplicationIntakeResultSchema.parse(first.json());
      const r = await row(result.id);
      expect(r).toMatchObject({
        kind: "author",
        status: "new",
        outcome: null,
        applicant_user_id: a.userId,
        subject_line: "Ведение пациентов с гонартрозом",
        payload: {
          topic: "Ведение пациентов с гонартрозом",
          specialtyOther: "Спортивная медицина",
          format: "course_series",
          about: "Практикующий ортопед",
        },
      });
      expect(r.submitted_at.toISOString()).toBe(result.submittedAt);

      const replay = await submit(a, sent, key);
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toEqual(result);
      expect(await countOf(a.userId)).toEqual({ apps: 1, consents: 1 });
    });

    it("EARS-7: the same key with another body, or by another account, is refused 422 IDEMPOTENCY_KEY_REUSED and changes nothing", async () => {
      const a = await account("app-reuse");
      const b = await account("app-reuse-other");
      const key = randomUUID();
      expect((await submit(a, body(), key)).statusCode).toBe(201);

      const other = await submit(a, body({ topic: "Другая тема" }), key);
      expect(other.statusCode).toBe(422);
      expect(codes(other)[0]!.code).toBe(
        ApplicationProblemCodes.idempotencyKeyReused,
      );
      const foreign = await submit(b, body(), key);
      expect(foreign.statusCode).toBe(422);
      expect(await countOf(a.userId)).toEqual({ apps: 1, consents: 1 });
      expect(await countOf(b.userId)).toEqual({ apps: 0, consents: 0 });
    });

    it("EARS-7: an anonymous caller gets 401, a missing or rejected proof the 003 codes, a missing or non-canonical key 428 / 400, an unknown specialty 400 on its field — and nothing is stored", async () => {
      const a = await account("app-refusals");

      expect((await submit(null, body())).statusCode).toBe(401);

      const missing = await submit(a, body(), randomUUID(), null);
      expect(missing.statusCode).toBe(403);
      expect(missing.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.required,
      );
      const rejected = await submit(a, body(), randomUUID(), "forged");
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.rejected,
      );

      const keyless = await submit(a, body(), null);
      expect(keyless.statusCode).toBe(428);
      const upper = await submit(a, body(), randomUUID().toUpperCase());
      expect(upper.statusCode).toBe(400);
      expect(codes(upper)[0]!.code).toBe(
        ApplicationProblemCodes.idempotencyKeyInvalid,
      );

      const unknown = await submit(
        a,
        body({ specialtyCode: "no-such-specialty" }),
      );
      expect(unknown.statusCode).toBe(400);
      expect(codes(unknown)).toEqual([
        {
          code: ApplicationProblemCodes.specialtyUnknown,
          field: "specialtyCode",
        },
      ]);
      expect((await submit(a, body({ topic: "  " }))).statusCode).toBe(400);
      expect(await countOf(a.userId)).toEqual({ apps: 0, consents: 0 });

      const { rows } = await pool.query<{ code: string }>(
        "SELECT code FROM specialties_minzdrav WHERE NOT is_other LIMIT 1",
      );
      const known = await submit(a, body({ specialtyCode: rows[0]!.code }));
      expect(known.statusCode, known.payload).toBe(201);
    });

    // ------------------------------------------------------------ EARS-20

    it("EARS-20: when an application has been closed for a year, the daily purge shall replace its PD with the tombstone, unlink the applicant and blank its notes, keeping kind, status, outcome and times; a younger one is untouched", async () => {
      const a = await account("app-erase-due");
      const due = await stored(a.userId, {
        status: "closed",
        submittedAt: new Date(Date.now() - 500 * DAY),
        statusChangedAt: YEAR_AGO_AND_A_DAY(),
        closedAt: YEAR_AGO_AND_A_DAY(),
      });
      await note(due, "Позвонить Иванову");
      const young = await stored(a.userId, {
        status: "closed",
        statusChangedAt: new Date(Date.now() - 300 * DAY),
        closedAt: new Date(Date.now() - 300 * DAY),
      });

      await app.get(ApplicationsPurge).runOnce();

      const r = await row(due);
      expectTombstone(r);
      expect(r.status).toBe("closed");
      expect(r.outcome).toBe("declined");
      expect(r.closed_at).toBeInstanceOf(Date);
      expect(await notesOf(due)).toEqual([APPLICATION_NOTE_ERASED_SENTINEL]);
      const y = await row(young);
      expect(y.pd_erased_at).toBeNull();
      expect(y.applicant_user_id).toBe(a.userId);
    });

    it("EARS-20: an administrator erasure on request tombstones an application in any status, and an erased application is not erased again", async () => {
      const a = await account("app-erase-request");
      const id = await stored(a.userId, { status: "in_review" });
      await note(id, "Заметка с именем");
      const service = app.get(ApplicationsService);

      expect(await service.eraseOnRequest(id)).toBe(true);
      const r = await row(id);
      expectTombstone(r);
      expect(r.status).toBe("in_review");
      expect(await notesOf(id)).toEqual([APPLICATION_NOTE_ERASED_SENTINEL]);
      const erasedAt = r.pd_erased_at!.getTime();

      expect(await service.eraseOnRequest(id)).toBe(false);
      expect((await row(id)).pd_erased_at!.getTime()).toBe(erasedAt);
    });

    // ------------------------------------------------------------ EARS-23

    it("EARS-23: when an open application has had no status change for a year, the daily purge shall close it as expired with no actor; a younger one is untouched", async () => {
      const a = await account("app-expire");
      const neverMoved = await stored(a.userId, {
        submittedAt: YEAR_AGO_AND_A_DAY(),
      });
      const staleReview = await stored(a.userId, {
        status: "in_review",
        submittedAt: new Date(Date.now() - 600 * DAY),
        statusChangedAt: YEAR_AGO_AND_A_DAY(),
      });
      const recentlyMoved = await stored(a.userId, {
        status: "in_review",
        submittedAt: new Date(Date.now() - 600 * DAY),
        statusChangedAt: new Date(Date.now() - 30 * DAY),
      });
      const fresh = await stored(a.userId, {
        submittedAt: new Date(Date.now() - 300 * DAY),
      });

      await app.get(ApplicationsPurge).runOnce();

      for (const id of [neverMoved, staleReview]) {
        const r = await row(id);
        expect(r).toMatchObject({
          status: "closed",
          outcome: "expired",
          status_changed_by: null,
        });
        expect(Date.now() - r.closed_at!.getTime()).toBeLessThan(DAY);
        // the one-year term after closing now runs: still carries its PD
        expect(r.pd_erased_at).toBeNull();
        expect(r.applicant_user_id).toBe(a.userId);
      }
      for (const id of [recentlyMoved, fresh]) {
        const r = await row(id);
        expect(r.status).not.toBe("closed");
        expect(r.outcome).toBeNull();
      }
    });

    // ------------------------------------------------------------ EARS-24

    it("EARS-24: when the applicant's account is erased, every application of that account shall be tombstoned in the caller's transaction whatever its status, and an erased one is left as it is", async () => {
      const a = await account("app-account-erase");
      const other = await account("app-account-keep");
      const open = await stored(a.userId);
      const closed = await stored(a.userId, { status: "closed" });
      const already = await stored(a.userId, { status: "in_review" });
      await app.get(ApplicationsService).eraseOnRequest(already);
      const alreadyAt = (await row(already)).pd_erased_at!.getTime();
      const kept = await stored(other.userId);

      const db = app.get<DrizzleHandle["db"]>(DRIZZLE_DB);
      // In the caller's transaction: a rollback undoes the step.
      await expect(
        db.transaction(async (tx) => {
          expect(await eraseApplicationsOfAccount(a.userId, tx)).toBe(2);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect((await row(open)).pd_erased_at).toBeNull();

      const erased = await db.transaction((tx) =>
        eraseApplicationsOfAccount(a.userId, tx),
      );
      expect(erased).toBe(2);
      for (const id of [open, closed]) expectTombstone(await row(id));
      expect((await row(already)).pd_erased_at!.getTime()).toBe(alreadyAt);
      expect((await row(kept)).applicant_user_id).toBe(other.userId);

      expect(
        await db.transaction((tx) => eraseApplicationsOfAccount(a.userId, tx)),
      ).toBe(0);
    });

    // ------------------------------------------------------------ EARS-25

    it("EARS-25: the queue's PD columns are in the 010 registry, and the ledger rows of an intake, a note, an expiry and an erasure carry them masked, never their values", async () => {
      expect(AUDIT_PD_COLUMNS["applications"]).toEqual([
        "payload",
        "contact",
        "subject_line",
      ]);
      expect(AUDIT_PD_COLUMNS["application_notes"]).toEqual(["body"]);
      const { rows: sqlRegistry } = await pool.query<{
        a: string[];
        n: string[];
      }>(
        "SELECT audit_pd_columns('applications') AS a, audit_pd_columns('application_notes') AS n",
      );
      expect(sqlRegistry[0]).toEqual({
        a: ["payload", "contact", "subject_line"],
        n: ["body"],
      });

      const a = await account("app-audit");
      const secretTopic = `Тайная тема ${randomUUID()}`;
      const intake = await submit(a, body({ topic: secretTopic }));
      expect(intake.statusCode).toBe(201);
      const { id } = AuthorApplicationIntakeResultSchema.parse(intake.json());
      const secretNote = `Иванов +7 900 ${randomUUID()}`;
      const noteId = await note(id, secretNote);
      // a status move: the purge's expiry, a year after submission
      await pool.query(
        "UPDATE applications SET submitted_at = $2 WHERE id = $1",
        [id, YEAR_AGO_AND_A_DAY()],
      );
      await app.get(ApplicationsService).expireStale();
      expect((await row(id)).outcome).toBe("expired");
      await app.get(ApplicationsService).eraseOnRequest(id);

      const { rows: trail } = await pool.query<{
        event_type: string;
        metadata: { diff: Record<string, unknown> };
      }>(
        `SELECT event_type, metadata FROM audit_ledger
          WHERE (event_type LIKE 'data.applications.%' AND metadata -> 'pk' ->> 'id' = $1)
             OR (event_type LIKE 'data.application_notes.%' AND metadata -> 'pk' ->> 'id' = $2)
          ORDER BY created_at, event_type`,
        [id, noteId],
      );
      const types = trail.map((t) => t.event_type);
      expect(types).toContain("data.applications.insert");
      expect(types).toContain("data.application_notes.insert");
      expect(types).toContain("data.application_notes.update");
      expect(
        types.filter((t) => t === "data.applications.update").length,
      ).toBeGreaterThanOrEqual(3);
      const insert = trail.find(
        (t) => t.event_type === "data.applications.insert",
      )!;
      expect(insert.metadata.diff["payload"]).toEqual({ masked: true });
      expect(insert.metadata.diff["subject_line"]).toEqual({ masked: true });
      const noteInsert = trail.find(
        (t) => t.event_type === "data.application_notes.insert",
      )!;
      expect(noteInsert.metadata.diff["body"]).toEqual({ masked: true });
      const all = JSON.stringify(trail);
      expect(all).not.toContain(secretTopic);
      expect(all).not.toContain(secretNote);
      expect(all).not.toContain("Практикующий ортопед");
    });
  },
);
