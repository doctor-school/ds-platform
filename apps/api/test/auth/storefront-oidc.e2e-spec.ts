import { randomBytes } from "node:crypto";
import { Logger, VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { IdpSession } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  SESSION_STORE,
  type SessionStore,
} from "../../src/auth/session/session.types.js";
import { resolveTrustProxy } from "../../src/config/trust-proxy.js";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { RECORD_COOKIE_NAME } from "../../src/sign-in-host/sign-in-host.cookies.js";
import { FakeSignInHostIdp } from "../../src/sign-in-host/sign-in-host.idp.fake.js";
import { SIGN_IN_HOST_IDP } from "../../src/sign-in-host/sign-in-host.idp.js";
import { FakeStorefrontOidc } from "../../src/sign-in-host/storefront-oidc.idp.fake.js";
import { STOREFRONT_OIDC_IDP } from "../../src/sign-in-host/storefront-oidc.idp.js";
import {
  STOREFRONT_ENTRY_RATE_LIMIT_SCOPE,
  STOREFRONT_REDEEM_RATE_LIMIT_SCOPE,
} from "../../src/sign-in-host/storefront-oidc.controller.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// The sign-in-host block and the internal credential are read at module
// compile; a bare run gets a complete, dev-only block (the CI job sets its own).
process.env.IDP_ACADEMY_CLIENT_ID ||= "academy-client-e2e";
process.env.IDP_DOCTOR_CLIENT_ID ||= "doctor-client-e2e";
process.env.IDP_SIGN_IN_BASE_URI ||= "http://localhost:3005";
process.env.SIGN_IN_ACADEMY_LOGIN_URL ||= "http://localhost:3001/login";
process.env.SIGN_IN_DOCTOR_LOGIN_URL ||= "http://localhost:3004/login";
process.env.SIGN_IN_RECORD_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.INTERNAL_API_TOKEN ||=
  "e2e-internal-api-token-of-at-least-32-bytes";

const ACADEMY = process.env.IDP_ACADEMY_CLIENT_ID;
const DOCTOR = process.env.IDP_DOCTOR_CLIENT_ID;
const TOKEN = process.env.INTERNAL_API_TOKEN;
const HOST_ORIGIN = new URL(process.env.IDP_SIGN_IN_BASE_URI).origin;
const ACADEMY_CALLBACK = "http://localhost:3001/auth/callback";
const DOCTOR_CALLBACK = "http://localhost:3004/auth/callback";
const PASSWORD = "Aa1!ufficiently-long-pw";
const CONSENT = [{ purpose: "tos", version: "2026-01" }];
const DEVICE = {
  "user-agent": "StorefrontTest/1.0",
  "accept-language": "ru-RU",
};
const INTERNAL = { ...DEVICE, authorization: `Bearer ${TOKEN}` };

