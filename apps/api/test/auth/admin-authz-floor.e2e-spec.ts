import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { scanRealRouteSet } from "../../src/authz/authz.gate.js";
import type { MatrixRow } from "../../src/authz/authz.matrix.js";
import { TOTP_STEP_SECONDS, totpCode } from "../../src/auth/idp/totp.js";
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
import {
  computeFingerprint,
  SESSION_COOKIE_NAME,
} from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { ADMIN_DEVICE, establishAdminSession } from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/** Fastify's `inject` always reports this client IP; the fingerprint must match it. */
const INJECT_IP = "127.0.0.1";

/**
 * The design §9 classification of the admin **auth-entry** routes — the ones a
 * caller legitimately reaches WITHOUT an established admin session, and which
 * therefore cannot sit on the EARS-11 floor. Every other `/v1/admin/**` route
 * must carry the floor; this map is what keeps "except the entry routes" from
 * quietly growing into "except whichever route someone forgot".
 */
const ADMIN_ENTRY_CLASSIFICATION: Record<
  string,
  { access: string; roles: string[] | undefined }
> = {
  "POST /v1/admin/auth/login": { access: "public", roles: undefined },
  "GET /v1/admin/auth/state": { access: "public", roles: undefined },
  "POST /v1/admin/auth/mfa/enroll/start": {
    access: "pending-auth",
    roles: ["platform_admin"],
  },
  "POST /v1/admin/auth/mfa/enroll/verify": {
    access: "pending-auth",
    roles: ["platform_admin"],
  },
  "POST /v1/admin/auth/mfa/verify": {
    access: "pending-auth",
    roles: ["platform_admin"],
  },
};

/** A path-parameterised id that resolves to nothing — the floor is about authz, not existence. */
const ABSENT_ID = randomUUID();

/**
 * Every admin route sitting on the raised floor, with a concrete request for it.
 * The `endpoint` ids are cross-checked against the **discovered** route set below,
 * so a new admin route added without a row here fails the suite rather than
 * silently escaping the floor assertions.
 */
