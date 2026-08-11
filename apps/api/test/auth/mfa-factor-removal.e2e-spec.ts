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
} from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { TOTP_STEP_SECONDS, totpCode } from "../../src/auth/idp/totp.js";
import { AdminSessionService } from "../../src/auth/admin-session/admin-session.service.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_CSRF_HEADER,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import {
  ADMIN_SESSION_STORE,
  type AdminSessionRecord,
  type AdminSessionStore,
} from "../../src/auth/admin-session/admin-session.types.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";

const LOGIN_URL = "/v1/admin/auth/login";
const ENROLL_START_URL = "/v1/admin/auth/mfa/enroll/start";
const ENROLL_VERIFY_URL = "/v1/admin/auth/mfa/enroll/verify";
const CHALLENGE_URL = "/v1/admin/auth/mfa/verify";

function removalUrl(targetSub: string): string {
  return `/v1/admin/users/${encodeURIComponent(targetSub)}/mfa`;
}

/**
 * The TOTP-removal outage seam: the factor read and the removal RPC are down,
 * everything else works — so a suite can enrol, log in, and then turn the outage
 * on for the one call under test.
 */
class FactorRemovalOutageIdp extends FakeIdpClient {
  outage = false;

  override removeTotpFactor(sub: string): Promise<void> {
    if (this.outage) {
      return Promise.reject(new IdpUnavailableError("factor removal is down"));
    }
    return super.removeTotpFactor(sub);
  }
}

