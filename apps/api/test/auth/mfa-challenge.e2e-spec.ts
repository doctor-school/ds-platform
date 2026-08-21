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
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { TOTP_STEP_SECONDS, totpCode } from "../../src/auth/idp/totp.js";
import {
  MFA_LOCKOUT_THRESHOLD,
  MfaLockoutService,
} from "../../src/auth/admin-session/mfa-lockout.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

const ENROLL_START_URL = "/v1/admin/auth/mfa/enroll/start";
const ENROLL_VERIFY_URL = "/v1/admin/auth/mfa/enroll/verify";
const CHALLENGE_URL = "/v1/admin/auth/mfa/verify";
const STATE_URL = "/v1/admin/auth/state";

/**
 * 011 Verification rows 6 + 7 — EARS-6 (TOTP challenge on login) and EARS-7
 * (failure discipline: shared budgets, uniform refusal, soft-lock), plus the
 * `AdminAuthState` read the admin app routes on.
 *
 * Everything load-bearing is asserted **directly against the API** (design §10),
 * never only through the UI: the replay refusal, the "nothing reachable in
 * between" gate, the byte-identity of the failure branches, and the lock beating
 * a correct code are all properties of the HTTP surface, and a browser test that
 * happened to agree would prove none of them.
 *
 * The rate limiter is relaxed here so the EARS-7 **lockout** (a per-subject
 * counter over failed verifies) is what the failure tests exercise; the shared
 * per-user **rate** ceiling gets its own app with production-shaped thresholds in
 * the second describe below, because the two controls are different mechanisms
 * with different keys and a suite that let one mask the other would prove
 * neither.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-6/EARS-7 — TOTP challenge on login + failure discipline (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";

    /**
     * Every principal this suite registers, dropped in `afterEach` — the fake IdP
     * numbers subjects from a per-app counter, so a surviving `users` row
     * collides with the next run's subject on the `zitadel_sub` unique key (the
     * trap `mfa-enroll.e2e-spec.ts` documents).
     */
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1192chal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /**
     * The code an authenticator app will show in the NEXT time step.
     *
     * A TOTP code is single-use within its window (EARS-6), and the enrollment
     * verify burns one — so a challenge in the same 30-second step submitting the
     * same digits is a REPLAY and must be refused. Stepping forward one window
     * asks for a genuinely fresh code, which the ±1-step tolerance accepts, and
     * keeps the happy path deterministic rather than dependent on where in the
     * step the suite happens to run.
     */
    function nextWindowCode(secret: string): string {
      return totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);
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

    async function registerAdmin(email: string): Promise<string> {
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
      await fake.grantProjectRole(sub, "platform_admin");
      return sub;
    }

    /** Primary auth at the admin origin; resolves the pending reference + state. */
    async function primaryAuth(
      email: string,
    ): Promise<{ ref: string; state: string }> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      return {
        ref: res.cookies.find((c) => c.name === ADMIN_PENDING_COOKIE_NAME)!
          .value,
        state: (res.json() as { state: string }).state,
      };
    }

    function pendingHeaders(ref: string): Record<string, string> {
      return { ...ADMIN_DEVICE, cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}` };
    }

    /**
     * A `platform_admin` who has completed the one-time enrollment and is now
     * sitting at a fresh CHALLENGE — the state every login after the first lands
     * in, and the only fixture EARS-6/EARS-7 are about.
     */
    async function enrolledAtChallenge(): Promise<{
      email: string;
      sub: string;
      secret: string;
      ref: string;
    }> {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      const first = await primaryAuth(email);
      expect(first.state).toBe("mfa_pending_enrollment");
      const start = await app.inject({
        method: "POST",
        url: ENROLL_START_URL,
        headers: pendingHeaders(first.ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const secret = (start.json() as { secret: string }).secret;
      const enrolled = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(first.ref),
        payload: { code: totpCode(secret) },
      });
      expect(enrolled.statusCode).toBe(200);

      const second = await primaryAuth(email);
      expect(second.state).toBe("mfa_pending_challenge");
      return { email, sub, secret, ref: second.ref };
    }

    beforeAll(async () => {
      // The fake is BOUND here, never read back off the container: `IdpModule`
      // picks the real `ZitadelIdpClient` whenever `IDP_ISSUER` +
      // `IDP_SERVICE_TOKEN` are configured, which is exactly the case on a
      // developer's dev-stand — so `app.get(IDP_CLIENT)` hands back the live
      // adapter, and the test-only accessors this suite drives do not exist on
      // it. Explicit override = the same suite outcome on CI and on the stand.
      fake = new FakeIdpClient();
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-6.1: an enrolled platform_admin is challenged, and a correct code issues the admin session in place", async () => {
      const { sub, secret, ref } = await enrolledAtChallenge();

      const verify = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(ref),
        payload: { code: nextWindowCode(secret) },
      });

      expect(verify.statusCode).toBe(200);
      expect(verify.json()).toEqual({ state: "active" });
      const session = verify.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      );
      expect(
        session,
        "the challenge must issue the admin session",
      ).toBeDefined();
      expect(session!.value).toBeTruthy();
      // Opaque server-side reference, never a token (EARS-1).
      expect(session!.value.split(".")).toHaveLength(1);
      expect(
        verify.cookies.some((c) => c.name === ADMIN_CSRF_COOKIE_NAME),
      ).toBe(true);
      // The pending reference is consumed — it never coexists with the session.
      expect(
        verify.cookies.find((c) => c.name === ADMIN_PENDING_COOKIE_NAME)?.value,
      ).toBe("");
      // …and that session actually authenticates the admin surface.
      const csrf = verify.cookies.find(
        (c) => c.name === ADMIN_CSRF_COOKIE_NAME,
      )!.value;
      const events = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${session!.value}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
        },
      });
      expect(events.statusCode).toBe(200);
      expect(sub).toBeTruthy();
    });

    it("EARS-6.2: a code accepted once is refused on replay inside its own window", async () => {
      const { secret, email } = await enrolledAtChallenge();
      const code = nextWindowCode(secret);
      const first = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders((await primaryAuth(email)).ref),
        payload: { code },
      });
      expect(first.statusCode).toBe(200);

      // A brand-new login, so nothing about the pending reference is stale — the
      // ONLY thing wrong with this attempt is that the code was already used.
      const replayRef = (await primaryAuth(email)).ref;
      const replay = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(replayRef),
        payload: { code },
      });
      expect(replay.statusCode).toBe(401);
      expect(
        replay.cookies.some((c) => c.name === ADMIN_SESSION_COOKIE_NAME),
      ).toBe(false);
    });

    it("EARS-6.3: no admin route is reachable between primary auth and a satisfied challenge", async () => {
      const { ref } = await enrolledAtChallenge();

      for (const url of [
        "/v1/admin/events",
        "/v1/admin/auth/logout",
        ENROLL_START_URL,
      ]) {
        const res = await app.inject({
          method: url === "/v1/admin/events" ? "GET" : "POST",
          url,
          headers: pendingHeaders(ref),
          payload: {},
        });
        expect(
          res.statusCode,
          `${url} must refuse a pending reference`,
        ).toBeGreaterThanOrEqual(401);
        expect(
          res.cookies.some((c) => c.name === ADMIN_SESSION_COOKIE_NAME),
        ).toBe(false);
      }
    });

    it("EARS-6.4: the state read reports exactly the flow position, and nothing else", async () => {
      const anonymous = await app.inject({
        method: "GET",
        url: STATE_URL,
        headers: ADMIN_DEVICE,
      });
      expect(anonymous.statusCode).toBe(200);
      expect(anonymous.json()).toEqual({ state: "unauthenticated" });

      const email = uniqueEmail();
      await registerAdmin(email);
      const enrolling = await primaryAuth(email);
      const atEnrollment = await app.inject({
        method: "GET",
        url: STATE_URL,
        headers: pendingHeaders(enrolling.ref),
      });
      expect(atEnrollment.json()).toEqual({ state: "mfa_pending_enrollment" });

      const { ref, secret } = await enrolledAtChallenge();
      const atChallenge = await app.inject({
        method: "GET",
        url: STATE_URL,
        headers: pendingHeaders(ref),
      });
      // The read model is the enum and NOTHING else — no budget, no lock, no
      // factor id, no subject (design §9 → Read models).
      expect(atChallenge.json()).toEqual({ state: "mfa_pending_challenge" });

      const verify = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(ref),
        payload: { code: nextWindowCode(secret) },
      });
      expect(verify.statusCode).toBe(200);
      const sid = verify.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      )!.value;
      const active = await app.inject({
        method: "GET",
        url: STATE_URL,
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}`,
        },
      });
      expect(active.json()).toEqual({ state: "active" });
    });

    it("EARS-7.1: every verification refusal is byte-identical in body, status and cookies", async () => {
      const { ref } = await enrolledAtChallenge();

      const wrongCode = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(ref),
        payload: { code: "000000" },
      });
      // A pending reference that resolves to nothing — the "no such factor /
      // stale reference" branch, which must not be distinguishable from a wrong
      // code by anything a caller can observe.
      const noPending = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders("00000000-0000-4000-8000-000000000000"),
        payload: { code: "000000" },
      });
      // …and the enrollment surface's refusal, which shares the same discipline.
      const wrongStage = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: "000000" },
      });

      for (const res of [wrongCode, noPending, wrongStage]) {
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual(wrongCode.json());
        expect(
          res.cookies.some((c) => c.name === ADMIN_SESSION_COOKIE_NAME),
        ).toBe(false);
      }
    });

    it("EARS-7.2: refusals land inside the §7 ≤50 ms timing band", async () => {
      const { ref } = await enrolledAtChallenge();
      async function timeOf(
        payload: { code: string },
        headers = pendingHeaders(ref),
      ) {
        const started = performance.now();
        const res = await app.inject({
          method: "POST",
          url: CHALLENGE_URL,
          headers,
          payload,
        });
        expect(res.statusCode).toBe(401);
        return performance.now() - started;
      }
      // Warm the path first — a cold first request measures module lazy-init,
      // not the branch under test.
      await timeOf({ code: "000000" });

      const wrong = await timeOf({ code: "000000" });
      const stale = await timeOf(
        { code: "000000" },
        pendingHeaders("00000000-0000-4000-8000-000000000000"),
      );
      expect(Math.abs(wrong - stale)).toBeLessThanOrEqual(50);
    });

    it("EARS-7.3: the enrollment verify and the challenge verify BOTH append an auth.mfa.failure row", async () => {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      const since = await dbNow();

      const enrolling = await primaryAuth(email);
      const enrollFail = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(enrolling.ref),
        payload: { code: "000000" },
      });
      expect(enrollFail.statusCode).toBe(401);

      // Enrol for real, then fail a CHALLENGE.
      const start = await app.inject({
        method: "POST",
        url: ENROLL_START_URL,
        headers: pendingHeaders(enrolling.ref),
        payload: {},
      });
      const secret = (start.json() as { secret: string }).secret;
      await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(enrolling.ref),
        payload: { code: totpCode(secret) },
      });
      const challenging = await primaryAuth(email);
      const challengeFail = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(challenging.ref),
        payload: { code: "000000" },
      });
      expect(challengeFail.statusCode).toBe(401);

      const { rows } = await pool.query<{
        event_type: string;
        reason: string | null;
        metadata: Record<string, unknown>;
      }>(
        "SELECT event_type, reason, metadata FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2 ORDER BY created_at ASC",
        [sub, since],
      );
      const failures = rows.filter((r) => r.event_type === "auth.mfa.failure");
      // One row per surface — before this slice the enrollment verify wrote none,
      // which left the §7 lockout threshold with no evidence trail behind it.
      expect(failures.map((r) => r.metadata["stage"]).sort()).toEqual([
        "challenge",
        "enrollment",
      ]);
      for (const row of failures) {
        expect(row.metadata).toMatchObject({ method: "totp", tier: "admin" });
        expect(row.reason).toBe("invalid");
      }
      // A successful challenge is its own canonical row, distinct from enrollment.
      const good = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(challenging.ref),
        payload: { code: nextWindowCode(secret) },
      });
      expect(good.statusCode).toBe(200);
      const after = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2",
        [sub, since],
      );
      expect(
        after.rows.filter((r) => r.event_type === "auth.mfa.used"),
      ).toHaveLength(1);
    });

    it("EARS-7.4: the §7 threshold soft-locks the account, writes auth.lockout.triggered, and beats a CORRECT code", async () => {
      const { sub, secret, ref } = await enrolledAtChallenge();
      const since = await dbNow();

      for (let attempt = 0; attempt < MFA_LOCKOUT_THRESHOLD; attempt++) {
        const res = await app.inject({
          method: "POST",
          url: CHALLENGE_URL,
          headers: pendingHeaders(ref),
          payload: { code: "000000" },
        });
        expect(res.statusCode).toBe(401);
      }

      // The lock beats a correct code — and answers with the SAME uniform refusal
      // a wrong code gets, so the response is not a lock oracle either (design §6).
      const correct = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(ref),
        payload: { code: nextWindowCode(secret) },
      });
      expect(correct.statusCode).toBe(401);
      expect(
        correct.cookies.some((c) => c.name === ADMIN_SESSION_COOKIE_NAME),
      ).toBe(false);

      const { rows } = await pool.query<{
        event_type: string;
        reason: string | null;
        metadata: Record<string, unknown>;
      }>(
        "SELECT event_type, reason, metadata FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2",
        [sub, since],
      );
      const locks = rows.filter(
        (r) => r.event_type === "auth.lockout.triggered",
      );
      // Exactly ONE lock row for the whole burst: emitted by the attempt that
      // crosses the threshold, not by every attempt made while locked.
      expect(locks).toHaveLength(1);
      expect(locks[0]!.reason).toBe("mfa_attempts");
      expect(locks[0]!.metadata).toMatchObject({ tier: "admin" });

      // The state read stays byte-identical for a locked principal — the
      // uniform-disclosure rule binds this route too (design §10).
      const locked = await app.inject({
        method: "GET",
        url: STATE_URL,
        headers: pendingHeaders(ref),
      });
      expect(locked.json()).toEqual({ state: "mfa_pending_challenge" });

      // Clearing the lock re-admits the same principal — the lock is a soft-lock
      // over a window, not an account death sentence.
      app.get(MfaLockoutService).clear(sub);
      const admitted = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(ref),
        payload: { code: nextWindowCode(secret) },
      });
      expect(admitted.statusCode).toBe(200);
    });
  },
);

