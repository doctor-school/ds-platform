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
import {
  AuthorApplicationIntakeResultSchema,
  PARTNERSHIP_CONSENT_VERSION_TAG,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
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
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/**
 * 033 EARS-11, EARS-12 — the after-commit team notification and the receipt
 * (#4029) through the REAL intake routes on the REAL module: the recipients
 * are the active `platform_admin` accounts read at send time, the outcome
 * lands on the row, and no outcome — a mailer failure, no recipient at all —
 * changes the intake's `201`.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL
 * or IDP_ISSUER is absent so the shared CI unit job stays green.
 */

class StubBotProtection implements BotProtection {
  static readonly GOOD = "good-captcha";
  verify(token: string): Promise<BotProtectionResult> {
    return Promise.resolve(
      token === StubBotProtection.GOOD
        ? { ok: true }
        : { ok: false, reason: "rejected" },
    );
  }
}

const CONSENT_VERSION = (() => {
  const document = loadDocument("consent-author-application");
  if (!document)
    throw new Error("the author consent document is not published");
  const digest = createHash("sha256").update(document.body).digest("hex");
  return `${document.frontmatter.edition}.sha256-${digest}`;
})();

const ACADEMY_ORIGIN = "https://academy.ds.test";
const ADMIN_ORIGIN = "https://admin.ds.test";
const TOPIC = "Секретная тема о гонартрозе";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "033 EARS-11, EARS-12 — application notifications (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const savedOrigin = process.env.ACADEMY_PUBLIC_ORIGIN;

    type Account = {
      headers: Record<string, string>;
      userId: string;
      sub: string;
      email: string;
    };

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
      const { rows } = await pool.query<{ id: string; zitadel_sub: string }>(
        "SELECT id, zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      return {
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${sid}` },
        userId: rows[0]!.id,
        sub: rows[0]!.zitadel_sub,
        email,
      };
    }

    const submitAuthor = (a: Account) =>
      app.inject({
        method: "POST",
        url: "/v1/me/applications/author",
        headers: {
          ...a.headers,
          "idempotency-key": randomUUID(),
          "x-smartcaptcha-token": StubBotProtection.GOOD,
        },
        payload: {
          topic: TOPIC,
          format: "course_series",
          about: "Практикующий ортопед",
          consentVersion: CONSENT_VERSION,
        },
      });

    const submitPartnership = (contact: string) =>
      app.inject({
        method: "POST",
        url: "/v1/public/applications/partnership",
        headers: {
          "idempotency-key": randomUUID(),
          "x-smartcaptcha-token": StubBotProtection.GOOD,
        },
        payload: {
          name: "Анна Петрова",
          companyOrClinic: "Клиника «Здоровье»",
          contact,
          role: "Партнёр",
          consentVersion: PARTNERSHIP_CONSENT_VERSION_TAG,
        },
      });

    /** The row once both after-commit sends have recorded their outcome. */
    async function settled(id: string) {
      const deadline = Date.now() + 4_000;
      for (;;) {
        const { rows } = await pool.query<{
          team_notice: string;
          receipt_notice: string;
          submitted_at: Date;
        }>(
          "SELECT team_notice, receipt_notice, submitted_at FROM applications WHERE id = $1",
          [id],
        );
        const r = rows[0]!;
        if (r.team_notice !== "pending" && r.receipt_notice !== "pending")
          return r;
        if (Date.now() > deadline)
          throw new Error(
            `notices of ${id} still pending: ${JSON.stringify(r)}`,
          );
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const teamNoticesOf = (id: string) =>
      mailer.applicationTeamNotices.filter((n) => n.adminUrl.endsWith(id));

    beforeAll(async () => {
      process.env.ACADEMY_PUBLIC_ORIGIN = ACADEMY_ORIGIN;
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
      if (savedOrigin === undefined) delete process.env.ACADEMY_PUBLIC_ORIGIN;
      else process.env.ACADEMY_PUBLIC_ORIGIN = savedOrigin;
      if (pool)
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
      await app?.close();
    });

    // The fake IdP starts with no grants: this runs before any admin exists.
    it("EARS-11: when an application is committed and no active platform_admin exists, system shall record skipped and still answer 201", async () => {
      const a = await account("notice-skip");
      const res = await submitAuthor(a);
      expect(res.statusCode, res.payload).toBe(201);
      const { id } = AuthorApplicationIntakeResultSchema.parse(res.json());
      expect((await settled(id)).team_notice).toBe("skipped");
      expect(teamNoticesOf(id)).toEqual([]);
    });

    it("EARS-11: when an application of any kind is committed, system shall send one team email to every active platform_admin carrying only kind, time and admin link, and record sent", async () => {
      const admin = await account("notice-admin");
      await fake.grantProjectRole(admin.sub, "platform_admin");
      // A platform_admin the IdP reported inactive is not an active account.
      const gone = await account("notice-admin-gone");
      await fake.grantProjectRole(gone.sub, "platform_admin");
      await pool.query(
        "UPDATE users SET deactivated_at = now() WHERE id = $1",
        [gone.userId],
      );

      const a = await account("notice-author");
      const res = await submitAuthor(a);
      expect(res.statusCode, res.payload).toBe(201);
      const { id } = AuthorApplicationIntakeResultSchema.parse(res.json());
      const r = await settled(id);
      expect(r.team_notice).toBe("sent");
      const sent = teamNoticesOf(id);
      expect(sent).toEqual([
        {
          email: admin.email,
          to: admin.email.toLowerCase(),
          kindLabel: "Автор",
          submittedAt: r.submitted_at,
          adminUrl: `${ADMIN_ORIGIN}/applications/${id}`,
        },
      ]);
      expect(JSON.stringify(sent)).not.toContain(TOPIC);

      const contact = `partner-${randomUUID()}@company.test`;
      const p = await submitPartnership(contact);
      expect(p.statusCode, p.payload).toBe(201);
      const pid = (p.json() as { id: string }).id;
      expect(await settled(pid)).toMatchObject({
        team_notice: "sent",
        receipt_notice: "not_applicable",
      });
      expect(teamNoticesOf(pid)).toHaveLength(1);
      expect(teamNoticesOf(pid)[0]!.kindLabel).toBe("Партнёрство");
      expect(JSON.stringify(teamNoticesOf(pid))).not.toContain(contact);
      expect(mailer.applicationReceipts.some((m) => m.to === contact)).toBe(
        false,
      );
    });

    it("EARS-11: when the team email fails, system shall keep the row, record failed and still answer 201", async () => {
      const a = await account("notice-team-fail");
      mailer.failNextApplicationTeamNotice(new Error("relay down"));
      const res = await submitAuthor(a);
      expect(res.statusCode, res.payload).toBe(201);
      const { id } = AuthorApplicationIntakeResultSchema.parse(res.json());
      expect((await settled(id)).team_notice).toBe("failed");
    });

    it("EARS-12: when an author application is committed, system shall send one receipt to the account email with the Academy projects link and record sent", async () => {
      const a = await account("notice-receipt");
      const res = await submitAuthor(a);
      expect(res.statusCode, res.payload).toBe(201);
      const { id } = AuthorApplicationIntakeResultSchema.parse(res.json());
      expect((await settled(id)).receipt_notice).toBe("sent");
      const receipts = mailer.applicationReceipts.filter(
        (m) => m.to === a.email.toLowerCase(),
      );
      expect(receipts).toEqual([
        {
          email: a.email,
          to: a.email.toLowerCase(),
          projectsUrl: `${ACADEMY_ORIGIN}/projects`,
        },
      ]);
    });

    it("EARS-12: when the receipt fails, system shall keep the row, record failed and still answer 201", async () => {
      const a = await account("notice-receipt-fail");
      mailer.failNextApplicationReceipt(new Error("relay down"));
      const res = await submitAuthor(a);
      expect(res.statusCode, res.payload).toBe(201);
      const { id } = AuthorApplicationIntakeResultSchema.parse(res.json());
      expect((await settled(id)).receipt_notice).toBe("failed");
      const { rows } = await pool.query(
        "SELECT 1 FROM applications WHERE id = $1",
        [id],
      );
      expect(rows).toHaveLength(1);
    });
  },
);
