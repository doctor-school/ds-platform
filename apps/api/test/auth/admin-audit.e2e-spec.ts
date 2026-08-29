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
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_CSRF_HEADER,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { MFA_LOCKOUT_THRESHOLD } from "../../src/auth/admin-session/mfa-lockout.service.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { toLedgerRow } from "../../src/auth/session/auth-audit.ledger.js";
import type { AuthAuditEvent } from "../../src/auth/session/auth-audit.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

const LOGIN_URL = "/v1/admin/auth/login";
const ENROLL_START_URL = "/v1/admin/auth/mfa/enroll/start";
const ENROLL_VERIFY_URL = "/v1/admin/auth/mfa/enroll/verify";
const CHALLENGE_URL = "/v1/admin/auth/mfa/verify";
const LOGOUT_URL = "/v1/admin/auth/logout";

/**
 * The **canonical wire ids** the 011 requirements → Event Model → Events mapping
 * table assigns (normative). Nothing outside this set may be written by the admin
 * tier: 011 invents no id and defines no parallel taxonomy, so a drifted or
 * invented id has to fail loudly rather than land quietly in the ledger.
 */
const CANONICAL_ADMIN_WIRE_IDS = [
  "auth.login.success",
  "auth.login.failure",
  "auth.mfa.enrolled",
  "auth.mfa.used",
  "auth.mfa.failure",
  "auth.mfa.reset",
  "auth.lockout.triggered",
  "auth.session.created",
  "auth.session.terminated",
  "auth.session.rejected",
] as const;

/**
 * 011 EARS-9 — the canonical §7.3 wire-id mapping, asserted **table-driven over
 * all ten rows** of the requirements Event Model mapping table.
 *
 * This half is a pure assertion over the single shipped mapper (`toLedgerRow`),
 * deliberately outside the DB-gated describe below: the mapping is what the EARS
 * clause makes normative ("exactly the canonical wire id its domain event maps to
 * … no invented id and no parallel taxonomy"), and a mapping regression must fail
 * on every runner, not only where `DATABASE_URL` happens to be set. The e2e half
 * then proves the rows actually reach the ledger through that mapper.
 */
describe("011 EARS-9 — canonical wire-id mapping (Event Model → Events)", () => {
  const mask = (identifier: string): string => `hashed:${identifier}`;

  /** One row of the normative mapping table: domain event → wire id + discriminating fields. */
  const MAPPING: {
    event: AuthAuditEvent;
    wireId: string;
    reason: string | null;
    metadata: Record<string, unknown>;
  }[] = [
    {
      event: { type: "AdminPrimaryAuthSucceeded", sub: "sub-1" },
      wireId: "auth.login.success",
      reason: null,
      metadata: { method: "password", tier: "admin" },
    },
    {
      event: {
        type: "AdminPrimaryAuthFailed",
        identifier: "admin@ds.test",
        sub: null,
        reason: "wrong_password",
      },
      wireId: "auth.login.failure",
      reason: "wrong_password",
      metadata: { identifier_hash: "hashed:admin@ds.test", tier: "admin" },
    },
    {
      event: { type: "MfaEnrolled", sub: "sub-1" },
      wireId: "auth.mfa.enrolled",
      reason: null,
      metadata: { method: "totp", tier: "admin" },
    },
    {
      event: { type: "MfaChallengeSucceeded", sub: "sub-1" },
      wireId: "auth.mfa.used",
      reason: null,
      metadata: { method: "totp", tier: "admin" },
    },
    {
      event: {
        type: "MfaChallengeFailed",
        sub: "sub-1",
        stage: "challenge",
        reason: "invalid",
      },
      wireId: "auth.mfa.failure",
      reason: "invalid",
      metadata: { method: "totp", stage: "challenge", tier: "admin" },
    },
    {
      event: { type: "MfaFactorRemoved", sub: "sub-2", byAdmin: "sub-1" },
      wireId: "auth.mfa.reset",
      reason: null,
      metadata: { by_admin: "sub-1", tier: "admin" },
    },
    {
      event: { type: "LockoutTriggered", sub: "sub-1" },
      wireId: "auth.lockout.triggered",
      reason: "mfa_attempts",
      metadata: { tier: "admin" },
    },
    {
      event: { type: "AdminSessionEstablished", sub: "sub-1", sid: "sid-1" },
      wireId: "auth.session.created",
      reason: null,
      metadata: { tier: "admin" },
    },
    {
      event: {
        type: "AdminSessionEnded",
        sub: "sub-1",
        sid: "sid-1",
        reason: "logout",
      },
      wireId: "auth.session.terminated",
      reason: "logout",
      metadata: { tier: "admin" },
    },
    {
      event: {
        type: "AdminSessionRejected",
        sub: "sub-1",
        reason: "wrong_cookie",
      },
      wireId: "auth.session.rejected",
      reason: "wrong_cookie",
      metadata: { tier: "admin" },
    },
  ];

  it.each(MAPPING)(
    "EARS-9.1: $event.type maps to exactly the canonical wire id $wireId, carrying tier: admin",
    ({ event, wireId, reason, metadata }) => {
      const row = toLedgerRow(event, mask);
      // Exactly the canonical id — not "starts with auth.", not "contains".
      expect(row.eventType).toBe(wireId);
      expect(CANONICAL_ADMIN_WIRE_IDS).toContain(row.eventType);
      expect(row.reason).toBe(reason);
      // The tier discriminator is what keeps an admin forensic query from
      // silently returning portal rows on the shared auth.session.* /
      // auth.login.* classes; every admin-tier row carries it.
      expect(row.metadata).toEqual(metadata);
      expect((row.metadata as Record<string, unknown>).tier).toBe("admin");
    },
  );

  it("EARS-9.1: the mapping table covers every admin-tier wire id and adds none beyond it", () => {
    const mapped = new Set(MAPPING.map((m) => m.wireId));
    expect([...mapped].sort()).toEqual([...CANONICAL_ADMIN_WIRE_IDS].sort());
  });
});

