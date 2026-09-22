import { randomUUID } from "node:crypto";
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
import { totpCode } from "../../src/auth/idp/totp.js";
import { scanRealRouteSet } from "../../src/authz/authz.gate.js";
import type { MatrixRow } from "../../src/authz/authz.matrix.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_CSRF_HEADER,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { ADMIN_DEVICE, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/** The coarse congress role (044 EARS-17) whose reach this suite fences. */
const REGISTRAR = "event-registrar";

/**
 * 044 EARS-19 — V-11. The registrar's ALLOW-SET, written out here as the one
 * place it exists.
 *
 * The endpoint-authz matrix carries a `required_roles` allow-list per route and
 * has no column for a denial set, so «every other endpoint refuses the
 * registrar» cannot be read off it — it has to be swept. This constant is the
 * positive half of that sweep: the roster read the role exists for, plus the
 * session endpoints a principal needs to HOLD a session at the admin origin at
 * all (sign in, learn which screen it is on, enrol/answer the second factor,
 * read back its own roles, sign out).
 *
 * Entries are «MAY carry the role», never «must exist»: the roster route lands
 * with #2311 in parallel, and an allow-set that demanded it would make this
 * suite depend on merge order rather than on the boundary it is about. The
 * anti-vacuity guard below is what keeps that permissiveness honest — the
 * session-hold routes must all be real.
 */
const REGISTRAR_ALLOW_SET: ReadonlySet<string> = new Set([
  // The reach the role exists for (044 EARS-18 / #2311). EARS-19 also names
  // «the print-sheet data it reads»: no such route is registered yet, and when
  // one lands it joins this set explicitly — a new route that carries the role
  // without being enumerated here is exactly what the sweep must fail on.
  "GET /v1/admin/events/:idOrSlug/roster",
  // Holding a session at the admin origin.
  "POST /v1/admin/auth/login",
  "GET /v1/admin/auth/state",
  "POST /v1/admin/auth/mfa/enroll/start",
  "POST /v1/admin/auth/mfa/enroll/verify",
  "POST /v1/admin/auth/mfa/verify",
  "GET /v1/admin/auth/session",
  "POST /v1/admin/auth/logout",
]);

/** The allow-set members that must be REAL routes, or the sweep proves nothing. */
const SESSION_HOLD_ROUTES = [
  "POST /v1/admin/auth/login",
  "GET /v1/admin/auth/state",
  "POST /v1/admin/auth/mfa/enroll/start",
  "POST /v1/admin/auth/mfa/enroll/verify",
  "POST /v1/admin/auth/mfa/verify",
  "GET /v1/admin/auth/session",
  "POST /v1/admin/auth/logout",
];

const MUTATING = /^(POST|PATCH|PUT|DELETE) /;

/**
 * 044 EARS-19 — the registrar is refused on every endpoint outside its
 * allow-set.
 *
 * The refusal itself is not new machinery: `AuthzGuard` denies an
 * `authenticated` route whose `roles` list the caller does not intersect, and an
 * unclassified handler fail-closed. So what EARS-19 actually owes is a PROOF
 * that no route quietly names the role, over the REAL registered route set —
 * the same scan the `endpoint-authz` BLOCK guard runs, not a static grep and not
 * a re-reading of the generated matrix. That is this file.
 */
describe("044 EARS-19 — the event-registrar denial set (route classification)", () => {
  let rows: MatrixRow[];

  beforeAll(async () => {
    const scan = await scanRealRouteSet();
    rows = scan.rows;
    expect(scan.violations).toEqual([]);
  }, 60_000);

  function rolesOf(row: MatrixRow): string[] {
    return (row.meta.roles ?? []) as string[];
  }

  it("044 EARS-19.1: every real route outside the registrar allow-set omits event-registrar", () => {
    const outside = rows.filter((r) => !REGISTRAR_ALLOW_SET.has(r.endpoint));
    // Anti-vacuity: the scan really did enumerate the platform, not a stub.
    expect(outside.length).toBeGreaterThan(50);
    for (const row of outside) {
      expect(rolesOf(row), row.endpoint).not.toContain(REGISTRAR);
    }
  });

  it("044 EARS-19.2: every create, update and delete endpoint outside the allow-set omits event-registrar", () => {
    const mutations = rows.filter(
      (r) => MUTATING.test(r.endpoint) && !REGISTRAR_ALLOW_SET.has(r.endpoint),
    );
    expect(mutations.length).toBeGreaterThan(20);
    for (const row of mutations) {
      expect(rolesOf(row), row.endpoint).not.toContain(REGISTRAR);
    }
  });

  it("044 EARS-19.1.1: the session-hold half of the allow-set names real routes — the sweep is not passing by excusing absent ones", () => {
    const discovered = new Set(rows.map((r) => r.endpoint));
    const missing = SESSION_HOLD_ROUTES.filter((e) => !discovered.has(e));
    expect(missing).toEqual([]);
  });
});

/** A path-parameterised id that resolves to nothing — the refusal is about authz, not existence. */
const ABSENT_ID = randomUUID();

/**
 * Representative endpoints ACROSS the admin controllers, each with a concrete
 * request. The classification sweep above proves the metadata; these prove the
 * runtime refusal a registrar actually meets, reads and mutations alike.
 *
 * `exact403` marks the rows whose refusal must be the `AuthzGuard`'s own
 * «insufficient role». The mutating rows are deliberately not pinned that way:
 * they also carry `revalidate: "live"`, and which of the two global guards
 * answers first is explicitly NOT a contract (`AdminAuthorityGuard` states its
 * own precondition for that reason) — so pinning the status there would assert
 * guard ordering instead of the boundary.
 */
