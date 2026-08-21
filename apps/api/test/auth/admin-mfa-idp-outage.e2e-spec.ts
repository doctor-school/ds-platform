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
import {
  IDP_CLIENT,
  IdpUnavailableError,
  type IdpSession,
} from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { totpCode } from "../../src/auth/idp/totp.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

const LOGIN_URL = "/v1/admin/auth/login";
const ENROLL_START_URL = "/v1/admin/auth/mfa/enroll/start";
const ENROLL_VERIFY_URL = "/v1/admin/auth/mfa/enroll/verify";
const CHALLENGE_VERIFY_URL = "/v1/admin/auth/mfa/verify";

/**
 * 011 EARS-5/EARS-6/EARS-7 (#1211) — the IdP-fault posture of the two admin
 * second-factor verify surfaces.
 *
 * The TOTP seam fails LOUD by design (#1208): `verifyTotpRegistration` and
 * `checkTotpFactor` throw {@link IdpUnavailableError} on a genuine infra fault
 * instead of resolving "not verified". The login handler already maps that throw
 * to a 503; the two verify handlers did not, so exactly the same outage answered
 * a bare 500 on `mfa/enroll/verify` and `mfa/verify`.
 *
 * Two independent reasons that is wrong, both already recorded for the login
 * path:
 *
 * 1. The project rule (`register.e2e-spec.ts`, #202): a genuine IdP infra fault
 *    is a 503 "unavailable", NEVER a 500.
 * 2. EARS-7 uniformity. A 500 is a THIRD answer next to the uniform 401 and the
 *    429 — and it is reachable only by a caller holding a live pending
 *    authentication, i.e. one who already passed primary auth on a
 *    `platform_admin`. An outage must not become the one status that confirms it.
 *
 * And an outage is not a failed attempt: it writes no `auth.mfa.failure` row and
 * spends no lockout unit, or a downed IdP would lock out every operator who kept
 * trying.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-5/EARS-6 — an IdP fault during a TOTP verify (e2e, #1211)",
  () => {
    /**
     * The fault window: both TOTP verify calls are down, everything else (the
     * password check, the factor read, the enrollment registration) works — so a
     * suite can enrol a factor first and then turn the outage on.
     */
    class TotpVerifyOutageIdp extends FakeIdpClient {
      /** Flipped by a test; the fake behaves normally while it is `false`. */
      outage = false;

      override startTotpRegistration(
        sub: string,
      ): ReturnType<FakeIdpClient["startTotpRegistration"]> {
        if (this.outage) {
          return Promise.reject(
            new IdpUnavailableError("totp registration is down"),
          );
        }
        return super.startTotpRegistration(sub);
      }

      override verifyTotpRegistration(
        sub: string,
        code: string,
      ): Promise<boolean> {
        if (this.outage) {
          return Promise.reject(
            new IdpUnavailableError("totp registration verify is down"),
          );
        }
        return super.verifyTotpRegistration(sub, code);
      }

      override checkTotpFactor(
        session: IdpSession,
        code: string,
      ): Promise<IdpSession | null> {
        if (this.outage) {
          return Promise.reject(
            new IdpUnavailableError("totp factor check is down"),
          );
        }
        return super.checkTotpFactor(session, code);
      }
    }

    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: TotpVerifyOutageIdp;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";

    /** Every principal this suite registers, dropped in `afterEach` (fake-sub reuse). */
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1211outage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function pendingHeaders(ref: string): Record<string, string> {
      return { ...ADMIN_DEVICE, cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}` };
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

    /** Primary auth; resolves the pending reference and the state it reports. */
    async function login(
      email: string,
    ): Promise<{ ref: string; state: string }> {
      const res = await app.inject({
        method: "POST",
        url: LOGIN_URL,
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

    /** Registered admin sitting on the enrollment step, no offer served yet. */
    async function pendingBeforeOffer(
      email: string,
    ): Promise<{ sub: string; ref: string }> {
      const sub = await registerAdmin(email);
      const { ref, state } = await login(email);
      expect(state).toBe("mfa_pending_enrollment");
      return { sub, ref };
    }

    /** Registered admin sitting on the enrollment step, offer already served. */
    async function pendingEnrollment(
      email: string,
    ): Promise<{ sub: string; ref: string; secret: string }> {
      const { sub, ref } = await pendingBeforeOffer(email);
      const start = await app.inject({
        method: "POST",
        url: ENROLL_START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      return { sub, ref, secret: (start.json() as { secret: string }).secret };
    }

    /** Enrolled admin sitting on the challenge step of a SECOND login. */
    async function pendingChallenge(
      email: string,
    ): Promise<{ sub: string; ref: string; secret: string }> {
      const { sub, ref, secret } = await pendingEnrollment(email);
      const enrolled = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(enrolled.statusCode).toBe(200);
      const second = await login(email);
      expect(second.state).toBe("mfa_pending_challenge");
      return { sub, ref: second.ref, secret };
    }

    /** A six-digit code that is NOT the live one for this secret. */
    function wrongCode(secret: string): string {
      return totpCode(secret) === "123456" ? "654321" : "123456";
    }

    /**
     * The **ledger's own clock**, used to fence each count below.
     *
     * A `new Date()` taken in the test process is not usable here: `created_at` is
     * stamped by Postgres, which on a dev stand runs on a different host and can
     * be tens of milliseconds off — so a row this suite just produced can land
     * outside a fence taken moments before it. Reading the fence from the clock
     * that stamps the rows removes the skew.
     */
    async function dbNow(): Promise<Date> {
      const { rows } = await pool.query<{ t: Date }>("SELECT now() AS t");
      return rows[0]!.t;
    }

    /**
     * Failure rows for `sub` **written since `since`**.
     *
     * The window is load-bearing, not decoration: the fake IdP numbers subjects
     * from a per-app-instance counter, so every suite in the run mints the same
     * `fake-sub-N` strings — and the ledger is append-only. Counting a subject's
     * rows unwindowed therefore counts other suites' rows too, and the assertion
     * silently becomes a function of how many suites ran first.
     */
    async function mfaFailureRows(sub: string, since: Date): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM audit_ledger
          WHERE subject_id = $1 AND event_type = 'auth.mfa.failure'
            AND created_at >= $2`,
        [sub, since],
      );
      return Number(rows[0]!.n);
    }

    beforeAll(async () => {
      fake = new TotpVerifyOutageIdp();
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
      fake.outage = false;
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-5: an IdP fault during the enrollment verify yields a 503, NEVER a 500 (#1211)", async () => {
      const email = uniqueEmail();
      const { ref, secret } = await pendingEnrollment(email);

      fake.outage = true;
      const res = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });

      expect(res.statusCode).toBe(503);
      expect(res.statusCode).not.toBe(500);
      // The fault admits nothing: no admin session, and the body carries the same
      // generic "unavailable" the login path answers with — no secret, no sub, no
      // IdP detail.
      expect(res.cookies.map((c) => c.name)).not.toContain(
        ADMIN_SESSION_COOKIE_NAME,
      );
      const body = res.body.toLowerCase();
      expect(body).toContain("unavailable");
      expect(body).not.toContain(email.toLowerCase());
      expect(body).not.toContain(secret.toLowerCase());
      expect(body).not.toContain("totp");
      expect(body).not.toContain("zitadel");
    });

    it("EARS-5: an IdP fault while registering the provisional factor yields a 503, NEVER a 500 (#1211)", async () => {
      const email = uniqueEmail();
      const { ref } = await pendingBeforeOffer(email);

      fake.outage = true;
      const res = await app.inject({
        method: "POST",
        url: ENROLL_START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });

      // The enrollment START is the third route on this controller that calls the
      // IdP behind a pending authentication; leaving it unmapped would make it the
      // one place an outage is still a 500.
      expect(res.statusCode).toBe(503);
      expect(res.statusCode).not.toBe(500);
      expect(res.body.toLowerCase()).toContain("unavailable");
    });

    it("EARS-6: an IdP fault during the challenge verify yields a 503, NEVER a 500 (#1211)", async () => {
      const email = uniqueEmail();
      const { ref, secret } = await pendingChallenge(email);

      fake.outage = true;
      const res = await app.inject({
        method: "POST",
        url: CHALLENGE_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });

      expect(res.statusCode).toBe(503);
      expect(res.statusCode).not.toBe(500);
      expect(res.cookies.map((c) => c.name)).not.toContain(
        ADMIN_SESSION_COOKIE_NAME,
      );
      const body = res.body.toLowerCase();
      expect(body).toContain("unavailable");
      expect(body).not.toContain(email.toLowerCase());
      expect(body).not.toContain("totp");
      expect(body).not.toContain("zitadel");
    });

    it("EARS-7: an outage is not a failed attempt — no auth.mfa.failure row, no lockout unit, and the correct code still verifies once the IdP recovers", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await pendingEnrollment(email);
      const since = await dbNow();

      fake.outage = true;
      for (let i = 0; i < 3; i += 1) {
        const res = await app.inject({
          method: "POST",
          url: ENROLL_VERIFY_URL,
          headers: pendingHeaders(ref),
          payload: { code: totpCode(secret) },
        });
        expect(res.statusCode).toBe(503);
      }

      // An outage produced no evidence of guessing: the EARS-7 ledger row is for
      // a REFUSED attempt, and nothing was refused here.
      expect(await mfaFailureRows(sub, since)).toBe(0);

      // …and it spent no lockout unit either: the same pending authentication,
      // with the code that was correct all along, completes the moment the IdP is
      // back. A counter touched by the outage would show up as a refusal here.
      fake.outage = false;
      const recovered = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(recovered.statusCode).toBe(200);
    });

    it("EARS-7: the refusal taxonomy is unchanged — with the IdP healthy a wrong code is still the uniform 401 with its failure row", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await pendingEnrollment(email);
      const since = await dbNow();

      const res = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: wrongCode(secret) },
      });

      // The 503 mapping is scoped to the IdP fault and nothing else — a genuine
      // wrong code keeps the uniform refusal, body and all.
      expect(res.statusCode).toBe(401);
      expect(res.body.toLowerCase()).toContain("verification failed");
      expect(await mfaFailureRows(sub, since)).toBe(1);
    });
  },
);