/**
 * 011 Verification row 9 — EARS-9, the admin-session/MFA audit trail as it
 * actually lands in `audit_ledger`.
 *
 * The assertions that matter here are the ones a "did it return 200?" test cannot
 * make: **exactly one terminal row per lifecycle event** (not zero, not two),
 * under the canonical §7.3 id, carrying `tier: "admin"` so admin rows stay
 * separable from the portal's on the shared classes — plus the property
 * assertion that no row anywhere in the arc carries the TOTP secret, the
 * provisioning URI, or a submitted code, and that PD is masked.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-9 — admin audit trail (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `ears9-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
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

    interface LedgerRow {
      event_type: string;
      subject_id: string | null;
      sid: string | null;
      reason: string | null;
      metadata: Record<string, unknown>;
    }

    /** Every row this run appended for `sub` (the fake's subject numbering repeats across runs). */
    async function rowsFor(sub: string, since: Date): Promise<LedgerRow[]> {
      const { rows } = await pool.query<LedgerRow>(
        `SELECT event_type, subject_id, sid, reason, metadata FROM audit_ledger
         WHERE subject_id = $1 AND created_at >= $2 ORDER BY created_at ASC`,
        [sub, since],
      );
      return rows;
    }

    /** Every row appended since `since`, subject or not — the property-scan surface. */
    async function allRowsSince(since: Date): Promise<LedgerRow[]> {
      const { rows } = await pool.query<LedgerRow>(
        `SELECT event_type, subject_id, sid, reason, metadata FROM audit_ledger
         WHERE created_at >= $1 ORDER BY created_at ASC`,
        [since],
      );
      return rows;
    }

    function only(rows: LedgerRow[], eventType: string): LedgerRow[] {
      return rows.filter((r) => r.event_type === eventType);
    }

    async function registerUser(prefix: string): Promise<{
      email: string;
      sub: string;
    }> {
      return registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail(prefix),
        password,
        consent,
      });
    }

    async function registerAdmin(prefix: string): Promise<{
      email: string;
      sub: string;
    }> {
      const identity = await registerUser(prefix);
      await fake.grantProjectRole(identity.sub, "platform_admin");
      return identity;
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

    /**
     * A code from the NEXT time step: a TOTP code is single-use inside its
     * window, so a second verification in the same window is a replay.
     */
    function nextWindowCode(secret: string): string {
      return totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);
    }

    interface EnrolledAdmin {
      email: string;
      sub: string;
      secret: string;
      /** The whole one-time enrollment offer — the property scan's needle set. */
      offer: Record<string, unknown>;
      headers: Record<string, string>;
      submittedCodes: string[];
    }

    /** The production enrollment arc, end to end: login → offer → correct first code → session (LD-1). */
    async function enrol(prefix: string): Promise<EnrolledAdmin> {
      const { email, sub } = await registerAdmin(prefix);
      const { ref, state } = await primaryAuth(email);
      expect(state).toBe("mfa_pending_enrollment");

      const start = await app.inject({
        method: "POST",
        url: ENROLL_START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const offer = start.json() as Record<string, unknown>;
      const secret = offer.secret as string;

      const code = totpCode(secret);
      const verified = await app.inject({
        method: "POST",
        url: ENROLL_VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code },
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
        offer,
        submittedCodes: [code],
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
          [ADMIN_CSRF_HEADER]: csrf,
        },
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
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-9.2: the enrollment arc appends exactly one terminal row per lifecycle event under its canonical wire id, each carrying tier: admin", async () => {
      const since = await dbNow();
      const admin = await enrol("enrol");

      const rows = await rowsFor(admin.sub, since);
      // Primary auth at the admin origin, the factor's registration, and the
      // in-place upgrade to a session (LD-1) are three distinct lifecycle
      // events — one row each, no more.
      expect(only(rows, "auth.login.success")).toHaveLength(1);
      expect(only(rows, "auth.mfa.enrolled")).toHaveLength(1);
      expect(only(rows, "auth.session.created")).toHaveLength(1);

      expect(only(rows, "auth.login.success")[0]!.metadata).toMatchObject({
        method: "password",
        tier: "admin",
      });
      expect(only(rows, "auth.mfa.enrolled")[0]!.metadata).toMatchObject({
        method: "totp",
        tier: "admin",
      });
      const created = only(rows, "auth.session.created")[0]!;
      expect(created.metadata).toMatchObject({ tier: "admin" });
      // The actor and the session are both on the row — a session row that
      // named neither could not reconstruct the login it belongs to.
      expect(created.subject_id).toBe(admin.sub);
      expect(created.sid).toBeTruthy();

      // No id outside the canonical set was written by the ADMIN tier. Scoped by
      // the tier field rather than by subject: the same principal also holds
      // 003's own rows (its `auth.register`), which 011 neither owns nor renames.
      for (const row of rows.filter((r) => r.metadata.tier === "admin")) {
        expect(CANONICAL_ADMIN_WIRE_IDS).toContain(row.event_type);
      }
    });

    it("EARS-9.3: the challenge arc appends exactly one auth.mfa.used + one auth.session.created, and logout exactly one auth.session.terminated", async () => {
      const admin = await enrol("challenge");

      // Log the enrollment session out first, so the window below contains only
      // the challenge arc's rows and the counts are unambiguous.
      const loggedOut = await app.inject({
        method: "POST",
        url: LOGOUT_URL,
        headers: admin.headers,
      });
      expect(loggedOut.statusCode).toBe(200);

      const since = await dbNow();
      const { ref, state } = await primaryAuth(admin.email);
      expect(state).toBe("mfa_pending_challenge");
      const verified = await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(ref),
        payload: { code: nextWindowCode(admin.secret) },
      });
      expect(verified.statusCode).toBe(200);

      const sid = verified.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      )!.value;
      const csrf = verified.cookies.find(
        (c) => c.name === ADMIN_CSRF_COOKIE_NAME,
      )!.value;
      const secondLogout = await app.inject({
        method: "POST",
        url: LOGOUT_URL,
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
          [ADMIN_CSRF_HEADER]: csrf,
        },
      });
      expect(secondLogout.statusCode).toBe(200);

      const rows = await rowsFor(admin.sub, since);
      // A satisfied second factor is `auth.mfa.used`, NOT a second
      // `auth.mfa.enrolled` — a forensic reader asking "when did this operator
      // last prove possession?" must not have to guess which a row meant.
      expect(only(rows, "auth.mfa.used")).toHaveLength(1);
      expect(only(rows, "auth.mfa.enrolled")).toHaveLength(0);
      expect(only(rows, "auth.session.created")).toHaveLength(1);
      expect(only(rows, "auth.session.terminated")).toHaveLength(1);

      expect(only(rows, "auth.mfa.used")[0]!.metadata).toMatchObject({
        method: "totp",
        tier: "admin",
      });
      const terminated = only(rows, "auth.session.terminated")[0]!;
      expect(terminated.reason).toBe("logout");
      expect(terminated.metadata).toMatchObject({ tier: "admin" });
      expect(terminated.sid).toBe(sid);
    });

    it("EARS-9.4: a refused admin primary auth appends exactly one auth.login.failure carrying tier: admin and a masked identifier — never the raw one", async () => {
      const { email } = await registerAdmin("badpw");
      const since = await dbNow();

      const res = await app.inject({
        method: "POST",
        url: LOGIN_URL,
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password: "wrong-password-here" },
      });
      expect(res.statusCode).toBe(401);

      // The row is identifier-keyed (no subject on a pre-identity branch), so
      // scope by class + tier within this run's window.
      const failures = (await allRowsSince(since)).filter(
        (r) =>
          r.event_type === "auth.login.failure" &&
          r.metadata.tier === "admin" &&
          typeof r.metadata.identifier_hash === "string",
      );
      expect(failures).toHaveLength(1);
      // PD masking (ADR-0001 §7): the raw identifier appears nowhere in the row.
      expect(JSON.stringify(failures[0])).not.toContain(email);
    });

    it("EARS-9.5: refused TOTP verifications append auth.mfa.failure rows and exactly one auth.lockout.triggered at the §7 threshold", async () => {
      const admin = await enrol("lockout");
      await app.inject({
        method: "POST",
        url: LOGOUT_URL,
        headers: admin.headers,
      });

      const since = await dbNow();
      const { ref } = await primaryAuth(admin.email);
      for (let attempt = 0; attempt < MFA_LOCKOUT_THRESHOLD; attempt++) {
        const res = await app.inject({
          method: "POST",
          url: CHALLENGE_URL,
          headers: pendingHeaders(ref),
          payload: { code: "000000" },
        });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
      }

      const rows = await rowsFor(admin.sub, since);
      const failures = only(rows, "auth.mfa.failure");
      // Every refusal is evidenced — the threshold used to be a number with no
      // trail behind it.
      expect(failures.length).toBeGreaterThanOrEqual(MFA_LOCKOUT_THRESHOLD);
      for (const row of failures) {
        expect(row.metadata).toMatchObject({
          method: "totp",
          stage: "challenge",
          tier: "admin",
        });
        // 011 design §8a: the submitted code is absent from the event shape, so
        // no mapper edit can leak it into a row.
        expect(JSON.stringify(row)).not.toContain("000000");
      }

      // Exactly once — the state transition, not once per attempt while locked.
      const lockouts = only(rows, "auth.lockout.triggered");
      expect(lockouts).toHaveLength(1);
      expect(lockouts[0]!.reason).toBe("mfa_attempts");
      expect(lockouts[0]!.metadata).toMatchObject({ tier: "admin" });
    });

    it("EARS-9.6: an admin route refusing a portal cookie appends exactly one auth.session.rejected carrying its reason and tier: admin", async () => {
      const { email: portalEmail } = await registerUser("portal");
      const portal = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: portalEmail, password },
      });
      const portalSid = portal.cookies.find(
        (c) => c.name === SESSION_COOKIE_NAME,
      )!.value;

      const since = await dbNow();
      const refused = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${SESSION_COOKIE_NAME}=${portalSid}`,
        },
      });
      expect(refused.statusCode).toBeGreaterThanOrEqual(401);

      // The one id 011 adds — a new event inside the EXISTING canonical
      // `auth.session` class, registered upstream by the forward-reference line
      // in ADR-0001 design §7.3.
      const rejected = (await allRowsSince(since)).filter(
        (r) => r.event_type === "auth.session.rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBe("wrong_cookie");
      expect(rejected[0]!.metadata).toMatchObject({ tier: "admin" });
    });

    it("EARS-9.7: operator factor removal appends exactly one auth.mfa.reset naming the acting operator in by_admin", async () => {
      const operator = await enrol("operator");
      const { sub: targetSub } = await registerAdmin("target");
      fake.setTotpFactor(targetSub, true);

      const since = await dbNow();
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/admin/users/${encodeURIComponent(targetSub)}/mfa`,
        headers: operator.headers,
        payload: { code: nextWindowCode(operator.secret) },
      });
      expect(res.statusCode).toBe(200);

      const resets = only(await rowsFor(targetSub, since), "auth.mfa.reset");
      expect(resets).toHaveLength(1);
      // `subject_id` names WHOSE factor is gone; `by_admin` names WHO did it — a
      // row carrying one without the other answers half the forensic question.
      expect(resets[0]!.subject_id).toBe(targetSub);
      expect(resets[0]!.metadata).toMatchObject({
        by_admin: operator.sub,
        tier: "admin",
      });
    });

    it("EARS-9.8: admin rows are separable from portal rows on the shared auth.login.* / auth.session.* classes by the tier field alone", async () => {
      const since = await dbNow();
      const admin = await enrol("tier");

      const { email: portalEmail, sub: portalSub } =
        await registerUser("tierportal");
      const portalLogin = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: portalEmail, password },
      });
      expect(portalLogin.statusCode).toBe(200);
      const adminRows = await rowsFor(admin.sub, since);
      const portalRows = await rowsFor(portalSub, since);

      // Both tiers wrote the SAME canonical class…
      expect(only(adminRows, "auth.login.success")).toHaveLength(1);
      expect(only(portalRows, "auth.login.success")).toHaveLength(1);
      // …and the tier field alone tells them apart. 011 does not claim portal
      // rows carry a tier — back-filling `tier: "portal"` is owned by no clause
      // here — so the discriminator is the PRESENCE of `tier: "admin"`, which is
      // all the separability assertion needs.
      expect(only(adminRows, "auth.login.success")[0]!.metadata.tier).toBe(
        "admin",
      );
      expect(
        only(portalRows, "auth.login.success")[0]!.metadata.tier,
      ).toBeUndefined();

      const adminOnly = [...adminRows, ...portalRows].filter(
        (r) => r.metadata.tier === "admin",
      );
      expect(adminOnly.every((r) => r.subject_id === admin.sub)).toBe(true);
    });

    it("EARS-9.9: no emitted row carries the TOTP secret, the provisioning URI, or a submitted code, and PD is masked", async () => {
      const since = await dbNow();
      const admin = await enrol("secrets");

      // Add a refused verification, so the scan also covers the failure path —
      // the one place a "helpful" reason field would be tempted to echo input.
      const { ref } = await primaryAuth(admin.email);
      const wrongCode = "424242";
      await app.inject({
        method: "POST",
        url: CHALLENGE_URL,
        headers: pendingHeaders(ref),
        payload: { code: wrongCode },
      });

      // Every string the one-time enrollment offer returned — the secret, the
      // provisioning URI, the QR payload, the labels — read off the response
      // itself rather than named field by field, so a NEW secret-bearing field
      // added to the offer is covered by this assertion the day it appears.
      const needles = [
        ...Object.values(admin.offer).filter(
          (v): v is string => typeof v === "string" && v.length >= 6,
        ),
        ...admin.submittedCodes,
        wrongCode,
        admin.email,
      ];
      expect(needles).toContain(admin.secret);

      const haystack = JSON.stringify(await allRowsSince(since));
      for (const needle of needles) {
        expect(
          haystack.includes(needle),
          `an audit row leaked "${needle.slice(0, 8)}…" — the ledger must never carry the TOTP secret, the provisioning URI, a submitted code, or raw PD (011 EARS-9, ADR-0001 §7)`,
        ).toBe(false);
      }
    });
  },
);
