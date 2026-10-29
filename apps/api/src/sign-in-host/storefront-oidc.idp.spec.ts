import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../auth/idp/zitadel.idp.js";
import {
  JWKS_REFRESH_MIN_INTERVAL_MS,
  ZitadelStorefrontOidc,
} from "./storefront-oidc.idp.js";
import {
  BACK_CHANNEL_LOGOUT_EVENT,
  parseClientKey,
} from "./storefront-oidc.jwt.js";

const ISSUER = "https://id.example.test";
const CLIENT = "academy-client";
const now = new Date("2026-10-22T10:00:00Z");

const clientKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = parseClientKey(
  Buffer.from(
    JSON.stringify({
      type: "application",
      keyId: "k1",
      key: clientKeys.privateKey.export({ type: "pkcs1", format: "pem" }),
      appId: "a",
      clientId: CLIENT,
    }),
  ).toString("base64"),
)!;

function idToken(): string {
  const b = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${b({ alg: "RS256", kid: "s1" })}.${b({
    iss: ISSUER,
    aud: CLIENT,
    sub: "u1",
    sid: "zs1",
    nonce: "n1",
    iat: now.getTime() / 1000,
    exp: now.getTime() / 1000 + 300,
  })}`;
  return `${input}.${sign("sha256", Buffer.from(input), signing.privateKey).toString("base64url")}`;
}

function zitadel(calls: Array<{ url: string; body?: string }>): FetchLike {
  return (url, init) => {
    calls.push({ url, ...(init.body ? { body: init.body } : {}) });
    if (url.endsWith("/oauth/v2/keys")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            keys: [
              {
                ...signing.publicKey.export({ format: "jwk" }),
                kid: "s1",
                alg: "RS256",
              },
            ],
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          access_token: "at",
          refresh_token: "rt",
          id_token: idToken(),
        }),
    });
  };
}

describe("ZitadelStorefrontOidc (003 EARS-62)", () => {
  it("EARS-62: the token call carries the code, the PKCE verifier and a private_key_jwt assertion, and the ID token is verified", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const oidc = new ZitadelStorefrontOidc({
      issuer: `${ISSUER}/`,
      keys: new Map([[CLIENT, key]]),
      fetchImpl: zitadel(calls),
      clock: () => now,
    });
    const tokens = await oidc.redeemCode({
      clientId: CLIENT,
      code: "c1",
      codeVerifier: "v".repeat(43),
      redirectUri: "https://academy.test/auth/callback",
    });
    expect(tokens?.idToken).toMatchObject({
      sub: "u1",
      sid: "zs1",
      nonce: "n1",
    });
    const form = new URLSearchParams(calls[0]!.body);
    expect(calls[0]!.url).toBe(`${ISSUER}/oauth/v2/token`);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("c1");
    expect(form.get("code_verifier")).toBe("v".repeat(43));
    expect(form.get("client_assertion_type")).toBe(
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
    expect(form.get("client_assertion")?.split(".")).toHaveLength(3);
    expect(form.get("client_secret")).toBeNull();
  });

  it("EARS-8: a linked session's refresh rotates through its own client's private_key_jwt, never a secret", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const oidc = new ZitadelStorefrontOidc({
      issuer: ISSUER,
      keys: new Map([[CLIENT, key]]),
      fetchImpl: zitadel(calls),
      clock: () => now,
    });
    expect(
      await oidc.refreshTokens({ clientId: CLIENT, refreshToken: "rt0" }),
    ).toEqual({
      reuseDetected: false,
      tokens: { accessToken: "at", refreshToken: "rt" },
    });
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt0");
    expect(form.get("client_id")).toBe(CLIENT);
    expect(form.get("client_assertion")?.split(".")).toHaveLength(3);
    expect(form.get("client_secret")).toBeNull();
    expect(form.get("scope")).toBeNull();
    // A client without its key is a configuration fault, not a refused grant:
    // it fails closed without the reuse verdict.
    expect(
      await oidc.refreshTokens({ clientId: "other", refreshToken: "rt" }),
    ).toEqual({ reuseDetected: false, failed: true });
  });

  /** A token endpoint that answers every call with `answer` (the JWKS is never asked). */
  function tokenEndpoint(
    answer: () => Promise<{ status: number; body?: unknown }>,
  ): FetchLike {
    return async () => {
      const { status, body } = await answer();
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body ?? {}),
      };
    };
  }

  function refreshWith(fetchImpl: FetchLike) {
    return new ZitadelStorefrontOidc({
      issuer: ISSUER,
      keys: new Map([[CLIENT, key]]),
      fetchImpl,
      clock: () => now,
    }).refreshTokens({ clientId: CLIENT, refreshToken: "rt0" });
  }

  it("EARS-65: only a 400 invalid_grant (reuse or a revoked grant) is the reuse verdict", async () => {
    expect(
      await refreshWith(
        tokenEndpoint(() =>
          Promise.resolve({ status: 400, body: { error: "invalid_grant" } }),
        ),
      ),
    ).toEqual({ reuseDetected: true });
  });

  it("EARS-65: an IdP outage or a non-reuse refusal — a 5xx, a locked user's invalid_request, another 400 error, a timeout or an unreadable body — is failed, never the reuse verdict", async () => {
    const unavailable = { reuseDetected: false, failed: true };
    // Zitadel v4.17.3's refusal for a locked user (proved live in
    // test/auth/zitadel-lock-ends-sessions.e2e-spec.ts).
    expect(
      await refreshWith(
        tokenEndpoint(() =>
          Promise.resolve({
            status: 400,
            body: {
              error: "invalid_request",
              error_description: "Errors.User.NotActive",
            },
          }),
        ),
      ),
    ).toEqual(unavailable);
    expect(
      await refreshWith(tokenEndpoint(() => Promise.resolve({ status: 503 }))),
    ).toEqual(unavailable);
    expect(
      await refreshWith(
        tokenEndpoint(() =>
          Promise.resolve({ status: 400, body: { error: "invalid_client" } }),
        ),
      ),
    ).toEqual(unavailable);
    expect(
      await refreshWith(() =>
        Promise.reject(new Error("The operation was aborted due to timeout")),
      ),
    ).toEqual(unavailable);
    expect(
      await refreshWith(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.reject(new SyntaxError("not json")),
        }),
      ),
    ).toEqual(unavailable);
  });

  it("EARS-62: a client without a configured key fails closed without calling Zitadel", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const oidc = new ZitadelStorefrontOidc({
      issuer: ISSUER,
      keys: new Map(),
      fetchImpl: zitadel(calls),
      clock: () => now,
    });
    expect(
      await oidc.redeemCode({
        clientId: CLIENT,
        code: "c1",
        codeVerifier: "v".repeat(43),
        redirectUri: "https://academy.test/auth/callback",
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("ZitadelStorefrontOidc logout-token JWKS use (003 EARS-65)", () => {
  const forged = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const b = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  function logoutToken(
    opts: {
      kid?: string;
      key?: typeof signing.privateKey;
      claims?: object;
    } = {},
  ): string {
    const nowS = Math.floor(clock.at.getTime() / 1000);
    const input = `${b({ alg: "RS256", kid: opts.kid ?? "s1", typ: "logout+jwt" })}.${b(
      {
        iss: ISSUER,
        aud: CLIENT,
        sub: "u1",
        sid: "zs1",
        jti: "j",
        iat: nowS,
        exp: nowS + 120,
        events: { [BACK_CHANNEL_LOGOUT_EVENT]: {} },
        ...opts.claims,
      },
    )}`;
    return `${input}.${sign("sha256", Buffer.from(input), opts.key ?? signing.privateKey).toString("base64url")}`;
  }
  const clock = { at: new Date(now) };

  /** A JWKS endpoint that counts its calls and can be switched to failing. */
  function keysEndpoint() {
    const state = { calls: 0, failing: false };
    const fetchImpl: FetchLike = () => {
      state.calls += 1;
      if (state.failing)
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({}),
        });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            keys: [
              {
                ...signing.publicKey.export({ format: "jwk" }),
                kid: "s1",
                alg: "RS256",
              },
            ],
          }),
      });
    };
    return { state, fetchImpl };
  }

  function adapter(fetchImpl: FetchLike) {
    clock.at = new Date(now);
    return new ZitadelStorefrontOidc({
      issuer: ISSUER,
      keys: new Map([[CLIENT, key]]),
      fetchImpl,
      clock: () => clock.at,
    });
  }

  it("EARS-65: a token failing the cheap claim checks never makes the API fetch the JWKS", async () => {
    const { state, fetchImpl } = keysEndpoint();
    const oidc = adapter(fetchImpl);
    for (const token of [
      "not-a-jwt",
      logoutToken({ claims: { iss: "https://evil.test" } }),
      logoutToken({ claims: { aud: "someone-else" } }),
      logoutToken({ claims: { events: {} } }),
      logoutToken({ claims: { sid: "" } }),
      logoutToken({ claims: { nonce: "n" } }),
    ]) {
      expect(await oidc.verifyLogoutToken(token)).toBeNull();
    }
    expect(state.calls).toBe(0);
  });

  it("EARS-65: forged tokens with an unknown kid cause at most one JWKS fetch per window; a known kid with a bad signature causes none", async () => {
    const { state, fetchImpl } = keysEndpoint();
    const oidc = adapter(fetchImpl);
    expect(await oidc.verifyLogoutToken(logoutToken())).toEqual({
      sid: "zs1",
      sub: "u1",
    });
    expect(state.calls).toBe(1);
    // A known kid, forged signature: refused from the cache, no refetch.
    for (let i = 0; i < 5; i += 1)
      expect(
        await oidc.verifyLogoutToken(logoutToken({ key: forged.privateKey })),
      ).toBeNull();
    expect(state.calls).toBe(1);
    // Unknown kids, concurrently and in a burst: one fetch in the window.
    clock.at = new Date(now.getTime() + JWKS_REFRESH_MIN_INTERVAL_MS + 1);
    const burst = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        oidc.verifyLogoutToken(
          logoutToken({ kid: `x${i}`, key: forged.privateKey }),
        ),
      ),
    );
    expect(burst.every((r) => r === null)).toBe(true);
    expect(state.calls).toBe(2);
    expect(
      await oidc.verifyLogoutToken(
        logoutToken({ kid: "y", key: forged.privateKey }),
      ),
    ).toBeNull();
    expect(state.calls).toBe(2);
    // The next window allows one more.
    clock.at = new Date(clock.at.getTime() + JWKS_REFRESH_MIN_INTERVAL_MS + 1);
    await oidc.verifyLogoutToken(
      logoutToken({ kid: "z", key: forged.privateKey }),
    );
    expect(state.calls).toBe(3);
  });

  it("EARS-65: a failed JWKS refetch keeps the cached keys", async () => {
    const { state, fetchImpl } = keysEndpoint();
    const oidc = adapter(fetchImpl);
    expect(await oidc.verifyLogoutToken(logoutToken())).not.toBeNull();
    state.failing = true;
    clock.at = new Date(now.getTime() + JWKS_REFRESH_MIN_INTERVAL_MS + 1);
    expect(
      await oidc.verifyLogoutToken(logoutToken({ kid: "rotated" })),
    ).toBeNull();
    expect(state.calls).toBe(2);
    // The good key still verifies, with no further fetch.
    expect(await oidc.verifyLogoutToken(logoutToken())).toEqual({
      sid: "zs1",
      sub: "u1",
    });
    expect(state.calls).toBe(2);
  });
});