/**
 * 011 Verification row 13 — EARS-13, the LD-2 operator factor-removal endpoint.
 *
 * The whole point of putting this action behind an endpoint rather than the IdP
 * console is that the console is never observed by `apps/api`, so the
 * `auth.mfa.reset` row EARS-9 mandates would never be written (011 requirements
 * → LD-2). These tests therefore assert the PRODUCING PATH — the row, its
 * `by_admin` actor, its `tier`, and the target's return to forced enrollment —
 * not merely a 200.
 *
 * The protection under test is the **route-local fresh-possession proof**: the
 * caller supplies their OWN current TOTP code, verified at call time against
 * their own registered factor. The general step-up mechanism is unbuilt (011
 * design §9), so a `step_up: true` matrix row would advertise a guard that does
 * not exist; the route carries `step_up: false` and the endpoint-authz suite
 * asserts it.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-13 — operator factor removal (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FactorRemovalOutageIdp;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";

    /** Every principal this suite registers, dropped in `afterEach`. */
    const createdEmails: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `ears1193${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /**
     * A code from the NEXT time step. A TOTP code is single-use inside its window,
     * and the enrollment arc that gave this operator a session already burned the
     * current one — so a removal call submitting the same digits would be a replay
     * and must be refused. Stepping one window forward asks for a genuinely fresh
     * code, which the ±1-step tolerance accepts.
     */
    function nextWindowCode(secret: string): string {
      return totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);
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

    function pendingHeaders(ref: string): Record<string, string> {
      return { ...ADMIN_DEVICE, cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}` };
    }

    async function primaryAuth(
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

    interface Operator {
      email: string;
      sub: string;
      secret: string;
      /** The opaque admin session id, so a test can reach the stored record. */
      sid: string;
      headers: Record<string, string>;
    }

    /**
     * An **enrolled** `platform_admin` holding a live admin session — the only
     * principal EARS-13 admits, because the route demands the caller's own
     * current code. The enrollment verify issues the session in place (LD-1), so
     * this is the production arc end to end, not a helper shortcut.
     */
    async function enrolledOperator(prefix: string): Promise<Operator> {
      const email = uniqueEmail(prefix);
      const sub = await registerAdmin(email);
      const { ref, state } = await primaryAuth(email);
      expect(state).toBe("mfa_pending_enrollment");
      const start = await app.inject({
        method: "POST",
        url: ENROLL_START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const secret = (start.json() as { secret: string }).secret;
      const verified = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(verified.statusCode).toBe(200);
      const sid = verified.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      )!.value;
      const csrf = verified.cookies.find(
        (c) => c.name === ADMIN_CSRF_COOKIE_NAME,
      )!.value;
      return {
        email,
        sub,
        secret,
        sid,
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
          [ADMIN_CSRF_HEADER]: csrf,
        },
      };
    }

    /** A second `platform_admin` who already holds a registered factor. */
    async function enrolledTarget(): Promise<{ email: string; sub: string }> {
      const email = uniqueEmail("target");
      const sub = await registerAdmin(email);
      fake.setTotpFactor(sub, true);
      expect(await fake.hasTotpFactor(sub)).toBe(true);
      return { email, sub };
    }

    /**
     * A NON-admin account that nonetheless holds a TOTP factor — the target the
     * route must refuse. It is registered exactly as any user is and never
     * granted `platform_admin`, so what disqualifies it is the role policy, not a
     * missing factor: without the target-role floor the removal would succeed and
     * write an `auth.mfa.reset` row asserting an admin factor reset for an
     * account that was never an admin.
     */
    async function enrolledNonAdmin(): Promise<{ email: string; sub: string }> {
      const email = uniqueEmail("nonadmin");
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
      expect(fake.grantedRoles(sub)).not.toContain("platform_admin");
      fake.setTotpFactor(sub, true);
      return { email, sub };
    }

    /**
     * The **ledger's own clock**, not the test process's.
     *
     * Every row assertion below windows on `created_at`, which Postgres stamps.
     * On a dev stand that Postgres lives on a different host from the test
     * process, tens of milliseconds off — so a `new Date()` taken here is a
     * knife-edge fence the DB writes on the wrong side of, and the row the test
     * just produced falls outside its own window. Reading the fence from the
     * clock that stamps the rows removes the skew entirely.
     *
     * The window cannot simply be dropped: the fake IdP numbers subjects from a
     * per-app counter that restarts with each run, so `subject_id` alone would
     * also match a PREVIOUS run's rows in the same shared database.
     */
    async function dbNow(): Promise<Date> {
      const { rows } = await pool.query<{ t: Date }>("SELECT now() AS t");
      return rows[0]!.t;
    }

    async function resetRowsFor(
      sub: string,
      since: Date,
    ): Promise<
      Array<{
        event_type: string;
        subject_id: string | null;
        sid: string | null;
        reason: string | null;
        metadata: Record<string, unknown>;
      }>
    > {
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
        sid: string | null;
        reason: string | null;
        metadata: Record<string, unknown>;
      }>(
        "SELECT event_type, subject_id, sid, reason, metadata FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2 AND event_type = 'auth.mfa.reset' ORDER BY created_at ASC",
        [sub, since],
      );
      return rows;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(IDP_CLIENT)
        .useValue(new FactorRemovalOutageIdp())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      fake = app.get<FactorRemovalOutageIdp>(IDP_CLIENT);
    });

    afterEach(async () => {
      fake.outage = false;
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-13.1: the caller's own current code removes the target's factor, writes exactly one auth.mfa.reset row, and returns the target to forced enrollment", async () => {
      const operator = await enrolledOperator("op");
      const target = await enrolledTarget();
      const since = await dbNow();

      const res = await app.inject({
        method: "DELETE",
        url: removalUrl(target.sub),
        headers: operator.headers,
        payload: { code: nextWindowCode(operator.secret) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "removed" });
      expect(await fake.hasTotpFactor(target.sub)).toBe(false);

      // The producing path — the row this endpoint exists to make writable.
      const rows = await resetRowsFor(target.sub, since);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.subject_id).toBe(target.sub);
      expect(rows[0]!.metadata).toMatchObject({
        by_admin: operator.sub,
        tier: "admin",
      });

      // …and the target's next login re-enters the EARS-4 forced-enrollment gate.
      const next = await primaryAuth(target.email);
      expect(next.state).toBe("mfa_pending_enrollment");
    });

    it("EARS-13.2: removing the caller's OWN factor is refused — the endpoint is not an MFA opt-out", async () => {
      const operator = await enrolledOperator("self");
      const since = await dbNow();

      const res = await app.inject({
        method: "DELETE",
        url: removalUrl(operator.sub),
        headers: operator.headers,
        payload: { code: nextWindowCode(operator.secret) },
      });

      expect(res.statusCode).toBe(403);
      // The factor survives, and no row claims otherwise.
      expect(await fake.hasTotpFactor(operator.sub)).toBe(true);
      expect(await resetRowsFor(operator.sub, since)).toHaveLength(0);
    });

    it("EARS-13.3: a wrong caller code refuses the removal with the EARS-7 uniform failure and writes an auth.mfa.failure row", async () => {
      const operator = await enrolledOperator("wrong");
      const target = await enrolledTarget();
      const since = await dbNow();

      const wrong = await app.inject({
        method: "DELETE",
        url: removalUrl(target.sub),
        headers: operator.headers,
        payload: { code: "000000" },
      });
      expect(wrong.statusCode).toBe(401);
      // Byte-identical to the EARS-7 refusal of a login-time verify — the removal
      // route is not a second failure taxonomy.
      const challengeRefusal = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders("00000000-0000-4000-8000-000000000000"),
        payload: { code: "000000" },
      });
      expect(wrong.json()).toEqual(challengeRefusal.json());

      // Nothing was removed, and nothing was audited as removed.
      expect(await fake.hasTotpFactor(target.sub)).toBe(true);
      expect(await resetRowsFor(target.sub, since)).toHaveLength(0);

      // The attempt draws on the SAME accounting the two verify surfaces use:
      // one `auth.mfa.failure` row against the CALLER (whose code was wrong),
      // never against the target.
      const { rows } = await pool.query<{
        event_type: string;
        metadata: Record<string, unknown>;
      }>(
        "SELECT event_type, metadata FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2 AND event_type = 'auth.mfa.failure'",
        [operator.sub, since],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({
        method: "totp",
        stage: "factor_removal",
        tier: "admin",
      });
    });

    it("EARS-13.4: a replayed caller code is refused exactly as a wrong one is", async () => {
      const operator = await enrolledOperator("replay");
      const first = await enrolledTarget();
      const second = await enrolledTarget();
      const code = nextWindowCode(operator.secret);

      const accepted = await app.inject({
        method: "DELETE",
        url: removalUrl(first.sub),
        headers: operator.headers,
        payload: { code },
      });
      expect(accepted.statusCode).toBe(200);

      const replayed = await app.inject({
        method: "DELETE",
        url: removalUrl(second.sub),
        headers: operator.headers,
        payload: { code },
      });
      expect(replayed.statusCode).toBe(401);
      expect(await fake.hasTotpFactor(second.sub)).toBe(true);
    });

    it("EARS-13.5: a caller without an MFA-verified admin session cannot reach the route", async () => {
      const target = await enrolledTarget();

      // No credential at all.
      const anonymous = await app.inject({
        method: "DELETE",
        url: removalUrl(target.sub),
        headers: ADMIN_DEVICE,
        payload: { code: "000000" },
      });
      expect(anonymous.statusCode).toBeGreaterThanOrEqual(401);

      // A doctor-portal session presented at an admin route (EARS-2).
      const portalEmail = uniqueEmail("doctor");
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email: portalEmail, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const portal = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { identifier: portalEmail, password },
      });
      const portalSid = portal.cookies.find(
        (c) => c.name === SESSION_COOKIE_NAME,
      )?.value;
      const withPortalCookie = await app.inject({
        method: "DELETE",
        url: removalUrl(target.sub),
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${SESSION_COOKIE_NAME}=${portalSid ?? "none"}`,
        },
        payload: { code: "000000" },
      });
      expect(withPortalCookie.statusCode).toBeGreaterThanOrEqual(401);

      expect(await fake.hasTotpFactor(target.sub)).toBe(true);
    });

    it("EARS-13.6: a state-changing removal without the CSRF double-submit header is refused (EARS-10)", async () => {
      const operator = await enrolledOperator("csrf");
      const target = await enrolledTarget();
      const { [ADMIN_CSRF_HEADER]: _csrf, ...noCsrf } = operator.headers;

      const res = await app.inject({
        method: "DELETE",
        url: removalUrl(target.sub),
        headers: noCsrf,
        payload: { code: nextWindowCode(operator.secret) },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(401);
      expect(await fake.hasTotpFactor(target.sub)).toBe(true);
    });

    it("EARS-13.7: an IdP fault during the removal is a 503, never a bare 500, and audits no removal", async () => {
      const operator = await enrolledOperator("outage");
      const target = await enrolledTarget();
      const since = await dbNow();
      fake.outage = true;

      const res = await app.inject({
        method: "DELETE",
        url: removalUrl(target.sub),
        headers: operator.headers,
        payload: { code: nextWindowCode(operator.secret) },
      });

      expect(res.statusCode).toBe(503);
      expect(await resetRowsFor(target.sub, since)).toHaveLength(0);
    });

    it("EARS-13.8: the break-glass script writes a row SHAPE-IDENTICAL to the endpoint-written one (LD-2)", async () => {
      const operator = await enrolledOperator("glass");
      const viaEndpoint = await enrolledTarget();
      const viaScript = await enrolledTarget();
      const since = await dbNow();

      const res = await app.inject({
        method: "DELETE",
        url: removalUrl(viaEndpoint.sub),
        headers: operator.headers,
        payload: { code: nextWindowCode(operator.secret) },
      });
      expect(res.statusCode).toBe(200);

      // The break-glass path — the SAME service primitive the ops script calls,
      // entered without a caller code because the precondition of LD-2 is that no
      // second operator holds a factor to prove one with.
      await app
        .get(AdminSessionService)
        .applyFactorRemoval(viaScript.sub, operator.sub);
      expect(await fake.hasTotpFactor(viaScript.sub)).toBe(false);

      const [endpointRow] = await resetRowsFor(viaEndpoint.sub, since);
      const [scriptRow] = await resetRowsFor(viaScript.sub, since);
      expect(endpointRow).toBeDefined();
      expect(scriptRow).toBeDefined();
      // A ledger reader must not be able to tell which path wrote the row: same
      // wire id, same `by_admin`, same `tier`, same null-shaped columns. Only the
      // subject differs, because they are different targets.
      expect(scriptRow!.event_type).toBe(endpointRow!.event_type);
      expect(scriptRow!.reason).toBe(endpointRow!.reason);
      expect(scriptRow!.sid).toBe(endpointRow!.sid);
      expect(scriptRow!.metadata).toEqual(endpointRow!.metadata);
    });

    it("EARS-13.9: a target outside the role → mfa_required policy is refused with the uniform failure, keeps its factor, and produces no reset row", async () => {
      const operator = await enrolledOperator("roleflo");
      const outsider = await enrolledNonAdmin();
      const since = await dbNow();

      const res = await app.inject({
        method: "DELETE",
        url: removalUrl(outsider.sub),
        headers: operator.headers,
        payload: { code: nextWindowCode(operator.secret) },
      });

      // The caller's code was CORRECT — what refuses here is the target, and the
      // answer says nothing about which of the two it was. A distinct status or
      // body would turn the endpoint into a role oracle over the user population,
      // readable by any operator holding a valid code.
      expect(res.statusCode).toBe(401);
      const challengeRefusal = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders("00000000-0000-4000-8000-000000000000"),
        payload: { code: "000000" },
      });
      expect(res.json()).toEqual(challengeRefusal.json());

      // Nothing was deleted, and the ledger asserts no admin factor reset for an
      // account that never held an admin factor.
      expect(await fake.hasTotpFactor(outsider.sub)).toBe(true);
      expect(await resetRowsFor(outsider.sub, since)).toHaveLength(0);
    });

    it("EARS-13.10: an admin-session record predating the carried identifier is refused uniformly, never a 500", async () => {
      const operator = await enrolledOperator("legacy");
      const target = await enrolledTarget();
      const since = await dbNow();

      // Rewrite the stored record into the shape a session minted before the
      // identifier was carried onto it would have. The field keys the ADR-0001 §7
      // per-user window; with it absent the route used to fault inside the
      // limiter and answer 500 — a status that both breaks the EARS-7 uniformity
      // and tells a caller their session is unusual.
      const store = app.get<AdminSessionStore>(ADMIN_SESSION_STORE);
      const record = (await store.get(operator.sid))!;
      const legacy: Partial<AdminSessionRecord> = { ...record };
      delete legacy.identifier;
      await store.create(legacy as AdminSessionRecord);

      const res = await app.inject({
        method: "DELETE",
        url: removalUrl(target.sub),
        headers: operator.headers,
        payload: { code: nextWindowCode(operator.secret) },
      });

      expect(res.statusCode).toBe(401);
      const challengeRefusal = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders("00000000-0000-4000-8000-000000000000"),
        payload: { code: "000000" },
      });
      expect(res.json()).toEqual(challengeRefusal.json());
      expect(await fake.hasTotpFactor(target.sub)).toBe(true);
      expect(await resetRowsFor(target.sub, since)).toHaveLength(0);
    });
  },
);
