import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { RegisterResponseSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import {
  IDP_CLIENT,
  IdpInvalidArgumentError,
  IdpPasswordPolicyError,
  IdpUnavailableError,
} from "../../src/auth/idp/idp.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";

// Registration cascade (EARS-1, email-primary per #202), the consent gate
// (EARS-20), and enumeration resistance (EARS-16). Runs against a real Postgres
// (the `api-e2e` CI job + the local dev-stand) with the IdP port bound to the
// in-memory fake — the credential side is Zitadel's (design §2) and is not
// reachable in the shared CI unit job, so the domain logic is proven here.
describe.skipIf(!process.env.DATABASE_URL)("Register (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const runId = Date.now();
  const createdEmails: string[] = [];
  const createdPhones: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  // E.164-valid (≤15 digits): "+1999" + 8 random digits = 12 digits. Random so
  // parallel test files sharing the dev-stand DB do not collide on the unique
  // phone constraint.
  function uniquePhone(): string {
    const phone = `+1999${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    createdPhones.push(phone);
    return phone;
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
    for (const phone of createdPhones.splice(0))
      await pool.query("DELETE FROM users WHERE phone = $1", [phone]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-1: when a visitor registers with a valid email + password, the system shall create the user, record consent, upsert a doctor_guest mirror, and respond enumeration-safely", async () => {
    const email = uniqueEmail("1");
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "Aa1!ufficiently-long-pw", consent },
    });

    expect(res.statusCode).toBe(200);
    const body = RegisterResponseSchema.parse(res.json());
    expect(body.status).toBe("pending_verification");

    const { rows } = await pool.query(
      "SELECT role, email_verified, zitadel_sub FROM users WHERE email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("doctor_guest");
    expect(rows[0].email_verified).toBe(false);

    const consentRows = await pool.query(
      "SELECT purpose, version FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1",
      [email],
    );
    expect(consentRows.rows).toEqual([{ purpose: "tos", version: "2026-01" }]);
  });

  it("EARS-2 (#202): a phone-only register attempt is a handled enumeration-safe failure, NOT a 500, and creates no account", async () => {
    // Email is the primary (and only) registration identifier — Zitadel cannot
    // create a login-capable human without an email. A phone-only register is
    // rejected by the DTO (RegisterRequestSchema requires email) → a generic 400
    // ValidationPipe error, never a 500 and never an oracle. (The fake/real
    // create-time parity — a no-email createUser → IdpInvalidArgumentError → the
    // service's generic 4xx — is exercised by the dedicated suite below, which
    // bypasses the DTO to drive createUser directly.)
    const phone = uniquePhone();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { phone, password: "Aa1!ufficiently-long-pw", consent },
    });

    expect(res.statusCode).toBe(400);
    expect(res.statusCode).not.toBe(500);
    const { rows } = await pool.query("SELECT 1 FROM users WHERE phone = $1", [
      phone,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("EARS-20: when a registration carries no accepted consent version, the system shall refuse it and commit no PD-bearing mirror row", async () => {
    const email = uniqueEmail("20");
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "Aa1!ufficiently-long-pw", consent: [] },
    });

    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
      email,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("EARS-16: when an already-registered email registers again, the system shall respond indistinguishably and create no duplicate account", async () => {
    const email = uniqueEmail("16");
    const payload = { email, password: "Aa1!ufficiently-long-pw", consent };

    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload,
    });

    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());

    const { rows } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
      email,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("EARS-16: when the identifier exists under a divergent mirror row, the system shall stay enumeration-safe (generic failure, no duplicate)", async () => {
    const email = uniqueEmail("16div");
    // Mirror↔IdP divergence: the mirror already holds this email under one sub,
    // but the fake IdP does not know it and will mint a NEW sub on register —
    // so the insert collides on the email unique constraint, not zitadel_sub.
    await pool.query(
      "INSERT INTO users (zitadel_sub, email, role) VALUES ($1, $2, 'doctor_guest')",
      [`divergent-${runId}`, email],
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "Aa1!ufficiently-long-pw", consent },
    });

    // Generic 400 (not a 500) — indistinguishable from any other failure.
    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query(
      "SELECT zitadel_sub FROM users WHERE email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].zitadel_sub).toBe(`divergent-${runId}`);
  });
});

/**
 * #147 residual race through the full stack. The creation schema mirrors the
 * deployed Zitadel default policy, so a baseline-violating password is rejected
 * at the DTO layer (400 ValidationPipe) before any IdP call. This suite proves
 * the *residual*: a live Zitadel stricter than baseline 400s inside createUser →
 * the adapter raises IdpPasswordPolicyError → the service answers a generic 422
 * "weak password", NOT a 500 and NOT an existence oracle. The IdP port is bound
 * to a fake whose createUser always raises the policy error.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "Register weak-password residual (#147, e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const runId = Date.now();

    class PolicyRejectingIdp extends FakeIdpClient {
      override createUser(): never {
        throw new IdpPasswordPolicyError();
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new PolicyRejectingIdp())
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

    afterAll(async () => {
      await app.close();
    });

    it("#147: a baseline-compliant password the live policy still rejects yields a generic 422, no row, no 500", async () => {
      const email = `weakpw-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        // Baseline-compliant (passes the DTO), so the rejection comes from the IdP
        // path — the residual race, not a DTO ValidationPipe 400.
        payload: { email, password: "Aa1!aaaa", consent },
      });

      expect(res.statusCode).toBe(422);
      const { rows } = await pool.query(
        "SELECT 1 FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(0);
    });

    it("#147: the 422 is identical for any two email registrants (no existence oracle)", async () => {
      // #202: registration is email-only, so both registrants use email (the
      // phone-only variant no longer reaches the IdP — it 400s at the DTO).
      const emailRes = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: `wk-a-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`,
          password: "Aa1!aaaa",
          consent,
        },
      });
      const otherRes = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: `wk-b-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`,
          password: "Aa1!aaaa",
          consent,
        },
      });

      expect(emailRes.statusCode).toBe(422);
      expect(otherRes.statusCode).toBe(422);
      expect(otherRes.json()).toEqual(emailRes.json());
    });
  },
);

