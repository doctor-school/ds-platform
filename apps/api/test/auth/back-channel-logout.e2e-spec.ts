import type pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { BACK_CHANNEL_LOGOUT_RATE_LIMIT_SCOPE } from "../../src/sign-in-host/back-channel-logout.controller.js";
import {
  ACADEMY,
  DEVICE,
  DOCTOR,
  Jar,
  storefrontHarness,
  type StorefrontHarness,
} from "../setup/storefront-harness.js";
import { RELAXED_RATE_LIMIT } from "../setup/rate-limit.js";

/**
 * 003 EARS-65, ADR-0015 §4 «One sign-out» req. 6 / 9 / 11 — sessions ended
 * elsewhere. A Zitadel session terminated outside a storefront sign-out
 * reaches the API as an OIDC Back-Channel Logout token, verified before
 * anything is revoked; a reset ends every session of the person on both
 * storefronts. What a lockout does is IdP behaviour, proved against the real
 * Zitadel in `zitadel-lock-ends-sessions.e2e-spec.ts`.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "003 EARS-65 — back-channel logout and credential events (e2e)",
  () => {
    let h: StorefrontHarness;
    let pool: pg.Pool;

    beforeAll(async () => {
      h = await storefrontHarness();
      pool = h.app.get<pg.Pool>(DRIZZLE_POOL);
    });
    afterEach(async () => {
      await h.cleanup();
    });
    afterAll(async () => {
      await h.close();
    });

    function backChannel(
      body: string,
      contentType = "application/x-www-form-urlencoded",
    ) {
      return h.app.inject({
        method: "POST",
        url: "/v1/auth/back-channel-logout",
        headers: { "content-type": contentType },
        payload: body,
      });
    }

    const form = (token: string) =>
      new URLSearchParams({ logout_token: token }).toString();

    async function records(address: string): Promise<number> {
      const { rows } = await pool.query(
        "SELECT 1 FROM sign_in_host_records WHERE subject = (SELECT zitadel_sub FROM users WHERE email = $1)",
        [address],
      );
      return rows.length;
    }

    /** One browser signed in on both storefronts: its shared session and the two sids. */
    async function signedInOnBoth(tag: string) {
      const address = await h.account(tag);
      const jar = new Jar();
      const session = await h.hostSignIn(jar, address);
      const academy = await h.storefrontSession(session, "academy");
      const doctor = await h.storefrontSession(session, "doctor");
      expect(await h.sessionLive(academy)).toBe(true);
      expect(await h.sessionLive(doctor)).toBe(true);
      return { address, jar, session, academy, doctor };
    }

    it("EARS-65: a valid logout token revokes by sid every storefront session linked to that Zitadel session and deletes its record", async () => {
      const { address, session, academy, doctor } =
        await signedInOnBoth("valid");
      // Another browser of the same person holds its own shared session.
      const other = await h.storefrontSession(
        await h.hostSignIn(new Jar(), address),
        "doctor",
      );
      expect(await records(address)).toBe(2);

      const res = await backChannel(
        form(
          h.oidc.signLogoutToken({
            aud: DOCTOR,
            sid: session.zitadelSessionId,
            sub: session.sub,
          }),
        ),
      );
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(await h.sessionLive(academy)).toBe(false);
      expect(await h.sessionLive(doctor)).toBe(false);
      expect(await h.sessionLive(other)).toBe(true);
      expect(await records(address)).toBe(1);
      // ADR-0001 §7.3: an IdP-side termination is recorded as `force`.
      const { rows } = await pool.query<{ reason: string }>(
        "SELECT reason FROM audit_ledger WHERE event_type = 'auth.session.terminated' AND sid = ANY($1)",
        [[academy, doctor]],
      );
      expect(rows.map((r) => r.reason)).toEqual(["force", "force"]);
    });

    it("EARS-65: an unsigned, foreign-audience or malformed logout token revokes nothing", async () => {
      const { session, academy, doctor } = await signedInOnBoth("invalid");
      const valid = h.oidc.signLogoutToken({
        aud: ACADEMY,
        sid: session.zitadelSessionId,
        sub: session.sub,
      });
      const [head, payload] = valid.split(".");
      const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${payload}.`;
      const stripped = `${head}.${payload}.`;
      const foreignAudience = h.oidc.signLogoutToken({
        aud: "some-other-client",
        sid: session.zitadelSessionId,
        sub: session.sub,
      });
      const withNonce = h.oidc.signLogoutToken({
        aud: ACADEMY,
        sid: session.zitadelSessionId,
        claims: { nonce: "n" },
      });
      const noEvent = h.oidc.signLogoutToken({
        aud: ACADEMY,
        sid: session.zitadelSessionId,
        claims: { events: undefined },
      });
      for (const body of [
        form(unsigned),
        form(stripped),
        form(foreignAudience),
        form(withNonce),
        form(noEvent),
        form("not-a-jwt"),
        "logout_token=",
        "something=else",
        "",
      ]) {
        const res = await backChannel(body);
        expect(res.statusCode, body).toBe(400);
        expect(res.json()).toEqual({ error: "invalid_request" });
        expect(res.headers["cache-control"]).toBe("no-store");
      }
      // A JSON body is not the BCL request shape either.
      const json = await backChannel(
        JSON.stringify({ logout_token: valid }),
        "application/json",
      );
      expect(json.statusCode).toBe(400);
      expect(await h.sessionLive(academy)).toBe(true);
      expect(await h.sessionLive(doctor)).toBe(true);
    });

    it("EARS-65: after a completed reset the other storefront's next request is signed out and its silent check ends in login_required", async () => {
      const { address, jar, academy, doctor } = await signedInOnBoth("reset");
      const reset = await h.app.inject({
        method: "POST",
        url: "/v1/auth/password/reset",
        headers: DEVICE,
        payload: { identifier: address },
      });
      expect(reset.statusCode).toBe(200);
      const complete = await h.app.inject({
        method: "POST",
        url: "/v1/auth/password/reset/complete",
        headers: DEVICE,
        payload: {
          identifier: address,
          code: FAKE_VALID_CODE,
          newPassword: "Bb2!another-long-pw",
        },
      });
      expect(complete.statusCode).toBe(200);
      expect(await h.sessionLive(academy)).toBe(false);
      expect(await h.sessionLive(doctor)).toBe(false);
      expect(await records(address)).toBe(0);
      await expectSilentLoginRequired(jar);
    });

    /** The browser's next silent authorize finds no shared session: `login_required`. */
    async function expectSilentLoginRequired(jar: Jar) {
      const silent = h.hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        prompt: ["none"],
      });
      const entry = await h.app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${silent}`,
        headers: { ...DEVICE, cookie: jar.header() },
      });
      const body = entry.json() as { action: string; url?: string };
      expect(body.action === "redirect" && body.url).toContain(
        "error=login_required",
      );
    }
  },
);