class Jar {
  readonly values = new Map<string, string>();
  apply(cookies: Array<{ name: string; value: string; maxAge?: number }>) {
    for (const c of cookies) {
      if (c.maxAge === 0 || c.value === "") this.values.delete(c.name);
      else this.values.set(c.name, c.value);
    }
  }
  header(): string {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function compile(thresholds = RELAXED_RATE_LIMIT) {
  const idp = new FakeIdpClient();
  const hostIdp = new FakeSignInHostIdp();
  const oidc = new FakeStorefrontOidc();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDP_CLIENT)
    .useValue(idp)
    .overrideProvider(SIGN_IN_HOST_IDP)
    .useValue(hostIdp)
    .overrideProvider(STOREFRONT_OIDC_IDP)
    .useValue(oidc)
    .overrideProvider(RATE_LIMIT_THRESHOLDS)
    .useValue(thresholds)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    // The deployment's trusted-proxy resolution (#1655): the storefront
    // server is a private-network peer, so its forwarded client IP is believed.
    new FastifyAdapter({ trustProxy: resolveTrustProxy({}) }),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, idp, hostIdp, oidc };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Storefront OIDC internal API (e2e)",
  () => {
    let app: NestFastifyApplication;
    let idp: FakeIdpClient;
    let hostIdp: FakeSignInHostIdp;
    let oidc: FakeStorefrontOidc;
    let pool: pg.Pool;
    const created: string[] = [];

    beforeAll(async () => {
      ({ app, idp, hostIdp, oidc } = await compile());
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      for (const email of created.splice(0)) {
        await pool.query(
          "DELETE FROM sign_in_host_records WHERE subject IN (SELECT zitadel_sub FROM users WHERE email = $1)",
          [email],
        );
        await deleteUserFixture(pool, "email", email);
      }
    });
    afterAll(async () => {
      await app.close();
    });

    async function account(tag: string): Promise<string> {
      const address = `sfo-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      created.push(address);
      const r = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email: address, password: PASSWORD, consent: CONSENT },
      });
      expect(r.statusCode, r.body).toBe(200);
      const v = await app.inject({
        method: "POST",
        url: "/v1/auth/verify",
        headers: DEVICE,
        payload: {
          email: address,
          code: FAKE_VALID_CODE,
          registration: { password: PASSWORD, consent: CONSENT },
        },
      });
      expect(v.statusCode).toBe(200);
      return address;
    }

    /** A credential step on the sign-in host in `jar`; returns the Zitadel session it put in the record. */
    async function hostSignIn(
      jar: Jar,
      address: string,
      extra: { prompt?: string[] } = {},
    ): Promise<IdpSession> {
      const authRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        ...extra,
      });
      const entry = await app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
        headers: { ...DEVICE, cookie: jar.header() },
      });
      jar.apply(entry.cookies);
      const body = entry.json() as { action: string; csrf?: string };
      expect(body.action).toBe("render");
      const res = await app.inject({
        method: "POST",
        url: "/v1/sign-in-host/login",
        headers: {
          ...DEVICE,
          origin: HOST_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: jar.header(),
        },
        payload: {
          identifier: address,
          password: PASSWORD,
          authRequest,
          csrf: body.csrf,
        },
      });
      expect(res.statusCode).toBe(200);
      jar.apply(res.cookies);
      const last = hostIdp.finalised.at(-1);
      if (!last || !("session" in last)) throw new Error("not finalised");
      return last.session;
    }

    /** EARS-61 — the storefront entry's transaction, created and held by the API. */
    async function transaction(
      client: "academy" | "doctor" = "academy",
      extra: Record<string, unknown> = {},
    ) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/internal/oidc/transaction",
        headers: INTERNAL,
        payload: { client, kind: "interactive", door: "login", ...extra },
      });
      expect(res.statusCode, res.body).toBe(200);
      const { txId, authorizeUrl } = res.json() as {
        txId: string;
        authorizeUrl: string;
      };
      const q = new URL(authorizeUrl).searchParams;
      return {
        txId,
        authorizeUrl,
        state: q.get("state")!,
        nonce: q.get("nonce")!,
        codeChallenge: q.get("code_challenge")!,
        loginHint: q.get("login_hint") ?? undefined,
      };
    }

    /**
     * A transaction plus the code Zitadel issued for `session` to that
     * storefront client after the authorize request it started — the
     * callback's redeem payload.
     */
    async function code(
      session: IdpSession,
      client: "academy" | "doctor" = "academy",
      overrides: {
        nonce?: string;
        codeChallenge?: string;
        ttlSeconds?: number;
        returnPath?: string;
        completeRegistration?: string;
      } = {},
    ) {
      const tx = await transaction(client, {
        ...(overrides.returnPath ? { returnPath: overrides.returnPath } : {}),
        ...(overrides.completeRegistration
          ? { completeRegistration: overrides.completeRegistration }
          : {}),
      });
      const redirectUri =
        client === "academy" ? ACADEMY_CALLBACK : DOCTOR_CALLBACK;
      const value = oidc.issueCode({
        clientId: client === "academy" ? ACADEMY : DOCTOR,
        redirectUri,
        codeChallenge: overrides.codeChallenge ?? tx.codeChallenge,
        sid: session.zitadelSessionId,
        sub: session.sub,
        nonce: overrides.nonce ?? tx.nonce,
        ...(overrides.ttlSeconds ? { ttlSeconds: overrides.ttlSeconds } : {}),
      });
      return { client, txId: tx.txId, state: tx.state, code: value };
    }

    function redeem(
      payload: Record<string, unknown>,
      headers: Record<string, string> = INTERNAL,
    ) {
      return app.inject({
        method: "POST",
        url: "/v1/internal/oidc/redeem",
        headers,
        payload,
      });
    }

    function sessionCookie(res: {
      cookies: Array<{ name: string; value: string }>;
    }) {
      return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    }

    async function sessionLive(sid: string): Promise<boolean> {
      const res = await app.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${sid}` },
      });
      return res.statusCode === 200;
    }

    it("EARS-62: the internal routes answer 404 without the internal credential, as if they did not exist", async () => {
      const unknown = await app.inject({
        method: "POST",
        url: "/v1/internal/oidc/no-such-route",
        headers: DEVICE,
        payload: {},
      });
      expect(unknown.statusCode).toBe(404);
      for (const authorization of [
        undefined,
        "Bearer wrong-token-wrong-token-wrong-token",
        `Basic ${TOKEN}`,
        `Bearer ${TOKEN}x`,
      ]) {
        for (const url of [
          "/v1/internal/oidc/redeem",
          "/v1/internal/oidc/intent",
        ]) {
          const res = await app.inject({
            method: "POST",
            url,
            headers: { ...DEVICE, ...(authorization ? { authorization } : {}) },
            payload: {},
          });
          expect(res.statusCode).toBe(404);
          expect(res.json()).toMatchObject({ statusCode: 404 });
        }
      }
      // The right credential reaches the handler (here: a schema refusal).
      const handled = await redeem({});
      expect(handled.statusCode).toBe(400);
    });

    it("EARS-71: a storefront entry records an intent the sign-in host resolves once, for its own client only", async () => {
      const intent = { method: "code", eventTarget: "congress-2026" };
      const { loginHint: id } = await transaction("doctor", { intent });
      expect(id).toBeDefined();
      expect(Buffer.from(id!, "base64url").length).toBeGreaterThanOrEqual(16);

      // Foreign client: ignored (and, being the one read, spent).
      const foreign = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        loginHint: id,
      });
      const f = await app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${foreign}`,
        headers: DEVICE,
      });
      expect((f.json() as { intent?: unknown }).intent).toBeUndefined();

      const { loginHint: own } = await transaction("doctor", { intent });
      const ar = hostIdp.seedAuthRequest({ clientId: DOCTOR, loginHint: own });
      const first = await app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${ar}`,
        headers: DEVICE,
      });
      expect((first.json() as { intent?: unknown }).intent).toEqual({
        method: "code",
        eventTarget: "congress-2026",
        handoff: false,
      });
      const again = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        loginHint: own,
      });
      const second = await app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${again}`,
        headers: DEVICE,
      });
      expect((second.json() as { intent?: unknown }).intent).toBeUndefined();

      // A plain entry carries no intent; a silent check never does.
      expect((await transaction("doctor")).loginHint).toBeUndefined();
      const silent = await app.inject({
        method: "POST",
        url: "/v1/internal/oidc/transaction",
        headers: INTERNAL,
        payload: { client: "doctor", kind: "silent", door: "login", intent },
      });
      expect(silent.statusCode).toBe(400);
    });

    it("EARS-61: the transaction's state, nonce and verifier are generated and held by the API; only the S256 challenge leaves it", async () => {
      const tx = await transaction("academy", { returnPath: "/webinars?x=1" });
      expect(tx.txId).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const url = new URL(tx.authorizeUrl);
      expect(url.origin + url.pathname).toBe(
        "http://idp.e2e.test/oauth/v2/authorize",
      );
      const q = Object.fromEntries(url.searchParams);
      expect(q).toMatchObject({
        client_id: ACADEMY,
        redirect_uri: ACADEMY_CALLBACK,
        response_type: "code",
        response_mode: "query",
        code_challenge_method: "S256",
      });
      for (const k of ["state", "nonce", "code_challenge"])
        expect(q[k]).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // No verifier, no return path in the URL; no prompt, no hint for a plain sign-in.
      expect(Object.keys(q).sort()).toEqual(
        [
          "client_id",
          "code_challenge",
          "code_challenge_method",
          "nonce",
          "redirect_uri",
          "response_mode",
          "response_type",
          "scope",
          "state",
        ].sort(),
      );
      // Registration asks Zitadel for its create door.
      const reg = await transaction("doctor", { door: "register" });
      const rq = new URL(reg.authorizeUrl).searchParams;
      expect(rq.get("prompt")).toBe("create");
      expect(rq.get("client_id")).toBe(DOCTOR);
      expect(rq.get("redirect_uri")).toBe(DOCTOR_CALLBACK);
      // A return path that is not same-origin relative is refused (req. 1).
      for (const returnPath of [
        "//evil.example",
        "https://evil.example",
        "/\\evil.example",
        "/" + "a".repeat(2048),
      ]) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/internal/oidc/transaction",
          headers: INTERNAL,
          payload: {
            client: "academy",
            kind: "interactive",
            door: "login",
            returnPath,
          },
        });
        expect(res.statusCode, returnPath).toBe(400);
      }
    });

    it("EARS-8: a code finalised with a live record mints a fresh session linked to it, bounded by the record, with no token in the body", async () => {
      const address = await account("mint");
      const session = await hostSignIn(new Jar(), address);
      const c = await code(session, "academy", { returnPath: "/webinars?x=1" });
      const res = await redeem(c, {
        ...INTERNAL,
        // A presented session id is never adopted (req. 5).
        cookie: `${SESSION_COOKIE_NAME}=attacker-chosen-sid`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        sub: session.sub,
        roles: ["doctor_guest"],
        mfa: false,
        returnPath: "/webinars?x=1",
        door: "login",
        completeRegistration: null,
      });
      expect(res.body).not.toMatch(/at-|rt-/);
      const cookie = sessionCookie(res);
      expect(cookie).toBeDefined();
      expect(cookie?.value).not.toBe("attacker-chosen-sid");
      const raw = String(res.headers["set-cookie"]);
      expect(raw).toMatch(/HttpOnly/);
      expect(raw).toMatch(/Secure/);
      expect(raw).toMatch(/SameSite=Lax/);
      expect(raw).not.toMatch(/Domain=/i);
      expect(await sessionLive(cookie!.value)).toBe(true);

      // The session never outlives the shared session it came from.
      await pool.query(
        "UPDATE sign_in_host_records SET expires_at = $2 WHERE subject = $1",
        [session.sub, new Date(Date.now() + 3600 * 1000)],
      );
      const bounded = await redeem(await code(session));
      expect(bounded.statusCode).toBe(200);
      expect(sessionCookie(bounded)?.value).not.toBe(cookie?.value);
      expect(
        Number(
          /Max-Age=(\d+)/.exec(String(bounded.headers["set-cookie"]))?.[1],
        ),
      ).toBeLessThanOrEqual(3600);
    });

    it("EARS-62 (req. 2): a replayed transaction, an expired code, a code whose challenge is not the transaction's verifier, a foreign nonce and a foreign state are refused", async () => {
      const address = await account("replay");
      const session = await hostSignIn(new Jar(), address);

      const c = await code(session, "academy", { returnPath: "/x" });
      expect((await redeem(c)).statusCode).toBe(200);
      // Replay: the same transaction is single-use.
      const replay = await redeem(c);
      expect(replay.statusCode).toBe(401);
      expect(replay.json()).toMatchObject({ returnPath: null, door: null });
      expect(sessionCookie(replay)).toBeUndefined();

      const expired = await code(session, "academy", { returnPath: "/x" });
      oidc.expireCode(expired.code);
      const late = await redeem(expired);
      expect(late.statusCode).toBe(401);
      // The browser's own transaction still lands where it started.
      expect(late.json()).toMatchObject({ returnPath: "/x", door: "login" });

      // The code was issued for another transaction's challenge: the stored
      // verifier does not match it.
      const other = await transaction();
      const wrong = await code(session, "academy", {
        codeChallenge: other.codeChallenge,
      });
      expect((await redeem(wrong)).statusCode).toBe(401);

      const foreignNonce = await redeem(
        await code(session, "academy", { nonce: "another-transaction" }),
      );
      expect(foreignNonce.statusCode).toBe(401);
      expect(sessionCookie(foreignNonce)).toBeUndefined();

      // Login CSRF (req. 3): a callback state that is not the browser's
      // transaction burns it and mints nothing, even with a valid code.
      const mine = await code(session);
      const forged = await redeem({ ...mine, state: other.state });
      expect(forged.statusCode).toBe(401);
      expect(sessionCookie(forged)).toBeUndefined();
      expect((await redeem(mine)).statusCode).toBe(401);

      // An OIDC error answer (no code) spends the transaction, mints nothing.
      const { code: _code, ...aborted } = await code(session, "academy", {
        returnPath: "/y",
      });
      const abort = await redeem(aborted);
      expect(abort.statusCode).toBe(401);
      expect(abort.json()).toMatchObject({ returnPath: "/y", door: "login" });
      expect((await redeem({ ...aborted, code: "late" })).statusCode).toBe(401);
    });

    it("EARS-62 (req. 3): a foreign state burns the transaction, discards the tokens and appends auth.session.rejected (state_mismatch, storefront tier)", async () => {
      const address = await account("csrf-audit");
      const session = await hostSignIn(new Jar(), address);
      // The attacker's own authorize request completes in the victim's
      // browser: its state and code arrive with the victim's transaction.
      const attack = await code(session, "doctor");
      const victim = await transaction("doctor");
      const forged = await redeem({ ...attack, txId: victim.txId });
      expect(forged.statusCode).toBe(401);
      expect(sessionCookie(forged)).toBeUndefined();
      const rows = await pool.query<{
        reason: string;
        metadata: Record<string, unknown>;
      }>(
        "SELECT reason, metadata FROM audit_ledger WHERE subject_id = $1 AND event_type = 'auth.session.rejected'",
        [session.sub],
      );
      expect(rows.rows).toEqual([
        {
          reason: "state_mismatch",
          metadata: expect.objectContaining({
            tier: "storefront",
            client: "doctor",
          }),
        },
      ]);
    });

    it("003 EARS-62: a callback with no or a foreign transaction cookie still redeems its code by state — the transaction is spent, the code exchanged once and discarded, nothing minted, and the attacker's replay is refused", async () => {
      const session = await hostSignIn(new Jar(), await account("replay-hole"));
      const countRejected = async () =>
        (
          await pool.query(
            "SELECT 1 FROM audit_ledger WHERE subject_id = $1 AND event_type = 'auth.session.rejected'",
            [session.sub],
          )
        ).rowCount;

      // The victim's browser holds no transaction cookie.
      const a = await code(session, "academy");
      const { txId: _attackerTx, ...noCookie } = a;
      let before = oidc.attempts.length;
      const blind = await redeem(noCookie);
      expect(blind.statusCode).toBe(401);
      expect(blind.json()).toMatchObject({ returnPath: null, door: null });
      expect(sessionCookie(blind)).toBeUndefined();
      expect(oidc.attempts.slice(before).map((x) => x.code)).toEqual([a.code]);
      // The attacker presents the same callback with their own transaction.
      before = oidc.attempts.length;
      const replay = await redeem(a);
      expect(replay.statusCode).toBe(401);
      expect(sessionCookie(replay)).toBeUndefined();
      expect(oidc.attempts.length).toBe(before);

      // The victim's browser holds its own, different transaction: it lands
      // where the victim started.
      const b = await code(session, "academy");
      const victim = await transaction("academy", { returnPath: "/v" });
      before = oidc.attempts.length;
      const foreign = await redeem({ ...b, txId: victim.txId });
      expect(foreign.statusCode).toBe(401);
      expect(foreign.json()).toMatchObject({ returnPath: "/v", door: "login" });
      expect(sessionCookie(foreign)).toBeUndefined();
      expect(oidc.attempts.slice(before).map((x) => x.code)).toEqual([b.code]);
      expect((await redeem(b)).statusCode).toBe(401);
      expect(sessionCookie(await redeem(b))).toBeUndefined();

      // An unknown state names no transaction: nothing holds a verifier, no
      // exchange runs.
      before = oidc.attempts.length;
      const unknown = await redeem({
        client: "academy",
        state: "no-such-state",
        code: "whatever",
      });
      expect(unknown.statusCode).toBe(401);
      expect(oidc.attempts.length).toBe(before);
      expect(await countRejected()).toBe(2);
    });

    it("005 EARS-2: the carried эфир registration rides the transaction and comes back with the minted session only", async () => {
      const address = await account("carry");
      const session = await hostSignIn(new Jar(), address);
      const c = await code(session, "doctor", {
        returnPath: "/events/some-event",
        completeRegistration: "some-event",
      });
      const res = await redeem(c);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        returnPath: "/events/some-event",
        completeRegistration: "some-event",
      });
      // A silent check never carries one.
      const silent = await app.inject({
        method: "POST",
        url: "/v1/internal/oidc/transaction",
        headers: INTERNAL,
        payload: {
          client: "doctor",
          kind: "silent",
          door: "login",
          completeRegistration: "some-event",
        },
      });
      expect(silent.statusCode).toBe(400);
    });

    it("EARS-62 (req. 8): a code whose sid is not the Zitadel session of a live sign-in-host record mints nothing", async () => {
      const address = await account("hosted");
      const session = await hostSignIn(new Jar(), address);
      // Finalised by another login UI: a Zitadel session no record holds.
      const hosted = await code({
        ...session,
        zitadelSessionId: "hosted-login-session",
      });
      const res = await redeem(hosted);
      expect(res.statusCode).toBe(401);
      expect(sessionCookie(res)).toBeUndefined();

      // A record past its 7-day idle timeout is not live either.
      await pool.query(
        "UPDATE sign_in_host_records SET last_finalised_at = now() - interval '8 days' WHERE subject = $1",
        [session.sub],
      );
      expect((await redeem(await code(session))).statusCode).toBe(401);
    });

    it("EARS-64: a redeem from a browser other than the record's (its fingerprint) mints nothing", async () => {
      const address = await account("fingerprint");
      const session = await hostSignIn(new Jar(), address);
      const warn = vi.spyOn(Logger.prototype, "warn");
      const foreign = await redeem(await code(session), {
        ...INTERNAL,
        "user-agent": "AnotherBrowser/2.0",
      });
      expect(foreign.statusCode).toBe(401);
      expect(sessionCookie(foreign)).toBeUndefined();
      // The internal log names which check refused (the answer stays generic).
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("(the record is foreign)"),
      );
      expect(JSON.stringify(foreign.json())).not.toContain("foreign");
      warn.mockRestore();
      // The record's own browser still redeems.
      expect((await redeem(await code(session))).statusCode).toBe(200);
    });

    it("EARS-8: a linked session refreshes through its own storefront client, stays linked and keeps its bound expiry", async () => {
      const address = await account("refresh");
      const session = await hostSignIn(new Jar(), address);
      const store = app.get<SessionStore>(SESSION_STORE);
      const bff = vi.spyOn(idp, "refreshTokens");
      for (const client of ["academy", "doctor"] as const) {
        const sid = sessionCookie(
          await redeem(await code(session, client)),
        )!.value;
        const before = await store.get(sid);
        const res = await app.inject({
          method: "POST",
          url: "/v1/auth/refresh",
          headers: { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${sid}` },
        });
        expect(res.statusCode, res.body).toBe(200);
        expect(oidc.refreshes.at(-1)).toEqual({
          clientId: client === "academy" ? ACADEMY : DOCTOR,
          refreshToken: before!.refreshToken,
        });
        const after = await store.get(sid);
        expect(after?.refreshToken).not.toBe(before!.refreshToken);
        expect(after?.zitadelSessionId).toBe(session.zitadelSessionId);
        expect(after?.oidcClient).toBe(client);
        expect(after?.expiresAtMs).toBe(before!.expiresAtMs);
      }
      // Never the BFF client's secret.
      expect(bff).not.toHaveBeenCalled();
    });

    it("EARS-64: a fresh credential step that replaces the record revokes every storefront session linked to the old Zitadel session", async () => {
      const address = await account("replace");
      const jar = new Jar();
      const first = await hostSignIn(jar, address);
      const academy = sessionCookie(
        await redeem(await code(first, "academy")),
      )!.value;
      const doctor = sessionCookie(
        await redeem(await code(first, "doctor")),
      )!.value;
      expect(await sessionLive(academy)).toBe(true);
      expect(await sessionLive(doctor)).toBe(true);

      const second = await hostSignIn(jar, address, { prompt: ["login"] });
      expect(second.zitadelSessionId).not.toBe(first.zitadelSessionId);
      expect(await sessionLive(academy)).toBe(false);
      expect(await sessionLive(doctor)).toBe(false);
      // The new shared session still mints.
      expect((await redeem(await code(second))).statusCode).toBe(200);
    });

    it("EARS-10: one sign-out ends the Zitadel session, the record and every linked storefront session on both storefronts", async () => {
      const address = await account("signout");
      const jar = new Jar();
      const session = await hostSignIn(jar, address);
      const academy = sessionCookie(
        await redeem(await code(session, "academy")),
      )!.value;
      const doctor = sessionCookie(
        await redeem(await code(session, "doctor")),
      )!.value;
      // Another browser's shared session of the same person is untouched.
      const otherBrowser = await hostSignIn(new Jar(), address);
      const other = sessionCookie(
        await redeem(await code(otherBrowser, "doctor")),
      )!.value;
      const terminate = vi.spyOn(idp, "terminateSession");

      const out = await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${academy}` },
      });
      expect(out.statusCode).toBe(200);
      expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
      expect(terminate).toHaveBeenCalledWith(
        expect.objectContaining({ zitadelSessionId: session.zitadelSessionId }),
      );
      expect(await sessionLive(academy)).toBe(false);
      expect(await sessionLive(doctor)).toBe(false);
      expect(await sessionLive(other)).toBe(true);

      // The record is gone: the next sign-in click cannot finalise silently.
      const silent = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        prompt: ["none"],
      });
      const entry = await app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${silent}`,
        headers: { ...DEVICE, cookie: jar.header() },
      });
      const body = entry.json() as { action: string; url?: string };
      expect(body.action === "redirect" && body.url).toContain(
        "error=login_required",
      );
      expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(true);
      // ...and a code for the ended Zitadel session mints nothing.
      expect((await redeem(await code(session))).statusCode).toBe(401);
    });
  },
);