/**
 * #202 robustness: a deterministic IdP rejection (or infra fault) inside
 * createUser must NEVER surface as a bare 500. A baseline-compliant request (so it
 * passes the DTO and reaches the IdP path) hits a fake whose createUser raises a
 * typed error; the service maps each to its enumeration-safe response:
 *   - IdpInvalidArgumentError → generic 400 (NOT a 500, NOT an existence oracle).
 *     This is exactly the no-email/phone-only create the real adapter raises, so
 *     this suite is the fake/real parity regression net (a future phone-only
 *     register regression fails here, not only live).
 *   - IdpUnavailableError → 503 "service unavailable" (5xx/net → "unavailable").
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "Register IdP-failure robustness (#202, e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const runId = Date.now();

    class InvalidArgRejectingIdp extends FakeIdpClient {
      override createUser(): never {
        throw new IdpInvalidArgumentError();
      }
    }
    class UnavailableIdp extends FakeIdpClient {
      override createUser(): never {
        throw new IdpUnavailableError();
      }
    }

    async function bootWith(idp: FakeIdpClient): Promise<void> {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(idp)
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
    }

    afterEach(async () => {
      if (app) await app.close();
    });

    it("#202: a deterministic IdP invalid_argument yields a generic 400, no row, NEVER a 500", async () => {
      await bootWith(new InvalidArgRejectingIdp());
      const email = `inv-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password: "Aa1!ufficiently-long-pw", consent },
      });

      expect(res.statusCode).toBe(400);
      expect(res.statusCode).not.toBe(500);
      const { rows } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
        email,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("#202: a genuine IdP infra fault yields a 503, no row, NEVER a 500", async () => {
      await bootWith(new UnavailableIdp());
      const email = `unv-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password: "Aa1!ufficiently-long-pw", consent },
      });

      expect(res.statusCode).toBe(503);
      expect(res.statusCode).not.toBe(500);
      const { rows } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
        email,
      ]);
      expect(rows).toHaveLength(0);
    });

    // NOTE: the no-DB fake/real parity unit assertion (FakeIdpClient.createUser
    // rejects a no-email create with IdpInvalidArgumentError) lives in the unit
    // spec `src/auth/auth.service.spec.ts` — it needs no app/DB, so keeping it
    // here would only risk the shared-app teardown.
  },
);

// #202 OBSOLETES the former "Register phone-verify SMS budget (EARS-14)" suite
// (memory #128: register phone-verify returned pending_verification + counted a
// phoneVerificationSend on a budget refusal). Registration is now email-only, so
// there is no register-time SMS send, no register-time SMS-budget gate, and no
// phoneVerificationSends counter — the suite (and the fake's counter/accessor) are
// removed. The SMS toll-fraud budget still gates the SMS-OTP *login* send
// (login-otp.e2e-spec.ts, EARS-14).

// #1128 single-code registration: the registration cascade delivers the
// create-time code echoed by CreateUser instead of generating a second one via a
// follow-up `/email/resend`. Bound to a fake with an inspectable mailer so the
// end-to-end path proves exactly ONE code email — the create-time code, with no
// regeneration on the happy path, and a graceful fallback to regeneration when a
// create response echoes no code.
describe.skipIf(!process.env.DATABASE_URL)(
  "Register single-code delivery (e2e, #1128)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let mailer: FakeMailer;
    let idp: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const runId = Date.now();
    const emails: string[] = [];

    function freshEmail(tag: string): string {
      const email = `ears1128-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      emails.push(email);
      return email;
    }

    beforeAll(async () => {
      mailer = new FakeMailer();
      idp = new FakeIdpClient(mailer);
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(idp)
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
      for (const email of emails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
      idp.setCreateReturnsCode(true);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-1 (#1128): registration mails the create-time code exactly once and regenerates NO second code", async () => {
      const email = freshEmail("happy");
      const before = mailer.verificationCodeEmails.length;
      const regenBefore = idp.emailVerificationRegenerations();

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password: "Aa1!ufficiently-long-pw", consent },
      });
      expect(res.statusCode).toBe(200);

      const sent = mailer.verificationCodeEmails.slice(before);
      expect(sent).toEqual([{ to: email.toLowerCase(), code: FAKE_VALID_CODE }]);
      // The hinge: no fallback regeneration happened — the single create-time
      // code was delivered, not a second one.
      expect(idp.emailVerificationRegenerations()).toBe(regenBefore);
    });

    it("EARS-1 (#1128): a create response with NO echoed code falls back to the resend regeneration hop and still delivers exactly one code", async () => {
      idp.setCreateReturnsCode(false);
      const email = freshEmail("fallback");
      const before = mailer.verificationCodeEmails.length;
      const regenBefore = idp.emailVerificationRegenerations();

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password: "Aa1!ufficiently-long-pw", consent },
      });
      expect(res.statusCode).toBe(200);

      const sent = mailer.verificationCodeEmails.slice(before);
      expect(sent).toEqual([{ to: email.toLowerCase(), code: FAKE_VALID_CODE }]);
      // Exactly one regeneration for this register (the code-less create fallback).
      expect(idp.emailVerificationRegenerations()).toBe(regenBefore + 1);
    });
  },
);
