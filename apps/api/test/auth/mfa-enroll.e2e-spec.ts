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
import { RATE_LIMIT_THRESHOLDS, RELAXED_RATE_LIMIT } from "../setup/rate-limit.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";

const START_URL = "/v1/admin/auth/mfa/enroll/start";
const VERIFY_URL = "/v1/admin/auth/mfa/enroll/verify";

/**
 * The brand an admin's authenticator app must file this factor under, written
 * out **as a literal on purpose**: importing the production constant would make
 * the assertion tautological (it would prove the URI contains whatever the code
 * says), and this string is the owner's Stage-B decision on #1192, not an
 * implementation detail the code gets to change unilaterally.
 */
const ADMIN_TOTP_ISSUER = "Doctor.School Admin";

/** Split an `otpauth://totp/` URI into its decoded label and its parameters. */
function parseProvisioningUri(uri: string): {
  label: string;
  params: URLSearchParams;
} {
  const [path, query = ""] = uri.split("?");
  return {
    label: decodeURIComponent(path!.replace("otpauth://totp/", "")),
    params: new URLSearchParams(query),
  };
}

/**
 * 011 Verification row 5 — EARS-5: self-serve TOTP enrollment.
 *
 * The three load-bearing claims, each asserted directly against the API rather
 * than through the UI (design §10): the offer carries a scannable URI **and** a
 * transcribable secret and is not re-servable; a correct first code registers the
 * factor, writes a secret-free `auth.mfa.enrolled` row, and **upgrades the
 * pending authentication in place** into an admin session (LD-1 — the regression
 * that would matter is a re-introduced forced re-login); a wrong code leaves the
 * factor unconfirmed.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-5 — self-serve TOTP enrollment (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";

    /**
     * Every principal this suite registers, dropped in `afterEach`.
     *
     * Not hygiene for its own sake: the fake IdP numbers its subjects from a
     * per-app counter (`fake-sub-1`, `fake-sub-2`, …), so a `users` row left
     * behind by a previous run collides with the NEXT run's subject on the
     * `zitadel_sub` unique key. The registration cascade's `onConflictDoUpdate`
     * then quietly refreshes that stale row instead of inserting the new one, and
     * the suite fails claiming the mirror row never appeared. Cleaning up is what
     * keeps a re-run deterministic against a shared branch database.
     */
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1191enroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
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

    async function pendingRef(email: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: "mfa_pending_enrollment" });
      return res.cookies.find((c) => c.name === ADMIN_PENDING_COOKIE_NAME)!
        .value;
    }

    function pendingHeaders(ref: string): Record<string, string> {
      return { ...ADMIN_DEVICE, cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}` };
    }

    /** Drive the whole enrollment arc; resolves the offer + the verify response. */
    async function enroll(email: string): Promise<{
      sub: string;
      ref: string;
      secret: string;
      offer: Record<string, string>;
    }> {
      const sub = await registerAdmin(email);
      const ref = await pendingRef(email);
      const start = await app.inject({
        method: "POST",
        url: START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const offer = start.json() as Record<string, string>;
      return { sub, ref, secret: offer.secret!, offer };
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
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
      fake = app.get<FakeIdpClient>(IDP_CLIENT);
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-5.1: the enrollment offer carries a scannable URI AND the same secret in transcribable form", async () => {
      const email = uniqueEmail();
      const { secret, offer } = await enroll(email);

      // Transcribable: a base32 string a human can type, never image-only (EARS-12).
      expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
      // Scannable: the standard provisioning URI, carrying THAT secret — the QR
      // and the transcribed secret must enrol the same factor, or an operator who
      // cannot scan enrols a factor the server does not hold.
      expect(offer.provisioningUri).toMatch(/^otpauth:\/\/totp\//);
      expect(offer.provisioningUri).toContain(`secret=${secret}`);
      expect(offer.issuer).toBeTruthy();
      expect(offer.account).toBeTruthy();
    });

    it("EARS-5.1.1: the authenticator entry is branded Doctor.School Admin + the operator's email, in the URI and in the offer's labels alike", async () => {
      const email = uniqueEmail();
      const { offer } = await enroll(email);

      // The owner's Stage-B verdict on #1192: an entry reading «Zitadel» names a
      // component the operator has never heard of, on the one screen where they
      // must know WHICH login this code belongs to. The BFF rebuilds the URI, so
      // the IdP's own default label must not survive anywhere in it.
      expect(offer.provisioningUri).not.toMatch(/zitadel/i);

      // RAW substring first, BEFORE any parse. `URLSearchParams` decodes `+` as a
      // space, so a parsed assertion round-trips clean over a form-encoded
      // `issuer=Doctor.School+Admin` and cannot see the defect at all — while a
      // strict RFC-3986 authenticator reads that `+` literally and files the
      // factor under «Doctor.School+Admin». The path label is percent-encoded, so
      // this is also the assertion that the URI spells the issuer ONE way.
      expect(offer.provisioningUri).toContain("issuer=Doctor.School%20Admin");
      expect(offer.provisioningUri).not.toContain("issuer=Doctor.School+Admin");

      const parsed = parseProvisioningUri(offer.provisioningUri);
      expect(parsed.label).toBe(`${ADMIN_TOTP_ISSUER}:${email}`);
      expect(parsed.params.get("issuer")).toBe(ADMIN_TOTP_ISSUER);
      // The manual-entry block on the screen renders these two fields, so they
      // must be the SAME strings the QR encodes — one source, or a hand-typed
      // factor lands under a different name than a scanned one.
      expect(offer.issuer).toBe(ADMIN_TOTP_ISSUER);
      expect(offer.account).toBe(email);

      // Re-labelling is cosmetic and must stay cosmetic: the parameters an
      // authenticator computes codes with are still declared explicitly, so a
      // rebuilt URI can never silently hand the operator a wrong algorithm.
      expect(parsed.params.get("algorithm")).toBe("SHA1");
      expect(parsed.params.get("digits")).toBe("6");
      expect(parsed.params.get("period")).toBe("30");
    });

    it("EARS-5.1.2: a code derived from the REBUILT URI's own secret enrols the factor", async () => {
      const email = uniqueEmail();
      const { sub, ref, offer } = await enroll(email);

      // The interop proof, taken end-to-end through the artifact the operator
      // actually scans: read the secret out of the provisioning URI (as an
      // authenticator app does), derive the code from THAT, and submit it. If the
      // rebuild ever dropped or mangled the secret, this is where it fails —
      // asserting only on `offer.secret` would keep passing while every scanned
      // QR produced a factor the server does not hold.
      const scanned = parseProvisioningUri(offer.provisioningUri).params.get(
        "secret",
      );
      expect(scanned).toBe(offer.secret);

      const verify = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(scanned!) },
      });
      expect(verify.statusCode).toBe(200);
      expect(await fake.hasTotpFactor(sub)).toBe(true);
    });

    it("EARS-5.2: the offer is not re-servable — a re-start replaces the provisional factor", async () => {
      const email = uniqueEmail();
      const { ref, secret: first } = await enroll(email);

      const restart = await app.inject({
        method: "POST",
        url: START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(restart.statusCode).toBe(200);
      const second = (restart.json() as { secret: string }).secret;
      expect(second).not.toBe(first);

      // The replaced secret no longer enrols anything: the old provisional factor
      // is gone, not parked alongside the new one.
      const stale = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(first) },
      });
      expect(stale.statusCode).toBe(401);
    });

    it("EARS-5.3: a correct first code registers the factor and issues the admin session IN PLACE (LD-1)", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await enroll(email);
      expect(await fake.hasTotpFactor(sub)).toBe(false);

      const verify = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });

      expect(verify.statusCode).toBe(200);
      expect(verify.json()).toEqual({ state: "active" });
      // No second login (LD-1): the response itself carries the admin session.
      const session = verify.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      );
      expect(session, "enrollment verify must issue the admin session").toBeDefined();
      expect(session!.value).toBeTruthy();
      expect(verify.cookies.some((c) => c.name === ADMIN_CSRF_COOKIE_NAME)).toBe(
        true,
      );
      // The pending reference is consumed — it never coexists with the session.
      const cleared = verify.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      );
      expect(cleared?.value).toBe("");
      // The factor is now REGISTERED at the IdP, not merely provisional.
      expect(await fake.hasTotpFactor(sub)).toBe(true);
    });

    it("EARS-5.4: enrollment appends exactly one auth.mfa.enrolled row, and no row ever carries the secret", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await enroll(email);
      // The fake IdP numbers subjects per app instance, so the same `fake-sub-N`
      // string is minted by every suite in the run and the ledger is append-only:
      // the window pins the assertion to THIS enrollment's rows rather than every
      // row any suite ever wrote for that subject id. The bound comes from the
      // ledger's own clock — Postgres stamps `created_at`, and on a dev stand it
      // sits on another host tens of ms off, so a `new Date()` fence lands on the
      // wrong side of the very row this test just wrote.
      const since = await dbNow();
      const verify = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(verify.statusCode).toBe(200);

      const { rows } = await pool.query<{
        event_type: string;
        metadata: Record<string, unknown>;
      }>(
        "SELECT event_type, metadata FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2 ORDER BY created_at ASC",
        [sub, since],
      );
      const enrolled = rows.filter((r) => r.event_type === "auth.mfa.enrolled");
      expect(enrolled).toHaveLength(1);
      expect(enrolled[0]!.metadata).toMatchObject({
        method: "totp",
        tier: "admin",
      });
      // The session was established through the same lifecycle, one row each.
      expect(
        rows.filter((r) => r.event_type === "auth.session.created"),
      ).toHaveLength(1);

      // Property assertion: NO emitted row anywhere mentions the secret, the
      // provisioning URI, or the submitted code (EARS-5 / EARS-9 invariant).
      const everything = await pool.query<{ blob: string }>(
        "SELECT coalesce(metadata::text, '') || coalesce(reason, '') AS blob FROM audit_ledger",
      );
      for (const row of everything.rows) {
        expect(row.blob).not.toContain(secret);
        expect(row.blob).not.toContain("otpauth://");
      }
    });

    it("EARS-5.5: a wrong code leaves the factor unconfirmed and the operator on the enrollment step", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await enroll(email);

      const wrong = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: "000000" },
      });
      expect(wrong.statusCode).toBe(401);
      expect(
        wrong.cookies.some((c) => c.name === ADMIN_SESSION_COOKIE_NAME),
      ).toBe(false);
      expect(await fake.hasTotpFactor(sub)).toBe(false);

      // The pending authentication survives a wrong code — the operator retries
      // on the SAME provisional factor rather than being thrown back to login.
      const retry = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(retry.statusCode).toBe(200);
    });

    it("EARS-5.6: an enrolled admin's next login is a CHALLENGE, and the enrollment endpoints close behind them", async () => {
      const email = uniqueEmail();
      const { ref, secret } = await enroll(email);
      const first = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(first.statusCode).toBe(200);

      // The bootstrap ran ONCE (PD-1): the factor now exists, so primary auth
      // routes to the challenge step — and the enrollment endpoints, which serve
      // `mfa_enrollment_required` only, refuse that pending reference. A second
      // enrollment would silently replace a live second factor with one an
      // attacker holding the password just registered.
      const relogin = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(relogin.statusCode).toBe(200);
      expect(relogin.json()).toEqual({ state: "mfa_pending_challenge" });

      const challengeRef = relogin.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;
      for (const url of [START_URL, VERIFY_URL]) {
        const res = await app.inject({
          method: "POST",
          url,
          headers: pendingHeaders(challengeRef),
          payload: { code: totpCode(secret) },
        });
        expect(res.statusCode, `${url} for a challenge-step principal`).toBe(
          401,
        );
      }
    });

    it("EARS-5.7: the code field is constrained by the schema — non-numeric input is rejected before the handler", async () => {
      const email = uniqueEmail();
      const { ref } = await enroll(email);
      for (const code of ["abcdef", "12345", "1234567", ""]) {
        const res = await app.inject({
          method: "POST",
          url: VERIFY_URL,
          headers: pendingHeaders(ref),
          payload: { code },
        });
        expect(res.statusCode, `code ${JSON.stringify(code)}`).toBe(400);
      }
    });
  },
);
