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
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  describeTiming,
  medianSpread,
  sampleInterleaved,
} from "../support/timing-oracle.js";
import {
  Jar,
  lastHostSession,
  openHostForm,
  postHostForm,
  storefrontSession,
  withSignInHost,
} from "../setup/storefront-harness.js";

// Verification (EARS-3, email-only per #202): a correct email OTP code flips
// `email_verified` via Zitadel; an invalid/expired code returns a generic failure
// and leaves the flag unchanged. Registration is email-primary, so there is no
// phone verification at registration (EARS-4): a phone is confirmed only after
// registration, from a session, through the confirmed-phone path (EARS-47/48),
// and the two channels never confirm each other. Real Postgres + fake IdP (the
// fake treats FAKE_VALID_CODE as the only correct code). The code step runs on
// the sign-in host's Academy registration code command (`verifyStep`).
describe.skipIf(!process.env.DATABASE_URL)("Verify (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  // The audit_ledger is append-only (DELETE trigger-blocked) and the fake's
  // `fake-sub-N` numbering repeats across runs, so EARS-25's ledger assertions are
  // scoped to rows appended after a per-test DB-clock marker ({@link dbNow}).
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const runId = Date.now();
  const createdEmails: string[] = [];
  const fake = new FakeIdpClient();

  async function register(payload: Record<string, unknown>): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { password: "Aa1!ufficiently-long-pw", consent, ...payload },
    });
    expect(res.statusCode).toBe(200);
  }

  /** The host's Academy code step on a fresh form (or `form` in `jar`). */
  async function verify(
    email: string,
    code: string,
    opts: {
      device?: Record<string, string>;
      jar?: Jar;
      form?: { authRequest: string; csrf: string };
    } = {},
  ) {
    const jar = opts.jar ?? new Jar();
    const form = opts.form ?? (await openHostForm(app, jar, opts));
    return postHostForm(
      app,
      jar,
      "verify",
      { email, code, ...form },
      opts.device,
    );
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
    const moduleRef: TestingModule = await withSignInHost(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT),
    ).compile();

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
      await deleteUserFixture(pool, "email", email);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-3: when a registrant submits the correct email code, the system shall verify it via Zitadel and flip email_verified on the mirror", async () => {
    const email = `ears3-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });

    const res = await verify(email, FAKE_VALID_CODE);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "redirect" });

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

    const res = await verify(email, "000000");

    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query(
      "SELECT email_verified FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].email_verified).toBe(false);
  });

  it("EARS-4: registration verification is email-only — the email code never confirms a phone, and the post-registration phone confirmation never touches email verification", async () => {
    const email = `ears4-${runId}@ds.test`;
    const phone = `+7999${String(runId).slice(-7)}`;
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    createdEmails.push(email);

    // Registration asks for no phone code: nothing reaches the SMS channel.
    const smsBefore = fake.phoneCodeRequests.length;
    await register({ email });
    expect(fake.phoneCodeRequests).toHaveLength(smsBefore);

    const mirror = async () =>
      (
        await pool.query<{
          zitadel_sub: string;
          email_verified: boolean;
          phone: string | null;
          phone_verified: boolean;
        }>(
          `SELECT zitadel_sub, email_verified, phone, phone_verified
             FROM users WHERE email = $1`,
          [email],
        )
      ).rows[0]!;
    const verifiedRowsSince = async (sub: string, after: string) =>
      Number(
        (
          await pool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM audit_ledger
              WHERE event_type = 'auth.account.verified'
                AND subject_id = $1 AND created_at >= $2`,
            [sub, after],
          )
        ).rows[0]!.count,
      );
    const { zitadel_sub: sub } = await mirror();

    // The IdP holds a number on the registrant, unverified (as a console-added
    // phone would be). The email code verifies the email and never that phone.
    await fake.setPhone(sub, phone, "none");
    const verifyRes = await verify(email, FAKE_VALID_CODE, { device });
    expect(verifyRes.statusCode).toBe(200);
    expect(await fake.getUser(sub)).toMatchObject({
      emailVerified: true,
      phoneVerified: false,
    });
    expect(await mirror()).toMatchObject({
      email_verified: true,
      phone: null,
      phone_verified: false,
    });

    // After registration, from the storefront session the code step's record
    // redeems, the phone is confirmed only through the confirmed-phone path —
    // which writes the phone and nothing else.
    const sid = await storefrontSession(
      app,
      lastHostSession(app),
      "academy",
      device,
    );
    const headers = {
      ...device,
      cookie: `${SESSION_COOKIE_NAME}=${sid}`,
    };
    const since = await dbNow();
    const request = await app.inject({
      method: "POST",
      url: "/v1/me/phone",
      headers,
      payload: { phone },
    });
    expect(request.statusCode).toBe(200);
    expect(fake.phoneCodeRequests.at(-1)).toEqual({
      sub,
      phone,
      delivery: "sms",
    });
    const confirm = await app.inject({
      method: "POST",
      url: "/v1/me/phone/confirm",
      headers,
      payload: { code: FAKE_VALID_CODE },
    });
    expect(confirm.statusCode).toBe(200);
    expect(await mirror()).toMatchObject({
      email_verified: true,
      phone,
      phone_verified: true,
    });
    expect(await fake.getUser(sub)).toMatchObject({
      emailVerified: true,
      phoneVerified: true,
    });
    // The phone channel emits no email-verification terminal row.
    expect(await verifiedRowsSince(sub, since)).toBe(0);
  });

  // EARS-25 (#319): resend the registration email verification code,
  // enumeration-safely (003 EARS-25 amended). The code that fits the account
  // state is re-issued — the verification code for an unverified account, the
  // login code for a verified one; an unknown identifier is a silent no-op. The
  // ack/status/timing are IDENTICAL (EARS-16); a ledger row only for an issue.
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

  it("EARS-25: when a VERIFIED account requests a resend, the system shall issue a fresh login code under the IDENTICAL ack and append exactly one auth.otp.sent row", async () => {
    const email = `ears25-verified-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });
    // Complete EARS-3 verification first → the registrant is now verified.
    const verified = await verify(email, FAKE_VALID_CODE);
    expect(verified.statusCode).toBe(200);

    const marker = await dbNow();
    const res = await resend(email);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "resend_requested" });
    // 003 EARS-25 (amended): the code that fits a verified account is the LOGIN
    // code — one issue, one row; the code step's resend is never a dead end.
    expect(await otpSentCountSince(marker)).toBe(1);
    // The fresh code signs in through the same code submission.
    const signIn = await verify(email, FAKE_VALID_CODE);
    expect(signIn.statusCode).toBe(200);
  });

  // 003 EARS-41 + Invariants (code submission ≤ 50 ms): a wrong code yields the
  // same generic failure — status, body AND timing — for an unknown, a verified
  // and an unverified account, so the code step is no existence oracle. Same
  // pattern and budget as the login-code triad (login-otp.e2e-spec, EARS-34/16).
  it("EARS-41: a wrong code is byte-identical in status, body, AND timing across {unknown, verified, unverified}", async () => {
    const unverified = `ears41-unver-${runId}@ds.test`;
    const verified = `ears41-ver-${runId}@ds.test`;
    const unknown = `ears41-nobody-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(unverified, verified);
    await register({ email: unverified });
    await register({ email: verified });
    const flip = await verify(verified, FAKE_VALID_CODE);
    expect(flip.statusCode).toBe(200);

    // A well-formed code that is not the issued one: it passes the format
    // check and reaches the account-state check, so every class walks its
    // own existence branch (a malformed code is refused before any lookup).
    const WRONG_CODE = "000000";
    // One open host form per class; only the code post is timed.
    const forms = new Map<
      string,
      { jar: Jar; form: { authRequest: string; csrf: string } }
    >();
    for (const email of [unknown, verified, unverified]) {
      const jar = new Jar();
      forms.set(email, { jar, form: await openHostForm(app, jar) });
    }
    async function wrongCode(email: string) {
      const t0 = performance.now();
      const res = await verify(email, WRONG_CODE, forms.get(email));
      const ms = performance.now() - t0;
      return { status: res.statusCode, body: res.json(), ms };
    }
    // Round-robin samples per class (unknown, verified, unverified, …) after
    // one discarded warm-up round; the band bounds the class MEDIANS so a lone
    // scheduler spike on a shared runner cannot decide the verdict (#2152).
    const timing = await sampleInterleaved(
      [unknown, verified, unverified].map((email) => () => wrongCode(email)),
    );
    console.info(
      `EARS-41 unknown/verified/unverified: ${describeTiming(timing)} ms`,
    );
    const results = timing.flatMap((c) => c.results);
    const reference = results[0]!;
    for (const r of results) {
      expect(r.status).toBe(reference.status);
      expect(r.body).toEqual(reference.body);
    }
    expect(reference.status).toBe(400);
    // 003 EARS-41/16: retain the native minimum as well as the median budget;
    // the route's production floor is covered by verify-timing.spec.ts.
    expect(medianSpread(timing)).toBeLessThanOrEqual(50);
    for (const r of results) expect(r.ms).toBeGreaterThanOrEqual(30);
  }, 30_000); // 003 EARS-41: 18 samples at the production one-second route floor.
});