describe.skipIf(!process.env.DATABASE_URL)(
  "Storefront OIDC redeem limits (e2e)",
  () => {
    it("EARS-62 (req. 9): the redeem endpoint is rate-limited per client IP in its own bucket", async () => {
      const { app } = await compile({
        ...RELAXED_RATE_LIMIT,
        scopedPerIpPer15Min: { [STOREFRONT_REDEEM_RATE_LIMIT_SCOPE]: 2 },
      });
      try {
        const payload = {
          client: "academy",
          txId: randomBytes(32).toString("base64url"),
          state: "s",
          code: "unknown",
        };
        // Keyed on the client IP the storefront server forwards, never on the
        // storefront server's own socket address (one bucket for everyone).
        const from = (ip: string) =>
          app.inject({
            method: "POST",
            url: "/v1/internal/oidc/redeem",
            headers: { ...INTERNAL, "x-forwarded-for": ip },
            payload,
          });
        const statuses: number[] = [];
        for (let i = 0; i < 3; i += 1)
          statuses.push((await from("203.0.113.7")).statusCode);
        expect(statuses).toEqual([401, 401, 429]);
        expect((await from("198.51.100.9")).statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it("EARS-61 (req. 9): the storefront entry's transaction creation is rate-limited per client IP in its own bucket", async () => {
      const { app } = await compile({
        ...RELAXED_RATE_LIMIT,
        scopedPerIpPer15Min: { [STOREFRONT_ENTRY_RATE_LIMIT_SCOPE]: 2 },
      });
      try {
        const from = (ip: string) =>
          app.inject({
            method: "POST",
            url: "/v1/internal/oidc/transaction",
            headers: { ...INTERNAL, "x-forwarded-for": ip },
            payload: { client: "academy", kind: "interactive", door: "login" },
          });
        const statuses: number[] = [];
        for (let i = 0; i < 3; i += 1)
          statuses.push((await from("203.0.113.8")).statusCode);
        expect(statuses).toEqual([200, 200, 429]);
        expect((await from("198.51.100.10")).statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });
  },
);
