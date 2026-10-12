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
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  DEFAULT_SMS_BUDGET_THRESHOLDS,
  SMS_BUDGET_THRESHOLDS,
} from "../../src/auth/sms-budget/sms-budget.types.js";
import { hashIdentifier } from "../../src/auth/session/auth-audit.ledger.js";
import {
  describeTiming,
  medianSpread,
  sampleInterleaved,
} from "../support/timing-oracle.js";

/** Every EARS-14 window opened: the e2e cases send from one address. */
const OPEN_SMS_BUDGET = {
  ...DEFAULT_SMS_BUDGET_THRESHOLDS,
  perPhonePerHour: 1_000_000,
  perIpPerHour: 1_000_000,
  perAsnPerHour: 1_000_000,
  globalPerDay: 1_000_000,
};

// Password reset over HTTP (EARS-11 initiate, EARS-12 complete) — the controller
// wiring on top of the IdP-port + session-layer logic. EARS-11's contract is an
// enumeration-resistant response (identical for existing vs unknown identifier);
// EARS-12's is "new password set + every existing session revoked", which is
// observable over HTTP by establishing two sessions for the same user and
// asserting both cookies stop authenticating after the reset completes. The
// `PasswordResetCompleted` audit event lives only in the in-memory sink, so its
// emission is asserted at the service altitude (session.service.spec.ts), not here.
describe.skipIf(!process.env.DATABASE_URL)("Password reset (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const password = "Aa1!ufficiently-long-pw";
  const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
  const createdEmails: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears1112-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  async function register(email: string): Promise<void> {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password, consent },
    });
    expect(reg.statusCode).toBe(200);
  }

  /** Log in with a given password; return the session cookie value. */
  async function login(email: string, pw: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password: pw },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    return cookie!.value;
  }

  /** Whether a session cookie still resolves to an authenticated principal. */
  async function authenticates(cookieValue: string): Promise<boolean> {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    return res.statusCode === 200;
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
      await deleteUserFixture(pool, "email", email);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-11: when a user requests a password reset for an identifier, the system shall respond identically whether or not the identifier exists", async () => {
    const known = uniqueEmail("known");
    await register(known);
    const unknown = `ears1112-nobody-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;

    const forKnown = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: known },
    });
    const forUnknown = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: unknown },
    });

    // Enumeration-resistant: same status code AND same body for the existing and
    // the never-registered identifier — the response discloses nothing (EARS-16).
    expect(forKnown.statusCode).toBe(200);
    expect(forUnknown.statusCode).toBe(forKnown.statusCode);
    expect(forUnknown.json()).toEqual(forKnown.json());
    expect(forKnown.json()).toEqual({ status: "reset_requested" });
  });

  it("EARS-12: when a user submits a valid reset code and a policy-conforming new password, the system shall set the new password and revoke all existing sessions", async () => {
    const email = uniqueEmail("complete");
    await register(email);

    // Two concurrent sessions for the same user (e.g. two devices) — both live.
    const cookieA = await login(email, password);
    const cookieB = await login(email, password);
    expect(await authenticates(cookieA)).toBe(true);
    expect(await authenticates(cookieB)).toBe(true);

    // Initiate, then complete the reset with the IdP's valid code + a new password.
    await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: email },
    });
    const newPassword = "Brand-new-password-9!";
    const complete = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset/complete",
      headers: device,
      payload: { identifier: email, code: FAKE_VALID_CODE, newPassword },
    });
    expect(complete.statusCode).toBe(200);
    // Token-free body invariant (EARS-8): the status is unchanged…
    expect(complete.json()).toEqual({ status: "reset_completed" });

    // Every PRIOR session is revoked: neither earlier cookie still authenticates.
    expect(await authenticates(cookieA)).toBe(false);
    expect(await authenticates(cookieB)).toBe(false);

    // #221 (EARS-12): the reset ALSO auto-logs-in — it sets a fresh __Host- session
    // cookie that authenticates immediately (no detour through /login).
    const minted = complete.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(minted).toBeDefined();
    expect(await authenticates(minted!.value)).toBe(true);

    // The new password was set at the IdP: it logs in; the old one no longer does.
    const fresh = await login(email, newPassword);
    expect(await authenticates(fresh)).toBe(true);
    const stale = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    expect(stale.statusCode).toBe(401);
  });

  it("EARS-12: an invalid or expired reset code is refused with a generic failure", async () => {
    const email = uniqueEmail("badcode");
    await register(email);
    await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: email },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset/complete",
      headers: device,
      payload: {
        identifier: email,
        code: "000000",
        // Policy-conforming (#147) so the DTO passes and the *bad code* is the
        // rejection reason under test, not a password-complexity 400.
        newPassword: "Another-pw-1!",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

// 003 EARS-35 (#1131): a completed password reset is proof-of-mailbox-ownership —
// the reset code was delivered to that email (§14) and the caller returned it — so
// the SAME successful complete marks the account's email verified at the IdP,
// mirrored onto the users row, and appends the terminal `auth.account.verified`
// (channel email) audit row. This closes the stuck-unverified trap through the
// existing recovery path: a subject who never verified at registration can, after
// the reset, obtain a login code via EARS-6/EARS-34. No state is mutated before a
// valid token (OWASP): a bad/expired code flips nothing. Runs against a real
// Postgres with the IdP fake wired to a FakeMailer.
describe.skipIf(!process.env.DATABASE_URL)(
  "Password reset — proof-of-mailbox email verify (e2e, 003 EARS-35)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const runId = Date.now();
    const createdEmails: string[] = [];

    function uniqueEmail(tag: string): string {
      const email = `ears35-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function register(email: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(res.statusCode).toBe(200);
    }

    /**
     * The **ledger's own clock**, not the test process's. Every assertion windows
     * on `created_at`, which Postgres stamps — and on a dev stand that Postgres
     * lives on another host, tens of ms off, so a `new Date()` fence is a
     * knife-edge the DB writes on the wrong side of.
     */
    async function dbNow(): Promise<Date> {
      const { rows } = await pool.query<{ t: Date }>("SELECT now() AS t");
      return rows[0]!.t;
    }

    async function resetAndComplete(
      email: string,
      code: string,
    ): Promise<number> {
      await app.inject({
        method: "POST",
        url: "/v1/auth/password/reset",
        headers: device,
        payload: { identifier: email },
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/password/reset/complete",
        headers: device,
        payload: { identifier: email, code, newPassword: "Brand-new-pw-9!" },
      });
      return res.statusCode;
    }

    async function subjectFor(email: string): Promise<string> {
      const { rows } = await pool.query(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      return rows[0]?.zitadel_sub as string;
    }

    async function emailVerified(email: string): Promise<boolean> {
      const { rows } = await pool.query(
        "SELECT email_verified FROM users WHERE email = $1",
        [email],
      );
      return rows[0]?.email_verified as boolean;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient(new FakeMailer()))
        .overrideProvider(MAILER)
        .useValue(new FakeMailer())
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
      // `audit_ledger` is append-only (ADR-0003 §2.7 — DELETE is blocked), and the
      // fake's `sub` is deterministic (`fake-sub-N`), so re-runs against the
      // persisted branch DB accumulate rows under the same subject. The
      // auth.account.verified assertion below is therefore scoped by `created_at`
      // to this test's own window; here we only clean the mutable users rows.
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-35: a completed reset on an unverified account flips email_verified (mirror row), appends auth.account.verified (channel email), and unblocks the login-by-code path", async () => {
      const email = uniqueEmail("flip");
      await register(email); // unverified (no /verify)
      expect(await emailVerified(email)).toBe(false);
      const sub = await subjectFor(email);

      // Scope the append-only ledger assertion to this test's window (the fake's
      // sub is deterministic across re-runs; created_at isolates the fresh row).
      // The bound is read from the clock that STAMPS `created_at` — Postgres —
      // because on a dev stand it sits on another host tens of ms off.
      const since = await dbNow();
      expect(await resetAndComplete(email, FAKE_VALID_CODE)).toBe(200);

      // The mirror users row is now verified (EARS-19/26 mirror of the IdP flip).
      expect(await emailVerified(email)).toBe(true);

      // Exactly one terminal auth.account.verified (channel email) row for the flip.
      const { rows } = await pool.query(
        "SELECT metadata FROM audit_ledger WHERE subject_id = $1 AND event_type = 'auth.account.verified' AND created_at >= $2",
        [sub, since],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toMatchObject({ channel: "email" });

      // Unblocked: a subsequent email login-code request now arms the otp_email
      // challenge (verified branch, EARS-6/34), so the code establishes a session.
      await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: email, channel: "email" },
      });
      const loginRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp",
        payload: { identifier: email, code: FAKE_VALID_CODE, channel: "email" },
      });
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.json()).toEqual({ status: "authenticated" });
    });

    it("EARS-35/16: a failed reset (bad code) mutates nothing — the email verification state is unchanged", async () => {
      const email = uniqueEmail("failflip");
      await register(email);
      expect(await emailVerified(email)).toBe(false);

      // A bad code is the generic 400 (EARS-16) …
      expect(await resetAndComplete(email, "000000")).toBe(400);

      // … and nothing was mutated: the email is still unverified (OWASP).
      expect(await emailVerified(email)).toBe(false);
    });
  },
);