const REFUSED: {
  endpoint: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  payload?: unknown;
  exact403?: true;
}[] = [
  {
    endpoint: "GET /v1/admin/events",
    method: "GET",
    url: "/v1/admin/events",
    exact403: true,
  },
  {
    endpoint: "GET /v1/admin/projects",
    method: "GET",
    url: "/v1/admin/projects",
    exact403: true,
  },
  {
    endpoint: "GET /v1/admin/experts",
    method: "GET",
    url: "/v1/admin/experts",
    exact403: true,
  },
  {
    endpoint: "POST /v1/admin/events",
    method: "POST",
    url: "/v1/admin/events",
    payload: {},
  },
  {
    endpoint: "PATCH /v1/admin/events/:id",
    method: "PATCH",
    url: `/v1/admin/events/${ABSENT_ID}`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/directions",
    method: "POST",
    url: "/v1/admin/directions",
    payload: {},
  },
  {
    endpoint: "DELETE /v1/admin/users/:id/mfa",
    method: "DELETE",
    url: `/v1/admin/users/${ABSENT_ID}/mfa`,
    payload: { code: "000000" },
  },
];

describe.skipIf(!process.env.DATABASE_URL)(
  "044 EARS-19 — a registrar-only principal, live (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const password = "Aa1!ufficiently-long-pw";
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `ears2312-${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /**
     * Register a principal and leave it holding `event-registrar` and NOTHING
     * else. The registration cascade grants `doctor_guest`, so the revoke is
     * what makes this a registrar-ONLY principal rather than a doctor who also
     * happens to be a registrar — and it is the whole point of the suite: a
     * mixed principal would pass the refusals for the wrong reason.
     */
    async function registerRegistrar(prefix: string): Promise<{
      email: string;
      sub: string;
    }> {
      const email = uniqueEmail(prefix);
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
      await fake.revokeProjectRole(sub, "doctor_guest");
      await fake.grantProjectRole(sub, REGISTRAR);
      expect(fake.grantedRoles(sub)).toEqual([REGISTRAR]);
      return { email, sub };
    }

    beforeAll(async () => {
      // Bound here, never read back off the container: `IdpModule` picks the
      // real adapter whenever a dev-stand configures `IDP_ISSUER`, and the
      // test-only grant accessors do not exist on it.
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
    }, 60_000);

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("044 EARS-19.3: a registrar-only principal is refused live on representative admin mutations and reads", async () => {
      const { email } = await registerRegistrar("denial");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device: ADMIN_DEVICE,
      });

      for (const route of REFUSED) {
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers: admin.headers,
          ...(route.payload === undefined ? {} : { payload: route.payload }),
        });
        if (route.exact403) {
          expect(res.statusCode, route.endpoint).toBe(403);
        } else {
          expect([401, 403], route.endpoint).toContain(res.statusCode);
        }
      }

      // The doctor-facing tier, with the registrar's own admin credential. 011
      // EARS-2 keeps the two cookie namespaces disjoint, so the admin session
      // authenticates NOTHING here — the registrar cannot reach a doctor's
      // surface by carrying its admin session across.
      const portal = await app.inject({
        method: "GET",
        url: "/v1/me/profile",
        headers: admin.headers,
      });
      expect([401, 403]).toContain(portal.statusCode);
    }, 30_000);

    it("044 EARS-19.4: a registrar-only principal holds an admin session — second factor, own roles read back, sign-out", async () => {
      const { email, sub } = await registerRegistrar("session");

      // Primary auth at the admin origin. That this answers at all is the
      // `role → mfa_required` entry: `startLogin` refuses a principal the policy
      // does not cover, so a registrar without it would be told «invalid
      // credentials» and would need a second, weaker door into the admin tier.
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toEqual({ state: "mfa_pending_enrollment" });
      const ref = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;
      const pendingHeaders = {
        ...ADMIN_DEVICE,
        cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}`,
      };

      const start = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/mfa/enroll/start",
        headers: pendingHeaders,
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const secret = (start.json() as { secret: string }).secret;

      const verify = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/mfa/enroll/verify",
        headers: pendingHeaders,
        payload: { code: totpCode(secret) },
      });
      expect(verify.statusCode).toBe(200);
      expect(await fake.hasTotpFactor(sub)).toBe(true);
      const sid = verify.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      )!.value;
      const csrf = verify.cookies.find(
        (c) => c.name === ADMIN_CSRF_COOKIE_NAME,
      )!.value;
      const sessionHeaders = {
        ...ADMIN_DEVICE,
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
        [ADMIN_CSRF_HEADER]: csrf,
      };

      // The read the role-aware admin navigation projects (EARS-20): the
      // principal's OWN roles, and nothing else on the response.
      const session = await app.inject({
        method: "GET",
        url: "/v1/admin/auth/session",
        headers: sessionHeaders,
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toEqual({ roles: [REGISTRAR] });

      const logout = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/logout",
        headers: sessionHeaders,
      });
      expect(logout.statusCode).toBe(200);

      // And the session is genuinely gone — the read is session-bound, not a
      // cookie-shaped constant.
      const after = await app.inject({
        method: "GET",
        url: "/v1/admin/auth/session",
        headers: sessionHeaders,
      });
      expect([401, 403]).toContain(after.statusCode);
    }, 30_000);
  },
);