const FLOOR_ROUTES: {
  endpoint: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  payload?: unknown;
}[] = [
  {
    endpoint: "POST /v1/admin/auth/logout",
    method: "POST",
    url: "/v1/admin/auth/logout",
  },
  {
    endpoint: "DELETE /v1/admin/users/:id/mfa",
    method: "DELETE",
    url: `/v1/admin/users/${ABSENT_ID}/mfa`,
    payload: { code: "000000" },
  },
  { endpoint: "GET /v1/admin/events", method: "GET", url: "/v1/admin/events" },
  {
    endpoint: "GET /v1/admin/events/:id",
    method: "GET",
    url: `/v1/admin/events/${ABSENT_ID}`,
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
    endpoint: "PUT /v1/admin/events/:id/stream",
    method: "PUT",
    url: `/v1/admin/events/${ABSENT_ID}/stream`,
    payload: { provider: "rutube", embedRef: "x" },
  },
  {
    endpoint: "POST /v1/admin/events/:id/publish",
    method: "POST",
    url: `/v1/admin/events/${ABSENT_ID}/publish`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/events/:id/open",
    method: "POST",
    url: `/v1/admin/events/${ABSENT_ID}/open`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/events/:id/close",
    method: "POST",
    url: `/v1/admin/events/${ABSENT_ID}/close`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/events/:id/archive",
    method: "POST",
    url: `/v1/admin/events/${ABSENT_ID}/archive`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/events/:id/transition",
    method: "POST",
    url: `/v1/admin/events/${ABSENT_ID}/transition`,
    payload: { to: "published" },
  },
  // 012 EARS-1/EARS-16 (#1283) — the taxonomy project routes sit on the same
  // raised floor as every other admin route: the guard refuses before validation,
  // idempotency or upload, so an unfielded request never even reaches the handler.
  {
    endpoint: "GET /v1/admin/projects",
    method: "GET",
    url: "/v1/admin/projects",
  },
  {
    endpoint: "GET /v1/admin/projects/:id",
    method: "GET",
    url: `/v1/admin/projects/${ABSENT_ID}`,
  },
  {
    endpoint: "POST /v1/admin/projects",
    method: "POST",
    url: "/v1/admin/projects",
    payload: {},
  },
  {
    endpoint: "PATCH /v1/admin/projects/:id",
    method: "PATCH",
    url: `/v1/admin/projects/${ABSENT_ID}`,
    payload: {},
  },
  // 012 EARS-2/EARS-16 (#1284) — the taxonomy expert routes sit on the same
  // raised floor as every other admin route: the guard refuses before validation,
  // idempotency or upload, so an unfielded request never even reaches the handler.
  {
    endpoint: "GET /v1/admin/experts",
    method: "GET",
    url: "/v1/admin/experts",
  },
  {
    endpoint: "GET /v1/admin/experts/:id",
    method: "GET",
    url: `/v1/admin/experts/${ABSENT_ID}`,
  },
  {
    endpoint: "POST /v1/admin/experts",
    method: "POST",
    url: "/v1/admin/experts",
    payload: {},
  },
  {
    endpoint: "PATCH /v1/admin/experts/:id",
    method: "PATCH",
    url: `/v1/admin/experts/${ABSENT_ID}`,
    payload: {},
  },
  // 012 EARS-3 (#1285) — the curated topic authoring surface. Same floor as its
  // siblings: the `platform_admin` guard answers before validation, so an
  // unauthenticated caller cannot tell an absent topic from an existing one.
  {
    endpoint: "GET /v1/admin/topics",
    method: "GET",
    url: "/v1/admin/topics",
  },
  {
    endpoint: "GET /v1/admin/topics/:id",
    method: "GET",
    url: `/v1/admin/topics/${ABSENT_ID}`,
  },
  {
    endpoint: "POST /v1/admin/topics",
    method: "POST",
    url: "/v1/admin/topics",
    payload: {},
  },
  {
    endpoint: "PATCH /v1/admin/topics/:id",
    method: "PATCH",
    url: `/v1/admin/topics/${ABSENT_ID}`,
    payload: {},
  },
  // 012 EARS-4 (#1286) — the descriptive partner authoring surface. Same floor as
  // its siblings: the `platform_admin` guard refuses before validation,
  // idempotency or the logo upload, so an unfielded request never reaches the
  // handler and an anonymous caller cannot tell an absent partner from a real one.
  {
    endpoint: "GET /v1/admin/partners",
    method: "GET",
    url: "/v1/admin/partners",
  },
  {
    endpoint: "GET /v1/admin/partners/:id",
    method: "GET",
    url: `/v1/admin/partners/${ABSENT_ID}`,
  },
  {
    endpoint: "POST /v1/admin/partners",
    method: "POST",
    url: "/v1/admin/partners",
    payload: {},
  },
  {
    endpoint: "PATCH /v1/admin/partners/:id",
    method: "PATCH",
    url: `/v1/admin/partners/${ABSENT_ID}`,
    payload: {},
  },
  // 012 EARS-7/EARS-16 (#1289) — the explicit expert↔event link. A JOIN leaks
  // MORE than an entity if its floor is soft: an anonymous 404-vs-409 difference
  // would disclose which legacy speaker of which event is already matched. The
  // guard therefore answers before validation, before the Idempotency-Key check
  // and before the If-Match check, exactly as it does for the four entities.
  {
    endpoint: "GET /v1/admin/event-experts",
    method: "GET",
    url: "/v1/admin/event-experts",
  },
  {
    endpoint: "GET /v1/admin/event-experts/:id",
    method: "GET",
    url: `/v1/admin/event-experts/${ABSENT_ID}`,
  },
  {
    endpoint: "POST /v1/admin/event-experts",
    method: "POST",
    url: "/v1/admin/event-experts",
    payload: {},
  },
  {
    endpoint: "PATCH /v1/admin/event-experts/:id",
    method: "PATCH",
    url: `/v1/admin/event-experts/${ABSENT_ID}`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/event-experts/:id/retire",
    method: "POST",
    url: `/v1/admin/event-experts/${ABSENT_ID}/retire`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/event-experts/:id/restore",
    method: "POST",
    url: `/v1/admin/event-experts/${ABSENT_ID}/restore`,
    payload: {},
  },
  // 012 EARS-6 (#1288) — the event↔project relationship surface. The floor
  // matters MORE here than on the entity verticals, not less: the two lifecycle
  // routes answer 428 when the `Lifecycle-Impact-Token` is missing, so without
  // the guard firing first an anonymous caller could read a protocol answer off
  // a relationship it may not know exists. There is no PATCH row because there
  // is no PATCH route — the join carries no mutable attribute.
  {
    endpoint: "GET /v1/admin/event-projects",
    method: "GET",
    url: "/v1/admin/event-projects",
  },
  {
    endpoint: "GET /v1/admin/event-projects/:id",
    method: "GET",
    url: `/v1/admin/event-projects/${ABSENT_ID}`,
  },
  {
    endpoint: "GET /v1/admin/event-projects/:id/lifecycle-impact",
    method: "GET",
    url: `/v1/admin/event-projects/${ABSENT_ID}/lifecycle-impact?transition=retire`,
  },
  {
    endpoint: "POST /v1/admin/event-projects",
    method: "POST",
    url: "/v1/admin/event-projects",
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/event-projects/:id/retire",
    method: "POST",
    url: `/v1/admin/event-projects/${ABSENT_ID}/retire`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/event-projects/:id/restore",
    method: "POST",
    url: `/v1/admin/event-projects/${ABSENT_ID}/restore`,
    payload: {},
  },
  // 012 EARS-11 (#1293) — the event↔topic curation surface. Same reasoning as
  // the event↔project block above: the lifecycle routes answer 428 on a missing
  // `Lifecycle-Impact-Token`, so the guard has to refuse first or an anonymous
  // caller reads a protocol answer off a relationship it may not know exists.
  // No PATCH row — the join carries no mutable attribute.
  {
    endpoint: "GET /v1/admin/event-topics",
    method: "GET",
    url: "/v1/admin/event-topics",
  },
  {
    endpoint: "GET /v1/admin/event-topics/:id",
    method: "GET",
    url: `/v1/admin/event-topics/${ABSENT_ID}`,
  },
  {
    endpoint: "GET /v1/admin/event-topics/:id/lifecycle-impact",
    method: "GET",
    url: `/v1/admin/event-topics/${ABSENT_ID}/lifecycle-impact?transition=retire`,
  },
  {
    endpoint: "POST /v1/admin/event-topics",
    method: "POST",
    url: "/v1/admin/event-topics",
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/event-topics/:id/retire",
    method: "POST",
    url: `/v1/admin/event-topics/${ABSENT_ID}/retire`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/event-topics/:id/restore",
    method: "POST",
    url: `/v1/admin/event-topics/${ABSENT_ID}/restore`,
    payload: {},
  },
  // 014 EARS-1/EARS-2/EARS-17 (#1339) — the recording routes hang under an event
  // path but are their own aggregate, and they sit on the same raised floor: the
  // guard refuses before the Idempotency-Key check, so a keyless anonymous
  // request is answered by authz, never by the protocol preamble.
  {
    endpoint: "GET /v1/admin/events/:eventId/recordings",
    method: "GET",
    url: `/v1/admin/events/${ABSENT_ID}/recordings`,
  },
  {
    endpoint: "POST /v1/admin/events/:eventId/recordings",
    method: "POST",
    url: `/v1/admin/events/${ABSENT_ID}/recordings`,
    payload: {},
  },
  {
    endpoint: "PATCH /v1/admin/events/:eventId/recordings/:recordingId",
    method: "PATCH",
    url: `/v1/admin/events/${ABSENT_ID}/recordings/${ABSENT_ID}`,
    payload: {},
  },
  {
    endpoint: "POST /v1/admin/events/:eventId/recordings/:recordingId/:command",
    method: "POST",
    url: `/v1/admin/events/${ABSENT_ID}/recordings/${ABSENT_ID}/publish`,
    payload: {},
  },
];