// 003 EARS-53 (#2449): a reset requested with a CONFIRMED phone sends the code
// by SMS through the IdP (the fake records the send; the code never reaches
// the BFF or its mailer); an unknown or unconfirmed phone gets the identical
// response with no SMS and no email, and is counted by EARS-56. EARS-35: an
// SMS code is sent only to an account whose email is already verified, so an
// SMS-completed reset can never verify an unproven mailbox.
describe.skipIf(!process.env.DATABASE_URL)(
  "Password reset by SMS to a confirmed phone (e2e, 003 EARS-53/35/56)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let idp: FakeIdpClient;
    let mailer: FakeMailer;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const runId = `${Date.now()}`;
    const createdEmails: string[] = [];
    const pepper =
      process.env.AUDIT_IDENTIFIER_PEPPER ??
      "test-only-insecure-audit-identifier-pepper";

    function uniqueEmail(tag: string): string {
      const email = `ears53-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function uniquePhone(): string {
      return `+7999${String(Date.now()).slice(-4)}${String(
        Math.floor(Math.random() * 1000),
      ).padStart(3, "0")}`;
    }

    async function account(
      tag: string,
      opts: { verified: boolean; phone?: string },
    ): Promise<{ email: string; sub: string }> {
      const email = uniqueEmail(tag);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      if (opts.verified) {
        const v = await app.inject({
          method: "POST",
          url: "/v1/auth/verify",
          payload: { email, code: FAKE_VALID_CODE },
        });
        expect(v.statusCode).toBe(200);
      }
      const { rows } = await pool.query(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      const sub = rows[0]?.zitadel_sub as string;
      if (opts.phone) idp.attachPhone(sub, opts.phone);
      return { email, sub };
    }

    async function requestReset(
      identifier: string,
    ): Promise<{ status: number; body: unknown; ms: number }> {
      const t0 = performance.now();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/password/reset",
        headers: device,
        payload: { identifier },
      });
      const ms = performance.now() - t0;
      return { status: res.statusCode, body: res.json(), ms };
    }

    /** The reset send runs off the response path; let it settle. */
    async function settle(): Promise<void> {
      await new Promise((r) => setTimeout(r, 150));
    }

    async function emailVerified(email: string): Promise<boolean> {
      const { rows } = await pool.query(
        "SELECT email_verified FROM users WHERE email = $1",
        [email],
      );
      return rows[0]?.email_verified as boolean;
    }

    async function dbNow(): Promise<Date> {
      const { rows } = await pool.query<{ t: Date }>("SELECT now() AS t");
      return rows[0]!.t;
    }

    async function resetRows(
      identifier: string,
    ): Promise<Record<string, unknown>[]> {
      const { rows } = await pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_ledger
          WHERE event_type = 'auth.password.reset_requested'
            AND metadata->>'identifier_hash' = $1`,
        [hashIdentifier(identifier, pepper)],
      );
      return rows.map((r) => r.metadata);
    }

    function resetMailsTo(email: string): number {
      return mailer.passwordResetCodeEmails.filter((m) => m.to === email)
        .length;
    }

    beforeAll(async () => {
      mailer = new FakeMailer();
      idp = new FakeIdpClient(mailer);
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(idp)
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        // Every case sends from one address and the timing case repeats one
        // number; the EARS-14 windows are opened (their refusal is unit-proven).
        .overrideProvider(SMS_BUDGET_THRESHOLDS)
        .useValue(OPEN_SMS_BUDGET)
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
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-53: a reset requested with a confirmed phone texts the code through the IdP, mails nothing, and completing with it sets the password and signs in", async () => {
      const phone = uniquePhone();
      const a = await account("sms", { verified: true, phone });

      const res = await requestReset(phone);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "reset_requested" });
      await settle();
      expect(idp.smsPasswordResetSends()).toContain(phone);
      expect(resetMailsTo(a.email)).toBe(0);
      // EARS-57: one reset row with channel sms for the code actually sent.
      expect(await resetRows(phone)).toEqual([
        expect.objectContaining({ channel: "sms" }),
      ]);

      const done = await app.inject({
        method: "POST",
        url: "/v1/auth/password/reset/complete",
        headers: device,
        payload: {
          identifier: phone,
          code: FAKE_VALID_CODE,
          newPassword: "Brand-new-pw-9!",
        },
      });
      expect(done.statusCode).toBe(200);
      expect(done.json()).toEqual({ status: "reset_completed" });
      expect(
        done.cookies.find((c) => c.name === SESSION_COOKIE_NAME),
      ).toBeDefined();
      expect(await emailVerified(a.email)).toBe(true);
    });

    it("EARS-53/16: an unknown or unconfirmed phone gets the identical response in status, body and timing, with no SMS and no email", async () => {
      const confirmed = uniquePhone();
      const unconfirmed = uniquePhone();
      const unknown = uniquePhone();
      await account("conf", { verified: true, phone: confirmed });
      const u = await account("unconf", { verified: true, phone: unconfirmed });
      idp.setIdentity(u.sub, { phoneVerified: false });
      const sendsBefore = idp.smsPasswordResetSends().length;

      const timing = await sampleInterleaved(
        [confirmed, unconfirmed, unknown].map(
          (identifier) => () => requestReset(identifier),
        ),
      );
      console.info(
        `EARS-53/16 confirmed/unconfirmed/unknown: ${describeTiming(timing)} ms`,
      );
      for (const r of timing.flatMap((c) => c.results)) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ status: "reset_requested" });
      }
      expect(medianSpread(timing)).toBeLessThanOrEqual(50);

      await settle();
      const sent = idp.smsPasswordResetSends().slice(sendsBefore);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((p) => p === confirmed)).toBe(true);
      expect(resetMailsTo(u.email)).toBe(0);
      // EARS-56: no ledger row for a request that sent nothing.
      expect(await resetRows(unconfirmed)).toEqual([]);
      expect(await resetRows(unknown)).toEqual([]);
    });

    it("EARS-53: the email of an account that also holds a confirmed phone still gets the code by mail, and no SMS", async () => {
      const phone = uniquePhone();
      const a = await account("mail", { verified: true, phone });
      const sendsBefore = idp.smsPasswordResetSends().length;

      const res = await requestReset(a.email);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "reset_requested" });
      await settle();
      expect(resetMailsTo(a.email)).toBe(1);
      expect(idp.smsPasswordResetSends().length).toBe(sendsBefore);
    });

    it("EARS-35: a confirmed phone on an account whose email is unverified gets no SMS, so no completion through either identifier can verify that email", async () => {
      // A phone added outside the product (Zitadel console) on an account
      // whose email was never verified. EARS-53 texts a reset code only to an
      // account whose email is verified, so no SMS code exists here: the
      // completion — with the phone or with the account email, which resolve
      // to the same subject and the same per-user IdP code — cannot flip the
      // unproven mailbox.
      const phone = uniquePhone();
      const a = await account("noflip", { verified: false, phone });
      expect(await emailVerified(a.email)).toBe(false);
      const since = await dbNow();
      const sendsBefore = idp.smsPasswordResetSends().length;

      const res = await requestReset(phone);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "reset_requested" });
      await settle();
      expect(idp.smsPasswordResetSends().length).toBe(sendsBefore);
      expect(resetMailsTo(a.email)).toBe(0);
      expect(await resetRows(phone)).toEqual([]);

      for (const identifier of [a.email, phone]) {
        const done = await app.inject({
          method: "POST",
          url: "/v1/auth/password/reset/complete",
          headers: device,
          payload: {
            identifier,
            code: FAKE_VALID_CODE,
            newPassword: "Brand-new-pw-9!",
          },
        });
        expect(done.statusCode).toBe(400);
      }

      expect(await emailVerified(a.email)).toBe(false);
      const { rows } = await pool.query(
        "SELECT 1 FROM audit_ledger WHERE subject_id = $1 AND event_type = 'auth.account.verified' AND created_at >= $2",
        [a.sub, since],
      );
      expect(rows).toEqual([]);
    });
  },
);
