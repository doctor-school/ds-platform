import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../auth/idp/zitadel.idp.js";
import { ZitadelStorefrontOidc } from "./storefront-oidc.idp.js";
import { parseClientKey } from "./storefront-oidc.jwt.js";

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
    // A client without its key fails closed as a refused grant.
    expect(
      await oidc.refreshTokens({ clientId: "other", refreshToken: "rt" }),
    ).toEqual({ reuseDetected: true });
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
