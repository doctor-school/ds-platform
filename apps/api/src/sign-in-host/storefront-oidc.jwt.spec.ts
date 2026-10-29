import { generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildClientAssertion,
  parseClientKey,
  verifyIdToken,
  verifyLogoutToken,
  BACK_CHANNEL_LOGOUT_EVENT,
  type Jwks,
} from "./storefront-oidc.jwt.js";

const ISSUER = "https://id.example.test";
const CLIENT = "academy-client";

function keyPair() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

function zitadelKeyFile(pem: string, clientId = CLIENT): string {
  return Buffer.from(
    JSON.stringify({
      type: "application",
      keyId: "key-1",
      key: pem,
      appId: "app-1",
      clientId,
    }),
  ).toString("base64");
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: ReturnType<typeof keyPair>["privateKey"],
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  const signature = sign("sha256", Buffer.from(input), privateKey);
  return `${input}.${signature.toString("base64url")}`;
}

describe("storefront OIDC client credential (003 EARS-62, ADR-0015 §4 req. 2)", () => {
  it("EARS-62: a Zitadel application key file (base64 JSON) parses; anything else is refused", () => {
    const { privateKey } = keyPair();
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const parsed = parseClientKey(zitadelKeyFile(pem));
    expect(parsed).toMatchObject({ keyId: "key-1", clientId: CLIENT });
    expect(parseClientKey(undefined)).toBeNull();
    expect(parseClientKey("not base64 json")).toBeNull();
    expect(
      parseClientKey(
        Buffer.from(JSON.stringify({ keyId: "k" })).toString("base64"),
      ),
    ).toBeNull();
  });

  it("EARS-62: the private_key_jwt assertion is RS256 with kid, iss = sub = client, aud = issuer, a jti and a short exp", () => {
    const { privateKey, publicKey } = keyPair();
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const key = parseClientKey(zitadelKeyFile(pem));
    if (!key) throw new Error("key did not parse");
    const now = new Date("2026-10-22T10:00:00Z");
    const jwt = buildClientAssertion(key, ISSUER, now);
    const [h, p, s] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(header).toEqual({ alg: "RS256", kid: "key-1", typ: "JWT" });
    expect(payload.iss).toBe(CLIENT);
    expect(payload.sub).toBe(CLIENT);
    expect(payload.aud).toBe(ISSUER);
    expect(typeof payload.jti).toBe("string");
    expect(payload.iat).toBe(now.getTime() / 1000);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60);
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${p}`),
        publicKey,
        Buffer.from(s!, "base64url"),
      ),
    ).toBe(true);
    // A fresh jti every time: an assertion is never reusable.
    expect(buildClientAssertion(key, ISSUER, now)).not.toBe(jwt);
  });
});

describe("storefront ID token verification (003 EARS-62 / EARS-8)", () => {
  const { privateKey, publicKey } = keyPair();
  const jwks: Jwks = {
    keys: [
      {
        ...publicKey.export({ format: "jwk" }),
        kid: "sig-1",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  const now = new Date("2026-10-22T10:00:00Z");
  const nowS = now.getTime() / 1000;
  const claims = {
    iss: ISSUER,
    aud: [CLIENT, "project-id"],
    azp: CLIENT,
    sub: "user-1",
    sid: "zitadel-session-1",
    nonce: "n-1",
    iat: nowS - 5,
    exp: nowS + 600,
    amr: ["pwd"],
    "urn:zitadel:iam:org:project:roles": { doctor_guest: { org: "x" } },
  };
  const opts = { jwks, issuer: ISSUER, clientId: CLIENT, now };

  it("EARS-62: a well-signed token for this client yields its sub, sid, nonce and roles", () => {
    const token = signJwt({ alg: "RS256", kid: "sig-1" }, claims, privateKey);
    expect(verifyIdToken(token, opts)).toEqual({
      sub: "user-1",
      sid: "zitadel-session-1",
      nonce: "n-1",
      roles: ["doctor_guest"],
      mfa: false,
      expiresAtMs: (nowS + 600) * 1000,
    });
  });

  it("EARS-62: a forged signature, unknown kid, other alg, wrong iss, foreign aud/azp, expiry or missing sid is refused", () => {
    const other = keyPair().privateKey;
    const bad: string[] = [
      signJwt({ alg: "RS256", kid: "sig-1" }, claims, other),
      signJwt({ alg: "RS256", kid: "nope" }, claims, privateKey),
      signJwt({ alg: "none", kid: "sig-1" }, claims, privateKey),
      signJwt(
        { alg: "RS256", kid: "sig-1" },
        { ...claims, iss: "https://evil.test" },
        privateKey,
      ),
      signJwt(
        { alg: "RS256", kid: "sig-1" },
        { ...claims, aud: ["doctor-client"], azp: "doctor-client" },
        privateKey,
      ),
      signJwt(
        { alg: "RS256", kid: "sig-1" },
        { ...claims, azp: "doctor-client" },
        privateKey,
      ),
      signJwt(
        { alg: "RS256", kid: "sig-1" },
        { ...claims, exp: nowS - 1 },
        privateKey,
      ),
      signJwt(
        { alg: "RS256", kid: "sig-1" },
        { ...claims, sid: undefined },
        privateKey,
      ),
      "a.b",
    ];
    for (const token of bad) expect(verifyIdToken(token, opts)).toBeNull();
  });
});

describe("back-channel logout token verification (003 EARS-65, ADR-0015 §4 req. 6)", () => {
  const { privateKey, publicKey } = keyPair();
  const foreign = keyPair();
  const jwks: Jwks = {
    keys: [
      {
        ...publicKey.export({ format: "jwk" }),
        kid: "sig-1",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  const now = new Date("2026-10-29T10:00:00Z");
  const nowS = now.getTime() / 1000;
  const header = { alg: "RS256", kid: "sig-1", typ: "logout+jwt" };
  const claims = {
    iss: ISSUER,
    aud: CLIENT,
    sub: "user-1",
    sid: "zitadel-session-1",
    jti: "jti-1",
    iat: nowS - 5,
    exp: nowS + 120,
    events: { [BACK_CHANNEL_LOGOUT_EVENT]: {} },
  };
  const opts = {
    jwks,
    issuer: ISSUER,
    clientIds: [CLIENT, "doctor-client"],
    now,
  };

  it("EARS-65: a well-signed logout token for either storefront client yields its sid and sub", () => {
    expect(
      verifyLogoutToken(signJwt(header, claims, privateKey), opts),
    ).toEqual({ sid: "zitadel-session-1", sub: "user-1" });
    expect(
      verifyLogoutToken(
        signJwt(header, { ...claims, aud: ["doctor-client"] }, privateKey),
        opts,
      ),
    ).toEqual({ sid: "zitadel-session-1", sub: "user-1" });
    const { sub: _sub, ...noSub } = claims;
    expect(verifyLogoutToken(signJwt(header, noSub, privateKey), opts)).toEqual(
      { sid: "zitadel-session-1", sub: null },
    );
  });

  it("EARS-65: an unsigned, foreign-signed, foreign-audience, foreign-issuer, nonce-carrying, event-less, sid-less, expired or malformed token is refused", () => {
    const sign = (h: Record<string, unknown>, p: Record<string, unknown>) =>
      signJwt(h, p, privateKey);
    const [h, p] = sign(header, claims).split(".");
    const { sid: _sid, ...noSid } = claims;
    const { events: _events, ...noEvents } = claims;
    const { iat: _iat, ...noIat } = claims;
    for (const token of [
      `${h}.${p}.`,
      `${b64({ alg: "none" })}.${p}.`,
      signJwt(header, claims, foreign.privateKey),
      sign({ ...header, kid: "other" }, claims),
      sign({ ...header, alg: "HS256" }, claims),
      sign(header, { ...claims, aud: "someone-else" }),
      sign(header, { ...claims, iss: "https://evil.test" }),
      sign(header, { ...claims, nonce: "n-1" }),
      sign(header, noEvents),
      sign(header, { ...claims, events: { "http://other/event": {} } }),
      sign(header, { ...claims, events: [BACK_CHANNEL_LOGOUT_EVENT] }),
      sign(header, noSid),
      sign(header, { ...claims, sid: "" }),
      sign(header, noIat),
      sign(header, { ...claims, iat: nowS + 600 }),
      sign(header, { ...claims, exp: nowS - 1 }),
      "not-a-jwt",
      "a.b.c",
      "",
    ]) {
      expect(verifyLogoutToken(token, opts)).toBeNull();
    }
  });
});