/**
 * EARS-7's other half: the ADR-0001 §7 **rate** ceiling, which the verify bodies
 * cannot key on their own (they carry `{ code }` and nothing else). This app
 * binds a low per-user ceiling so the shared budget is observable in a handful of
 * requests rather than twenty.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-7 — the per-user budget is shared across primary auth and both verifies (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const password = "Aa1!ufficiently-long-pw";
    const PER_USER = 4;
    const createdEmails: string[] = [];

    beforeAll(async () => {
      // Bound, not read back — see the sibling `beforeAll` above.
      fake = new FakeIdpClient();
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue({
          perUserPer15Min: PER_USER,
          // Per-IP left effectively open: every request in this suite comes from
          // the same loopback address, so a production-shaped per-IP ceiling would
          // trip first and the assertion would be about the wrong dimension.
          perIpPer15Min: 1_000_000,
          perAsnPerHour: 1_000_000,
        })
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-7.5: verify attempts draw on the SAME per-user window primary auth does", async () => {
      const email = `ears1192rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email,
          password,
          consent: [{ purpose: "tos", version: "2026-01" }],
        },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");

      // A live pending authentication, taken BEFORE the window is spent — the
      // verify below must be refused for want of budget, not for want of a
      // reference.
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(login.statusCode).toBe(200);
      const ref = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;

      // Spend the whole per-user window through PRIMARY AUTH alone, until the
      // login route itself starts answering the generic throttled response.
      let loginThrottled = false;
      for (
        let attempt = 0;
        attempt < PER_USER + 2 && !loginThrottled;
        attempt++
      ) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/admin/auth/login",
          headers: ADMIN_DEVICE,
          payload: { identifier: email, password: "wrong-password-entirely" },
        });
        loginThrottled = res.statusCode === 429;
      }
      expect(
        loginThrottled,
        "primary auth must exhaust the per-user window it keys on",
      ).toBe(true);

      // THE ASSERTION: the verify surface gets no fresh allowance of its own. It
      // is refused with the same generic throttled answer — which is only
      // possible if it counts against the identifier's window rather than the
      // `{ code }` body it can key nothing on. Before the explicit wiring this
      // returned 401 (the per-user dimension silently never engaged).
      const verify = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}`,
        },
        payload: { code: "000000" },
      });
      expect(verify.statusCode).toBe(429);
    });
  },
);
