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
  ApplicationProblemCodes,
  ApplicationRefusalSchema,
  BotProtectionErrorCodes,
  INVESTOR_REQUEST_CONSENT_PURPOSE,
  INVESTOR_REQUEST_CONSENT_VERSION_TAG,
  InvestorRequestIntakeResultSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import { ApplicationsPurge } from "../../src/applications/applications.purge.js";
import { ApplicationsService } from "../../src/applications/applications.service.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

/**
 * 034 EARS-4, EARS-6, EARS-9, EARS-12 — the investor kind of the 033
 * application queue (#4236): the public intake through the REAL route on the
 * REAL module with its bot protection, idempotency and consent stamp; both 033
 * notices after the commit; the queue's expiry, erasure and audit masking on
 * investor rows.
 *
 * Runs against the dev-stand Postgres; skips when DATABASE_URL or IDP_ISSUER
 * is absent so the shared CI unit job stays green.
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

const URL = "/v1/public/applications/investor";
const DAY = 24 * 60 * 60 * 1000;
const ORGANISATION = "ООО «Партнёр А»";
const FULL_NAME = "Анна Петрова";
const ROLE = "Директор по развитию";
const PHONE = "+7 900 000-00-00";
const TASK = "Хотим войти в проект школы кардиологов";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "034 EARS-4, EARS-6, EARS-9, EARS-12 — investor intake (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const created: string[] = [];
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const savedOrigin = process.env.ACADEMY_PUBLIC_ORIGIN;
    const adminEmail = `investor-admin-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@ds.test`;

    const tag = () => Math.random().toString(36).slice(2, 10);

    const body = (over: Record<string, unknown> = {}) => ({
      contact: {
        organisation: ORGANISATION,
        fullName: FULL_NAME,
        role: ROLE,
        email: `investor-${tag()}@partner-a.test`,
        phone: PHONE,
      },
      payload: { task: TASK },
      consent: {
        accepted: true,
        versionTag: INVESTOR_REQUEST_CONSENT_VERSION_TAG,
      },
      ...over,
    });
    type Body = ReturnType<typeof body>;

    const submit = (
      payload: unknown,
      key: string | null = randomUUID(),
      token: string | null = StubBotProtection.GOOD,
    ) =>
      app.inject({
        method: "POST",
        url: URL,
        headers: {
          ...(key === null ? {} : { "idempotency-key": key }),
          ...(token === null ? {} : { "x-smartcaptcha-token": token }),
        },
        payload: payload as Record<string, unknown>,
      });

    const accepted = async (sent: unknown, key?: string) => {
      const res = await submit(sent, key);
      expect(res.statusCode, res.payload).toBe(201);
      const { id } = InvestorRequestIntakeResultSchema.parse(res.json());
      if (!created.includes(id)) created.push(id);
      return id;
    };

    const codes = (res: { json: () => unknown }) =>
      ApplicationRefusalSchema.parse(res.json()).problems;

    async function row(id: string) {
      const { rows } = await pool.query<{
        kind: string;
        status: string;
        outcome: string | null;
        applicant_user_id: string | null;
        payload: unknown;
        contact: unknown;
        subject_line: string | null;
        consent_record_id: string | null;
        consent_purpose: string;
        consent_version_tag: string;
        submitted_at: Date;
        closed_at: Date | null;
        pd_erased_at: Date | null;
        team_notice: string;
        receipt_notice: string;
      }>("SELECT * FROM applications WHERE id = $1", [id]);
      return rows[0]!;
    }

    async function countByEmail(email: string): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM applications
          WHERE kind = 'investor' AND contact->>'email' = $1`,
        [email],
      );
      return Number(rows[0]!.n);
    }

    /** The row once both after-commit sends have recorded their outcome. */
    async function settled(id: string) {
      const deadline = Date.now() + 4_000;
      for (;;) {
        const r = await row(id);
        if (r.team_notice !== "pending" && r.receipt_notice !== "pending")
          return r;
        if (Date.now() > deadline)
          throw new Error(`notices of ${id} still pending`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    beforeAll(async () => {
      process.env.ACADEMY_PUBLIC_ORIGIN = "https://academy.ds.test";
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

      // EARS-9: one active platform_admin, so the team notice has a recipient.
      const password = "Aa1!ufficiently-long-pw";
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        headers: { "x-smartcaptcha-token": StubBotProtection.GOOD },
        payload: {
          email: adminEmail,
          password,
          consent: [{ purpose: "tos", version: "2026-01" }],
        },
      });
      expect(reg.statusCode, reg.payload).toBe(200);
      await signIn(app, adminEmail, password, {
        device: { "user-agent": "Test/1.0", "accept-language": "en-US" },
      });
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [adminEmail],
      );
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
    });

    afterAll(async () => {
      if (pool && created.length > 0)
        await pool.query(
          "DELETE FROM applications WHERE id = ANY($1::uuid[])",
          [created],
        );
      if (pool) await deleteUserFixture(pool, "email", adminEmail);
      if (savedOrigin === undefined) delete process.env.ACADEMY_PUBLIC_ORIGIN;
      else process.env.ACADEMY_PUBLIC_ORIGIN = savedOrigin;
      await app?.close();
    });

    // ------------------------------------------------------------ EARS-6

    it("EARS-6: when any caller posts a valid investor request with a proof and a key, system shall store one investor row, status new, no applicant, with its contact, payload, organisation subject line and consent, and answer 201 { id }; a replay answers the same id and stores nothing more; the same key with another body is 422", async () => {
      const key = randomUUID();
      const sent: Body = body();
      const id = await accepted(sent, key);

      expect(await row(id)).toMatchObject({
        kind: "investor",
        status: "new",
        applicant_user_id: null,
        consent_record_id: null,
        contact: {
          organisation: ORGANISATION,
          fullName: FULL_NAME,
          role: ROLE,
          email: sent.contact.email,
          phone: PHONE,
        },
        payload: { task: TASK },
        subject_line: ORGANISATION,
      });

      const replay = await submit(sent, key);
      expect(replay.statusCode, replay.payload).toBe(201);
      expect(InvestorRequestIntakeResultSchema.parse(replay.json())).toEqual({
        id,
      });
      expect(await countByEmail(sent.contact.email)).toBe(1);

      const reused = await submit(
        { ...sent, payload: { task: "Другая задача" } },
        key,
      );
      expect(reused.statusCode).toBe(422);
      expect(codes(reused)).toEqual([
        { code: ApplicationProblemCodes.idempotencyKeyReused },
      ]);
      expect(await countByEmail(sent.contact.email)).toBe(1);
    });

    it("EARS-6: empty optional fields are stored absent", async () => {
      const sent = body();
      const id = await accepted({
        ...sent,
        contact: { ...sent.contact, role: "", phone: "  " },
        payload: { task: "" },
      });
      const r = await row(id);
      expect(r.contact).toEqual({
        organisation: ORGANISATION,
        fullName: FULL_NAME,
        email: sent.contact.email,
      });
      expect(r.payload).toEqual({});
    });

    it("EARS-6: a missing or rejected proof is refused with the 003 codes, a missing or non-canonical key 428 / 400, a field-invalid body 400 — and nothing is stored", async () => {
      const sent = body();

      const missing = await submit(sent, randomUUID(), null);
      expect(missing.statusCode).toBe(403);
      expect(missing.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.required,
      );
      const rejected = await submit(sent, randomUUID(), "forged");
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.rejected,
      );

      expect((await submit(sent, null)).statusCode).toBe(428);
      expect((await submit(sent, "not-a-uuid")).statusCode).toBe(400);

      for (const contact of [
        { ...sent.contact, email: "anna@" },
        { ...sent.contact, organisation: "   " },
        { ...sent.contact, fullName: "ф".repeat(201) },
        { ...sent.contact, phone: "1".repeat(33) },
      ])
        expect((await submit({ ...sent, contact })).statusCode).toBe(400);
      expect(
        (await submit({ ...sent, payload: { task: "з".repeat(2001) } }))
          .statusCode,
      ).toBe(400);
      expect((await submit({ ...sent, extra: "x" })).statusCode).toBe(400);

      expect(await countByEmail(sent.contact.email)).toBe(0);
    });

    // ------------------------------------------------------------ EARS-4

    it("EARS-4: when an investor request is stored, system shall record on it the purpose investor-request-personal-data, the current version tag and the time", async () => {
      const before = Date.now();
      const id = await accepted(body());
      const r = await row(id);
      expect(r.consent_purpose).toBe(INVESTOR_REQUEST_CONSENT_PURPOSE);
      expect(r.consent_purpose).toBe("investor-request-personal-data");
      expect(r.consent_version_tag).toBe(INVESTOR_REQUEST_CONSENT_VERSION_TAG);
      expect(r.submitted_at.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    });

    it("EARS-4: a body without the consent, with it unticked or with a version tag other than the current one is refused 400 on the consent, and nothing is stored", async () => {
      const sent = body();
      const { consent: _omitted, ...withoutConsent } = sent;
      for (const b of [
        withoutConsent,
        { ...sent, consent: { ...sent.consent, accepted: false } },
      ]) {
        const res = await submit(b);
        expect(res.statusCode).toBe(400);
        expect(res.payload).toContain("consent");
      }

      const stale = await submit({
        ...sent,
        consent: { accepted: true, versionTag: "investor-request-v0" },
      });
      expect(stale.statusCode).toBe(400);
      expect(codes(stale)).toEqual([
        { code: ApplicationProblemCodes.consentVersionStale, field: "consent" },
      ]);

      expect(await countByEmail(sent.contact.email)).toBe(0);
    });

    // ------------------------------------------------------------ EARS-9

    it("EARS-9: when an investor request is committed, system shall send the team notice and one «Заявка получена» receipt to the work email, record both sent, and neither body carries the organisation, name, role, task or phone", async () => {
      const sent = body();
      const id = await accepted(sent);
      const r = await settled(id);
      expect(r.team_notice).toBe("sent");
      expect(r.receipt_notice).toBe("sent");

      const notices = mailer.applicationTeamNotices.filter((n) =>
        n.adminUrl.endsWith(id),
      );
      expect(notices.length).toBeGreaterThan(0);
      expect(notices[0]!.kindLabel).toBe("Инвестор");
      const receipts = mailer.applicationReceipts.filter(
        (m) => m.to === sent.contact.email,
      );
      expect(receipts).toHaveLength(1);

      const bodies = JSON.stringify([notices, receipts]);
      for (const field of [ORGANISATION, FULL_NAME, ROLE, TASK, PHONE])
        expect(bodies).not.toContain(field);
    });

    it("EARS-9: when the receipt or the team email fails, system shall keep the request, record failed and still answer 201", async () => {
      mailer.failNextApplicationReceipt(new Error("relay down"));
      const a = await accepted(body());
      expect((await settled(a)).receipt_notice).toBe("failed");

      mailer.failNextApplicationTeamNotice(new Error("relay down"));
      const b = await accepted(body());
      expect((await settled(b)).team_notice).toBe("failed");
      expect((await row(b)).kind).toBe("investor");
    });

    // ------------------------------------------------------------ EARS-12

    it("EARS-12: an open investor request with no status change for a year is closed as expired", async () => {
      const id = await accepted(body());
      await pool.query(
        "UPDATE applications SET submitted_at = $2 WHERE id = $1",
        [id, new Date(Date.now() - 367 * DAY)],
      );
      await app.get(ApplicationsService).expireStale();
      expect(await row(id)).toMatchObject({
        status: "closed",
        outcome: "expired",
      });
    });

    it("EARS-12: an investor request closed a year ago is erased by the daily purge to the tombstone, keeping kind, status, outcome and times", async () => {
      const id = await accepted(body());
      const longAgo = new Date(Date.now() - 366 * DAY);
      await pool.query(
        `UPDATE applications
            SET status = 'closed', outcome = 'declined',
                status_changed_at = $2, closed_at = $2
          WHERE id = $1`,
        [id, longAgo],
      );
      await app.get(ApplicationsPurge).runOnce();
      const r = await row(id);
      expect(r).toMatchObject({
        kind: "investor",
        status: "closed",
        outcome: "declined",
        contact: null,
        subject_line: null,
        payload: { erased: true },
      });
      expect(r.pd_erased_at).toBeInstanceOf(Date);
      expect(r.closed_at).toBeInstanceOf(Date);
    });

    it("EARS-12: the 010 ledger row of an investor intake carries the contact, payload and subject line masked, never their values", async () => {
      const id = await accepted(body());
      const { rows } = await pool.query<{
        metadata: { diff: Record<string, unknown> };
      }>(
        `SELECT metadata FROM audit_ledger
          WHERE event_type = 'data.applications.insert'
            AND metadata -> 'pk' ->> 'id' = $1`,
        [id],
      );
      expect(rows.length).toBeGreaterThan(0);
      const diff = rows[0]!.metadata.diff;
      expect(diff["contact"]).toEqual({ masked: true });
      expect(diff["payload"]).toEqual({ masked: true });
      expect(diff["subject_line"]).toEqual({ masked: true });
      expect(JSON.stringify(rows)).not.toContain(ORGANISATION);
    });
  },
);
