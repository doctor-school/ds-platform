import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 003 EARS-29/30 (#910/#1045): the email-verify (EARS-1/25) and password-reset
// (EARS-11) send hops ride `returnCode` — Zitadel generates/verifies the code
// but SENDS NOTHING; the BFF mailer dispatches the §13.3/§13.4 code-only
// artifact. This suite proves, over the real HTTP surface with the IdP port
// bound to the fake wired to a FakeMailer:
//   • each trigger dispatches EXACTLY ONE BFF-mailer code email (EARS-29);
//   • the no-op paths (unknown / already-verified identifier) obtain no code
//     and send nothing while responding identically (EARS-16);
//   • no send outcome leaks the code into an API response or an
//     `audit_ledger` row (EARS-30).
describe.skipIf(!process.env.DATABASE_URL)("Code-only email delivery (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let mailer: FakeMailer;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const runId = Date.now();
  const createdEmails: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears29-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  beforeAll(async () => {
    mailer = new FakeMailer();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IDP_CLIENT)
      .useValue(new FakeIdpClient(mailer))
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
  });

  afterEach(async () => {
    for (const email of createdEmails.splice(0))
      await pool.query("DELETE FROM users WHERE email = $1", [email]);
    mailer.verificationCodeEmails.length = 0;
    mailer.passwordResetCodeEmails.length = 0;
    mailer.accountExistsNotices.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(email: string) {
    return app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "Aa1!ufficiently-long-pw", consent },
    });
  }

  it("003 EARS-29.1: registration dispatches exactly ONE BFF-mailer verification-code email to the registrant", async () => {
    const email = uniqueEmail("reg");
    const res = await register(email);
    expect(res.statusCode).toBe(200);
    expect(mailer.verificationCodeEmails).toEqual([
      { to: email, code: FAKE_VALID_CODE },
    ]);
    // …and ONLY that artifact: no reset mail, no account-exists notice.
    expect(mailer.passwordResetCodeEmails).toEqual([]);
    expect(mailer.accountExistsNotices).toEqual([]);
  });

  it("003 EARS-29.2: a resend re-issues the code as ONE more BFF-mailer email; an unknown identifier sends nothing, same response", async () => {
    const email = uniqueEmail("resend");
    await register(email);
    expect(mailer.verificationCodeEmails).toHaveLength(1);

    const known = await app.inject({
      method: "POST",
      url: "/v1/auth/verify/resend",
      payload: { identifier: email },
    });
    expect(known.statusCode).toBe(200);
    expect(mailer.verificationCodeEmails).toEqual([
      { to: email, code: FAKE_VALID_CODE },
      { to: email, code: FAKE_VALID_CODE },
    ]);

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/verify/resend",
      payload: { identifier: uniqueEmail("ghost") },
    });
    // Enumeration-resistant: identical body/status, but no email dispatched.
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
    expect(mailer.verificationCodeEmails).toHaveLength(2);
  });

  it("003 EARS-29.3: a reset request dispatches exactly ONE BFF-mailer reset-code email; an unknown identifier sends nothing, same response", async () => {
    const email = uniqueEmail("reset");
    await register(email);
    mailer.verificationCodeEmails.length = 0;

    const known = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { identifier: email },
    });
    expect(known.statusCode).toBe(200);
    expect(mailer.passwordResetCodeEmails).toEqual([
      { to: email, code: FAKE_VALID_CODE },
    ]);
    expect(mailer.verificationCodeEmails).toEqual([]);

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { identifier: uniqueEmail("ghost2") },
    });
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
    expect(mailer.passwordResetCodeEmails).toHaveLength(1);
  });

  it("003 EARS-30: no send outcome leaks the code — API responses and audit_ledger rows never contain it", async () => {
    const email = uniqueEmail("scrub");
    const reg = await register(email);
    const resend = await app.inject({
      method: "POST",
      url: "/v1/auth/verify/resend",
      payload: { identifier: email },
    });
    const reset = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { identifier: email },
    });
    // The code transits the BFF in memory only (EARS-30): it must never be
    // reflected into any HTTP response…
    for (const res of [reg, resend, reset]) {
      expect(res.body).not.toContain(FAKE_VALID_CODE);
    }
    // …nor persisted into the audit ledger for this subject's events (the
    // ledger records THAT a code was sent — `otp.sent` — never the code).
    const { rows } = await pool.query(
      `SELECT event_type, subject_id, sid, reason, metadata::text AS metadata
         FROM audit_ledger
        WHERE subject_id IN (SELECT zitadel_sub FROM users WHERE email = $1)`,
      [email],
    );
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(FAKE_VALID_CODE);
    }
  });
});
