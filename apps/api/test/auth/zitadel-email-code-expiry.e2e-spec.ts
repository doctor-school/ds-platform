import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import { SmtpMailer } from "../../src/mailer/smtp-mailer.js";
import { hashIdentifier } from "../../src/auth/session/auth-audit.ledger.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { NOTIFICATION_SUBJECTS } from "../support/notification-subjects.js";

/**
 * 003 EARS-3 / EARS-13 (#2764, replacing the #2696 one-hour stage wait): an
 * email verification code that has really expired is refused generically, the
 * refusal is counted as one masked failed attempt, and the account stays
 * unverified.
 *
 * Every link is the production mechanism: the BFF `/v1/auth/register` →
 * the real Zitadel adapter (`IdpModule` factory, live `IDP_ISSUER`) → the code
 * Zitadel generated and returned → the BFF mailer → Mailpit; the delivered code
 * is aged through the IdP's own `SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE`
 * lifetime in real time, then submitted unchanged to `/v1/auth/verify`.
 * Nothing is fabricated: no clock moves, no stored code is rewritten, no wrong
 * code stands in for the expired one.
 *
 * What makes the wait short is the IdP instance, not the test: the CI `api-e2e`
 * job sets that generator's lifetime on its own throw-away Zitadel to
 * `IDP_VERIFY_EMAIL_CODE_TTL_S` seconds (staging and production carry 3600s,
 * kept by `infra/dev-stand/idp/provision.sh` and read back and logged, not
 * pinned, by the deploy in `tools/deploy/idp-policy.mjs`). This spec
 * reads the lifetime back from the live generator and refuses to run on a
 * supplied number that the IdP does not actually carry.
 *
 * A sibling account's fresh delivered code verifies immediately — the control
 * that attributes the expired refusal to elapsed time, not to a misread code.
 */
const LIVE =
  !!process.env.DATABASE_URL &&
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_VERIFY_EMAIL_CODE_TTL_S;

const MAILPIT_BASE = (
  process.env.MAILPIT_URL ?? "http://truenas.local:8025"
).replace(/\/$/, "");

/** The short lifetime a CI IdP may carry — a dev-stand 3600s is refused. */
const MAX_SHORT_TTL_S = 300;
const EXPIRY_MARGIN_MS = 2000;
const TEST_FALLBACK_PEPPER = "test-only-insecure-audit-identifier-pepper";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function idpBase(): string {
  return process.env.IDP_ISSUER!.replace(/\/$/, "");
}

function idpHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN!}`,
    "content-type": "application/json",
  };
}

/** Read the live generator lifetime in seconds from the IdP admin API. */
async function liveVerifyEmailCodeTtlSeconds(): Promise<number> {
  const res = await fetch(
    `${idpBase()}/admin/v1/secretgenerators/SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE`,
    { headers: idpHeaders(), signal: AbortSignal.timeout(10000) },
  );
  expect(res.status, "live generator read-back").toBe(200);
  const generator = (
    (await res.json()) as {
      secretGenerator?: { expiry?: string; length?: number };
    }
  ).secretGenerator;
  expect(generator?.length, "six-digit emailed code generator").toBe(6);
  const seconds = /^([0-9]+)(?:\.0+)?s$/.exec(generator?.expiry ?? "")?.[1];
  expect(seconds, "live generator expiry in whole seconds").toBeDefined();
  return Number(seconds);
}

/** The newest registration mail to `email` delivered at/after `after`. */
async function deliveredCode(email: string, after: number): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(
      `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const { messages = [] } = (await res.json()) as {
        messages?: Array<{ Created?: string; Subject?: string }>;
      };
      const hit = messages.find(
        (m) =>
          !!m.Created &&
          Date.parse(m.Created) >= after &&
          (m.Subject ?? "").includes(NOTIFICATION_SUBJECTS.verifyEmail),
      );
      const code = hit?.Subject?.slice(0, 6);
      if (code && /^\d{6}$/.test(code)) return code;
    }
    await sleep(1000);
  }
  throw new Error(`No registration code was delivered to ${email}`);
}