/** An authz refusal — never a 2xx, never a partially-served admin answer. */
function expectRefused(statusCode: number, endpoint: string): void {
  expect(
    [401, 403],
    `${endpoint} answered ${statusCode} to a principal that does not meet the EARS-11 floor — a role without a verified second factor is refused, never silently downgraded or partially served`,
  ).toContain(statusCode);
}

/**
 * 011 Verification row 11 — EARS-11, the raised endpoint-authz floor.
 *
 * Two halves, and both are load-bearing:
 *
 * 1. **Classification** — read off the SAME `@Authz` metadata the runtime guard
 *    and the generated matrix read (there is no second source to drift), asserted
 *    table-driven over the **discovered** route set rather than a hand-kept list,
 *    so a new admin route cannot escape the floor by never being added here.
 * 2. **Enforcement** — the classification is not the protection. A
 *    `platform_admin` session lacking a verified factor is driven against every
 *    admin route and must be refused on **all** of them: no read-only fallback,
 *    no partial data. A "safe subset" would be exactly the silent policy
 *    exception AGENTS.md §6 forbids.
 *
 * `mfa: true` is an invariant of {@link AdminSessionRecord} — no production code
 * path writes `false`, and the type says so. The refusal branch is therefore
 * defensive, and the only way to exercise it is to manufacture the record the
 * type forbids: that is the point of the cast below, not a shortcut around it.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-11 — admin endpoint-authz floor (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    let sessions: AdminSessionStore;
    let scanned: MatrixRow[];
    let violations: string[];
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `ears11-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function registerUser(email: string): Promise<string> {
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
      return rows[0]!.zitadel_sub;
    }

    async function registerAdmin(email: string): Promise<string> {
      const sub = await registerUser(email);
      await fake.grantProjectRole(sub, "platform_admin");
      return sub;
    }

    /** Headers for an established, MFA-verified admin session (the allowed principal). */
    async function adminHeadersFor(prefix: string): Promise<{
      headers: Record<string, string>;
      sub: string;
    }> {
      const email = uniqueEmail(prefix);
      const sub = await registerAdmin(email);
      const handle = await establishAdminSession(app, {
        identifier: email,
        password,
      });
      return { headers: handle.headers, sub };
    }

    /**
     * An **enrolled** operator: the full production enrollment arc, so the suite
     * holds the caller's TOTP secret. Only the EARS-13 removal route needs this —
     * its own route-local code check answers the SAME uniform 401 an authz
     * refusal does, so "not 401" cannot prove admission there; an actual 200
     * removal can.
     */
    async function enrolledOperator(): Promise<{
      headers: Record<string, string>;
      secret: string;
    }> {
      const email = uniqueEmail("enrolled");
      await registerAdmin(email);
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

      const verified = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/mfa/enroll/verify",
        headers: pendingHeaders,
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
        secret,
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
          [ADMIN_CSRF_HEADER]: csrf,
        },
      };
    }

    /**
     * A `platform_admin` session record carrying the ROLE but not a verified
     * factor — the principal EARS-11 says must be refused everywhere. It is
     * written straight into the store because no production path can produce it
     * (`mfa` is the literal type `true`), which is precisely the invariant under
     * test: the guard re-asserts it defensively instead of trusting it.
     */
    async function roleWithoutMfaHeaders(
      prefix: string,
    ): Promise<Record<string, string>> {
      const email = uniqueEmail(prefix);
      const sub = await registerAdmin(email);
      const sid = randomUUID();
      const csrfToken = randomUUID();
      const record = {
        sid,
        zitadelSessionId: `zitadel-${sid}`,
        sub,
        identifier: email,
        roles: ["platform_admin"],
        // The manufactured violation. Cast, because the type makes this state
        // unconstructible in production — see the describe-level note.
        mfa: false as unknown as true,
        fingerprint: computeFingerprint({
          userAgent: ADMIN_DEVICE["user-agent"],
          ip: INJECT_IP,
          acceptLanguage: ADMIN_DEVICE["accept-language"],
        }),
        csrfToken,
        expiresAtMs: Date.now() + 60 * 60 * 1000,
      } satisfies AdminSessionRecord;
      await sessions.create(record);
      return {
        ...ADMIN_DEVICE,
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrfToken}`,
        [ADMIN_CSRF_HEADER]: csrfToken,
      };
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      fake = app.get<FakeIdpClient>(IDP_CLIENT);
      sessions = app.get<AdminSessionStore>(ADMIN_SESSION_STORE);

      // The classification half reads the real router's `@Authz` metadata — the
      // same scan the `endpoint-authz` BLOCK guard and the matrix generator use.
      const scan = await scanRealRouteSet();
      scanned = scan.rows;
      violations = scan.violations;
    }, 60_000);

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    function adminRows(): MatrixRow[] {
      return scanned.filter((r) => r.endpoint.includes(" /v1/admin/"));
    }

    it("EARS-11.1: the endpoint-authz gate is clean and every admin route is classified — the floor rests on a valid matrix, not on an unchecked one", () => {
      expect(violations).toEqual([]);
      expect(adminRows().length).toBeGreaterThan(0);
    });

    it("EARS-11.2: every admin route that is not a design §9 auth-entry route is classified access: authenticated + required_roles: platform_admin", () => {
      for (const row of adminRows()) {
        const entry = ADMIN_ENTRY_CLASSIFICATION[row.endpoint];
        if (entry) {
          // An entry route is exempt from the floor only in the exact form
          // design §9 records — not merely by being under /v1/admin/auth.
          expect(row.meta.access, row.endpoint).toBe(entry.access);
          expect(row.meta.roles, row.endpoint).toEqual(entry.roles);
          continue;
        }
        expect(row.meta.access, row.endpoint).toBe("authenticated");
        expect(row.meta.roles, row.endpoint).toEqual(["platform_admin"]);
      }
    });

    it("EARS-11.3: the floor route table covers exactly the discovered set — a new admin route cannot escape by never being listed", () => {
      const discovered = adminRows()
        .filter((r) => r.meta.access === "authenticated")
        .map((r) => r.endpoint)
        .sort();
      const listed = FLOOR_ROUTES.map((r) => r.endpoint).sort();
      expect(discovered).toEqual(listed);
    });

    it("EARS-11.4: a platform_admin session WITHOUT a verified second factor is refused on every admin route", async () => {
      const headers = await roleWithoutMfaHeaders("nomfa");
      for (const route of FLOOR_ROUTES) {
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers,
          ...(route.payload === undefined ? {} : { payload: route.payload }),
        });
        expectRefused(res.statusCode, route.endpoint);
      }
    });

    it("EARS-11.5: a doctor_guest session and an anonymous caller are refused on every admin route", async () => {
      const portalEmail = uniqueEmail("doctor");
      await registerUser(portalEmail);
      const portal = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: portalEmail, password },
      });
      expect(portal.statusCode).toBe(200);
      const portalSid = portal.cookies.find(
        (c) => c.name === SESSION_COOKIE_NAME,
      )!.value;
      const portalHeaders = {
        ...ADMIN_DEVICE,
        cookie: `${SESSION_COOKIE_NAME}=${portalSid}`,
      };

      for (const route of FLOOR_ROUTES) {
        const withPortal = await app.inject({
          method: route.method,
          url: route.url,
          headers: portalHeaders,
          ...(route.payload === undefined ? {} : { payload: route.payload }),
        });
        expectRefused(
          withPortal.statusCode,
          `${route.endpoint} (doctor_guest)`,
        );

        const anonymous = await app.inject({
          method: route.method,
          url: route.url,
          headers: ADMIN_DEVICE,
          ...(route.payload === undefined ? {} : { payload: route.payload }),
        });
        expectRefused(anonymous.statusCode, `${route.endpoint} (anonymous)`);
      }
    });

    it("EARS-11.6: a platform_admin session WITH a verified second factor passes the floor on every admin route", async () => {
      for (const route of FLOOR_ROUTES) {
        if (route.endpoint === "DELETE /v1/admin/users/:id/mfa") {
          // The one route whose refusal of a WRONG CODE is the same uniform 401
          // an authz refusal is (EARS-13: "no distinct error") — so admission
          // here is proven by a real removal, not by the absence of a status.
          const operator = await enrolledOperator();
          const targetSub = await registerAdmin(uniqueEmail("floortarget"));
          fake.setTotpFactor(targetSub, true);
          const removed = await app.inject({
            method: "DELETE",
            url: `/v1/admin/users/${encodeURIComponent(targetSub)}/mfa`,
            headers: operator.headers,
            // The enrollment arc burned the current window's code; a replay of it
            // would be refused, so ask for the next window's.
            payload: {
              code: totpCode(
                operator.secret,
                Date.now() + TOTP_STEP_SECONDS * 1000,
              ),
            },
          });
          expect(
            removed.statusCode,
            `${route.endpoint} refused an MFA-verified platform_admin holding a valid caller code`,
          ).toBe(200);
          continue;
        }
        // A fresh session per route: `logout` consumes the one it is given, so
        // reusing one session would make later routes fail for reasons that are
        // not the floor.
        const { headers } = await adminHeadersFor("ok");
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers,
          ...(route.payload === undefined ? {} : { payload: route.payload }),
        });
        // The floor is about admission, not about the request being well-formed:
        // a 404 for an absent id or a 400 for an incomplete body means the
        // authorization layer let the principal through, which is the assertion.
        expect(
          [401, 403],
          `${route.endpoint} refused an MFA-verified platform_admin (${res.statusCode}) — the raised floor must admit exactly this principal`,
        ).not.toContain(res.statusCode);
      }
      // Explicit timeout: this case mints a fresh admin session per route, so its
      // runtime scales with the floor table, not with anything it asserts. The
      // 5 s default turns "the table grew" into a timeout that reads like a
      // guard failure; the assertion here is admission, never latency.
    }, 60_000);

    it("EARS-11.7: the 007 admin-events commands keep their shape on the raised floor", () => {
      // The 007 event commands only: 014's recording routes (#1339) hang under
      // the same path prefix but are a different feature with its own EARS
      // coverage, and they are asserted by the floor-table rows above.
      const events = adminRows().filter(
        (r) =>
          r.endpoint.includes(" /v1/admin/events") &&
          !r.endpoint.includes("/recordings"),
      );
      expect(events.length).toBe(10);
      for (const row of events) {
        // 007 EARS-8's classification, unchanged: only the floor beneath it rose.
        expect(row.meta.access, row.endpoint).toBe("authenticated");
        expect(row.meta.roles, row.endpoint).toEqual(["platform_admin"]);
        expect(row.meta.check, row.endpoint).toBe("fast-path");
        expect(row.meta.objectAttrs, row.endpoint).toBeUndefined();
        expect(row.meta.tests, row.endpoint).toContain("EARS-8");
      }
    });

    it("EARS-11.8: the generated matrix carries step_up: false on the EARS-13 factor-removal route — no advertised guard that does not exist", () => {
      const removal = adminRows().find(
        (r) => r.endpoint === "DELETE /v1/admin/users/:id/mfa",
      );
      expect(removal).toBeDefined();
      expect(removal!.meta.stepUp).toBeFalsy();
      expect(removal!.meta.audit).toBe("high-stakes");

      // …and the generated artifact says so too: the matrix is what a reader
      // consults, so a stale file would advertise the wrong posture even with
      // clean metadata behind it.
      const matrix = readFileSync(
        new URL("../../docs/endpoint-authz-matrix.md", import.meta.url),
        "utf8",
      );
      const line = matrix
        .split("\n")
        .find((l) => l.includes("DELETE /v1/admin/users/:id/mfa"));
      expect(
        line,
        "the generated endpoint-authz matrix has no row for the EARS-13 factor-removal route — regenerate it with `pnpm lint:endpoint-authz --generate`",
      ).toBeDefined();
      const columns = line!.split("|").map((c) => c.trim());
      expect(columns).toContain("authenticated");
      expect(columns).toContain("platform_admin");
      // Positional, not membership: `false` / `none` each also appear in other
      // columns, so pin the index. Split on `|` leaves columns[0] empty, so the
      // Nth data column is columns[N]: 6 = step_up, 7 = revalidate, 8 = audit.
      expect(columns[6]).toBe("false");
      // #1304 inserted `revalidate` between step_up and audit. The factor-removal
      // route is deliberately `none`: it carries 011's route-local fresh-TOTP
      // proof, a stronger statement than a window-freshness re-ask, so state that
      // posture positively rather than merely tolerating the new column.
      expect(columns[7]).toBe("none");
      expect(columns[8]).toBe("high-stakes");
    });
  },
);