describe.skipIf(!process.env.DATABASE_URL)(
  "003 EARS-65 — back-channel logout limit (e2e)",
  () => {
    it("EARS-65: (req. 9) the endpoint is rate-limited per IP in its own bucket, and a limited call revokes nothing", async () => {
      const h = await storefrontHarness({
        ...RELAXED_RATE_LIMIT,
        scopedPerIpPer15Min: { [BACK_CHANNEL_LOGOUT_RATE_LIMIT_SCOPE]: 1 },
      });
      try {
        const address = await h.account("limit");
        const session = await h.hostSignIn(new Jar(), address);
        const academy = await h.storefrontSession(session, "academy");
        const post = (token: string) =>
          h.app.inject({
            method: "POST",
            url: "/v1/auth/back-channel-logout",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            payload: new URLSearchParams({ logout_token: token }).toString(),
          });
        expect((await post("not-a-jwt")).statusCode).toBe(400);
        const limited = await post(
          h.oidc.signLogoutToken({
            aud: ACADEMY,
            sid: session.zitadelSessionId,
            sub: session.sub,
          }),
        );
        expect(limited.statusCode).toBe(429);
        expect(await h.sessionLive(academy)).toBe(true);
      } finally {
        await h.cleanup();
        await h.close();
      }
    });
  },
);