describe.skipIf(!LIVE)("Email verification code expiry (live IdP)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let ttlSeconds = 0;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const createdEmails: string[] = [];

  async function register(email: string): Promise<string> {
    createdEmails.push(email);
    // Mailpit's `Created` is second-granular; back off one second so the
    // cutoff never excludes this registration's own mail.
    const after = Date.now() - 1000;
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email,
        password: `Exp-${runId}-aA1!`,
        consent,
      },
    });
    expect(res.statusCode, "registration acknowledged").toBe(200);
    return deliveredCode(email, after);
  }

  async function failedAttempts(email: string) {
    const hash = hashIdentifier(
      email,
      process.env.AUDIT_IDENTIFIER_PEPPER ?? TEST_FALLBACK_PEPPER,
    );
    const { rows } = await pool.query<{
      subject_id: string | null;
      sid: string | null;
      reason: string | null;
      metadata: unknown;
    }>(
      `SELECT subject_id, sid, reason, metadata FROM audit_ledger
       WHERE event_type = 'auth.account.verify_failed'
         AND metadata->>'identifier_hash' = $1`,
      [hash],
    );
    return {
      failed: rows.length,
      masked: rows.every(
        (r) =>
          r.subject_id === null &&
          r.sid === null &&
          r.reason === "invalid" &&
          JSON.stringify(r.metadata) ===
            JSON.stringify({ identifier_hash: hash }),
      ),
    };
  }

  async function emailVerified(email: string): Promise<boolean> {
    const { rows } = await pool.query<{ email_verified: boolean }>(
      "SELECT email_verified FROM users WHERE email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.email_verified;
  }

  function verify(email: string, code: string) {
    return app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { email, code },
    });
  }

  beforeAll(async () => {
    ttlSeconds = await liveVerifyEmailCodeTtlSeconds();
    expect(
      ttlSeconds,
      "the supplied IDP_VERIFY_EMAIL_CODE_TTL_S is the lifetime the live IdP carries",
    ).toBe(Number(process.env.IDP_VERIFY_EMAIL_CODE_TTL_S));
    expect(ttlSeconds).toBeGreaterThan(0);
    expect(ttlSeconds).toBeLessThanOrEqual(MAX_SHORT_TTL_S);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // The production IdP factory builds the real Zitadel adapter from the
      // live IDP_* env; only the mail transport is pointed at Mailpit.
      .overrideProvider(MAILER)
      .useValue(
        new SmtpMailer({
          intercept: {
            host:
              process.env.MAILER_SMTP_HOST ?? new URL(MAILPIT_BASE).hostname,
            port: Number(process.env.MAILER_SMTP_PORT ?? 1025),
          },
          isEnabled: () => false,
        }),
      )
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
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    for (const email of createdEmails) {
      const { rows } = await pool.query<{ zitadel_sub: string | null }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      for (const { zitadel_sub } of rows)
        if (zitadel_sub)
          await fetch(`${idpBase()}/v2/users/${zitadel_sub}`, {
            method: "DELETE",
            headers: idpHeaders(),
            signal: AbortSignal.timeout(5000),
          }).catch(() => undefined);
      await deleteUserFixture(pool, "email", email);
    }
    await app?.close();
  });

  it(
    "EARS-3: when a registrant submits the delivered email code after its real IdP lifetime has elapsed, the system shall refuse it generically, record exactly one masked failed attempt and leave the account unverified",
    async () => {
      const expiring = `ears3-expiry-${runId}@ds.test`;
      const control = `ears3-expiry-control-${runId}@ds.test`;

      const code = await register(expiring);
      const delivered = performance.now();
      const controlCode = await register(control);

      // Control: the generic refusal of a guaranteed-wrong code, then the
      // fresh delivered code verifying — the read path is the real one.
      const wrong = await verify(
        control,
        controlCode === "000000" ? "111111" : "000000",
      );
      expect(wrong.statusCode).toBe(400);
      const fresh = await verify(control, controlCode);
      expect(fresh.statusCode, "a fresh delivered code verifies").toBe(200);
      expect(await emailVerified(control)).toBe(true);

      expect(await failedAttempts(expiring)).toEqual({
        failed: 0,
        masked: true,
      });
      expect(await emailVerified(expiring)).toBe(false);

      const waitMs = ttlSeconds * 1000 + EXPIRY_MARGIN_MS;
      const remaining = waitMs - (performance.now() - delivered);
      if (remaining > 0) await sleep(remaining);
      const elapsedMs = performance.now() - delivered;
      expect(elapsedMs, "the complete live lifetime elapsed").toBeGreaterThan(
        ttlSeconds * 1000,
      );

      // The same delivered code, unchanged — never a wrong code standing in.
      const expired = await verify(expiring, code);
      expect(expired.statusCode).toBe(400);
      expect(
        expired.json(),
        "the expiry refusal is the same generic failure as a wrong code",
      ).toEqual(wrong.json());
      expect(expired.headers["set-cookie"]).toBeUndefined();

      expect(await failedAttempts(expiring)).toEqual({
        failed: 1,
        masked: true,
      });
      expect(await emailVerified(expiring)).toBe(false);
    },
    (MAX_SHORT_TTL_S + 120) * 1000,
  );
});
