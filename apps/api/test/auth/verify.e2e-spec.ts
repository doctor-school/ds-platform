import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { VerifyResponseSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";

// Verification (EARS-3, email-only per #202): a correct email OTP code flips
// `email_verified` via Zitadel; an invalid/expired code returns a generic failure
// and leaves the flag unchanged. Registration is email-primary, so there is no
// phone verification at registration (EARS-4 is a future post-registration
// secondary-identifier concern). Real Postgres + fake IdP (the fake treats
// FAKE_VALID_CODE as the only correct code).
describe.skipIf(!process.env.DATABASE_URL)("Verify (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  // The audit_ledger is append-only (DELETE trigger-blocked) and the fake's
  // `fake-sub-N` numbering repeats across runs, so EARS-25's ledger assertions are
  // scoped to rows appended after a per-test DB-clock marker ({@link dbNow}).
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const runId = Date.now();
  const createdEmails: string[] = [];

  async function register(payload: Record<string, unknown>): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { password: "Aa1!ufficiently-long-pw", consent, ...payload },
    });
    expect(res.statusCode).toBe(200);
  }

  /** Current DB clock — a per-test lower bound for ledger-delta assertions. */
  async function dbNow(): Promise<string> {
    return (await pool.query<{ now: string }>("SELECT now() AS now")).rows[0]!
      .now;
  }

  /** Count `auth.otp.sent` ledger rows appended at/after `after`. */
  async function otpSentCountSince(after: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_ledger
       WHERE event_type = 'auth.otp.sent' AND created_at >= $1`,
      [after],
    );
    return Number(rows[0]!.count);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IDP_CLIENT)
      .useValue(new FakeIdpClient())
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-3: when a registrant submits the correct email code, the system shall verify it via Zitadel and flip email_verified on the mirror", async () => {
    const email = `ears3-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { email, code: FAKE_VALID_CODE },
    });

    expect(res.statusCode).toBe(200);
    expect(VerifyResponseSchema.parse(res.json()).status).toBe("verified");

    const { rows } = await pool.query(
      "SELECT email_verified FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].email_verified).toBe(true);
  });

  it("EARS-3: when a registrant submits an invalid/expired email code, the system shall return a generic failure and leave email_verified unchanged", async () => {
    const email = `ears3-bad-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { email, code: "000000" },
    });

    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query(
      "SELECT email_verified FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].email_verified).toBe(false);
  });

  // #202: EARS-4 phone verification at registration is REMOVED — registration is
  // email-primary, so there is no phone to verify at registration. Phone
  // verification becomes a future post-registration secondary-identifier path.

  // EARS-25 (#319): resend the registration email verification code,
  // enumeration-safely. A code is re-issued ONLY for an existing, UNVERIFIED
  // registrant; an unknown or already-verified identifier is a silent no-op with
  // an IDENTICAL ack/status/timing (EARS-16) and NO ledger row.
  async function resend(identifier: string) {
    return app.inject({
      method: "POST",
      url: "/v1/auth/verify/resend",
      payload: { identifier },
    });
  }

  it("EARS-25: when an existing, unverified registrant requests a resend, the system shall re-issue the code and append exactly one auth.otp.sent row", async () => {
    const email = `ears25-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email }); // unverified (no /verify call)
    const marker = await dbNow();

    const res = await resend(email);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "resend_requested" });
    // Exactly one terminal otp.sent row for the actual re-issue (EARS-18).
    expect(await otpSentCountSince(marker)).toBe(1);
    // The mirror row is untouched (no users/consent write): still unverified.
    const { rows } = await pool.query(
      "SELECT email_verified FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].email_verified).toBe(false);
  });

  it("EARS-25/16: an unknown identifier yields the IDENTICAL ack with no code and no ledger row", async () => {
    const email = `ears25-known-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });
    const unknown = `ears25-nobody-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;

    const markerKnown = await dbNow();
    const forKnown = await resend(email);
    const markerUnknown = await dbNow();
    const forUnknown = await resend(unknown);

    // Enumeration-resistant: same status AND same body (EARS-16).
    expect(forKnown.statusCode).toBe(200);
    expect(forUnknown.statusCode).toBe(forKnown.statusCode);
    expect(forUnknown.json()).toEqual(forKnown.json());
    expect(forKnown.json()).toEqual({ status: "resend_requested" });
    // The existing+unverified resend wrote a row; the unknown one wrote none.
    expect(await otpSentCountSince(markerKnown)).toBeGreaterThanOrEqual(1);
    expect(await otpSentCountSince(markerUnknown)).toBe(0);
  });

  it("EARS-25/16: an ALREADY-VERIFIED registrant yields the IDENTICAL ack with no code and no ledger row", async () => {
    const email = `ears25-verified-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });
    // Complete EARS-3 verification first → the registrant is now verified.
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { email, code: FAKE_VALID_CODE },
    });
    expect(verify.statusCode).toBe(200);

    const marker = await dbNow();
    const res = await resend(email);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "resend_requested" });
    // A verified registrant has no pending verification — no send, no row.
    expect(await otpSentCountSince(marker)).toBe(0);
  });
});
