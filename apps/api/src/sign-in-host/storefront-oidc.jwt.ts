import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  timingSafeEqual,
  verify,
  type JsonWebKeyInput,
  type KeyObject,
} from "node:crypto";

/**
 * 003 EARS-62 / EARS-8 (amended), ADR-0015 §4 req. 2 — the two JWT jobs of
 * the storefront redeem, on `node:crypto` alone (the API carries no JWT
 * library and these two need none):
 *
 * - the `private_key_jwt` client assertion (RFC 7523 §3, OIDC Core §9) the
 *   API presents at Zitadel's token endpoint for a storefront client;
 * - the verification of the ID token that endpoint returns (OIDC Core
 *   §3.1.3.7): RS256 signature against the issuer's JWKS, `iss`, `aud`
 *   (and `azp` when several audiences), `exp`; `nonce` and `sid` are handed
 *   to the caller, which checks them against its transaction and the
 *   sign-in-host record.
 */

/** A parsed Zitadel application key file (`{type:"application",keyId,key,appId,clientId}`). */
export interface ClientKey {
  readonly keyId: string;
  readonly clientId: string;
  readonly privateKey: KeyObject;
}

/** Lifetime of one client assertion: long enough for one token call, never reusable later. */
export const CLIENT_ASSERTION_SECONDS = 60;

/** Clock skew tolerated on the ID token's `iat` (its `exp` is strict). */
const SKEW_SECONDS = 30;

/** Zitadel project-roles claim (the same key the headless exchange reads). */
const ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";

/**
 * The env value is the Zitadel key file, base64 of its JSON on one line.
 * `null` for anything that is not a usable application key — the env schema
 * refuses to boot on it, and nothing here ever logs the value.
 */
export function parseClientKey(raw: string | undefined): ClientKey | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as {
      type?: unknown;
      keyId?: unknown;
      key?: unknown;
      clientId?: unknown;
    };
    if (
      json.type !== "application" ||
      typeof json.keyId !== "string" ||
      !json.keyId ||
      typeof json.key !== "string" ||
      typeof json.clientId !== "string" ||
      !json.clientId
    ) {
      return null;
    }
    const privateKey = createPrivateKey(json.key);
    if (privateKey.asymmetricKeyType !== "rsa") return null;
    return { keyId: json.keyId, clientId: json.clientId, privateKey };
  } catch {
    return null;
  }
}

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** RFC 7523 client assertion: RS256, `kid`, `iss = sub = client_id`, `aud = issuer`, fresh `jti`. */
export function buildClientAssertion(
  key: ClientKey,
  issuer: string,
  now: Date,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const input = `${b64url({ alg: "RS256", kid: key.keyId, typ: "JWT" })}.${b64url(
    {
      iss: key.clientId,
      sub: key.clientId,
      aud: issuer,
      jti: randomUUID(),
      iat,
      exp: iat + CLIENT_ASSERTION_SECONDS,
    },
  )}`;
  const signature = sign("sha256", Buffer.from(input), key.privateKey);
  return `${input}.${signature.toString("base64url")}`;
}

/** One JWKS entry (RFC 7517) as the issuer publishes it. */
export interface Jwk {
  readonly kty?: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly [member: string]: unknown;
}

export interface Jwks {
  readonly keys: ReadonlyArray<Jwk>;
}

/** What a verified ID token tells the redeem. */
export interface VerifiedIdToken {
  readonly sub: string;
  /** The Zitadel session the code was finalised with (OIDC Front/Back-Channel `sid`). */
  readonly sid: string;
  readonly nonce: string;
  readonly roles: string[];
  readonly mfa: boolean;
  readonly expiresAtMs: number;
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(part, "base64url").toString("utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The signature check; `false` on an unknown `kid`, a non-RS256 header or a bad key. */
function signatureValid(
  header: Record<string, unknown>,
  input: string,
  signature: string,
  jwks: Jwks,
): boolean {
  if (header["alg"] !== "RS256" || typeof header["kid"] !== "string")
    return false;
  const jwk = jwks.keys.find(
    (k) =>
      k.kid === header["kid"] &&
      k.kty === "RSA" &&
      (!k.alg || k.alg === "RS256"),
  );
  if (!jwk) return false;
  try {
    const publicKey = createPublicKey({
      key: jwk as JsonWebKeyInput["key"],
      format: "jwk",
    });
    return verify(
      "sha256",
      Buffer.from(input),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

/** Constant-time string equality (a nonce, a client id). */
export function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * OIDC Core §3.1.3.7 for an ID token of `clientId` from `issuer`. `null` on
 * any failure — the caller refuses the redeem and discards every token.
 */
export function verifyIdToken(
  token: string,
  opts: { jwks: Jwks; issuer: string; clientId: string; now: Date },
): VerifiedIdToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decodePart(h);
  const payload = decodePart(p);
  if (!header || !payload) return null;
  if (!signatureValid(header, `${h}.${p}`, s, opts.jwks)) return null;

  if (payload["iss"] !== opts.issuer.replace(/\/$/, "")) return null;
  const aud = payload["aud"];
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(opts.clientId)) return null;
  const azp = payload["azp"];
  if (audiences.length > 1 && azp !== opts.clientId) return null;
  if (azp !== undefined && azp !== opts.clientId) return null;

  const nowS = opts.now.getTime() / 1000;
  const exp = payload["exp"];
  if (typeof exp !== "number" || exp <= nowS) return null;
  const iat = payload["iat"];
  if (typeof iat === "number" && iat > nowS + SKEW_SECONDS) return null;

  const sub = payload["sub"];
  const sid = payload["sid"];
  const nonce = payload["nonce"];
  if (typeof sub !== "string" || !sub) return null;
  if (typeof sid !== "string" || !sid) return null;
  if (typeof nonce !== "string" || !nonce) return null;

  const rolesClaim = payload[ROLES_CLAIM];
  const roles =
    rolesClaim && typeof rolesClaim === "object" && !Array.isArray(rolesClaim)
      ? Object.keys(rolesClaim)
      : [];
  const amr = payload["amr"];
  return {
    sub,
    sid,
    nonce,
    roles,
    mfa: Array.isArray(amr) && amr.includes("mfa"),
    expiresAtMs: exp * 1000,
  };
}

/** OIDC Back-Channel Logout 1.0 §2.4 — the one event a logout token carries. */
export const BACK_CHANNEL_LOGOUT_EVENT =
  "http://schemas.openid.net/event/backchannel-logout";

/** Lifetime ceiling on a logout token's `iat` when it carries no `exp` (BCL §2.6 step 9). */
const LOGOUT_TOKEN_MAX_AGE_SECONDS = 5 * 60;

/** What a verified logout token tells the back-channel endpoint. */
export interface VerifiedLogoutToken {
  /** The Zitadel session that ended — the `zitadelSessionId` storefront sessions link to. */
  readonly sid: string;
  /** The person, when the token names one (BCL §2.4: `sub` or `sid`, here `sid` is required). */
  readonly sub: string | null;
}

/** The `kid` of an RS256 JWT header — the key a verifier must hold; `null` otherwise. */
export function jwtKid(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodePart(parts[0]!);
  return header &&
    header["alg"] === "RS256" &&
    typeof header["kid"] === "string"
    ? header["kid"]
    : null;
}

interface LogoutTokenOpts {
  readonly issuer: string;
  readonly clientIds: ReadonlyArray<string>;
  readonly now: Date;
}

/** BCL §2.6 steps 3–9 on a decoded payload — every check but the signature. */
function logoutClaims(
  payload: Record<string, unknown>,
  opts: LogoutTokenOpts,
): VerifiedLogoutToken | null {
  if (payload["iss"] !== opts.issuer.replace(/\/$/, "")) return null;
  const aud = payload["aud"];
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (
    !audiences.some((a) => typeof a === "string" && opts.clientIds.includes(a))
  )
    return null;

  const nowS = opts.now.getTime() / 1000;
  const iat = payload["iat"];
  if (typeof iat !== "number" || iat > nowS + SKEW_SECONDS) return null;
  const exp = payload["exp"];
  if (exp !== undefined) {
    if (typeof exp !== "number" || exp <= nowS) return null;
  } else if (iat + LOGOUT_TOKEN_MAX_AGE_SECONDS < nowS) {
    return null;
  }

  const events = payload["events"];
  if (
    !events ||
    typeof events !== "object" ||
    Array.isArray(events) ||
    !Object.prototype.hasOwnProperty.call(events, BACK_CHANNEL_LOGOUT_EVENT)
  )
    return null;
  if ("nonce" in payload) return null;

  const sid = payload["sid"];
  if (typeof sid !== "string" || !sid) return null;
  const sub = payload["sub"];
  return { sid, sub: typeof sub === "string" && sub ? sub : null };
}

/**
 * 003 EARS-65 — the cheap, key-free half of logout-token verification: the
 * token parses, names an RS256 `kid`, and its claims pass (`iss`, `aud`,
 * `iat`/`exp`, `events`, `sid`, no `nonce`). Run BEFORE any JWKS fetch, so
 * a token that could never verify never makes the API call the issuer.
 * Answers the `kid` to look up; `null` = refuse at once.
 */
export function precheckLogoutToken(
  token: string,
  opts: LogoutTokenOpts,
): { kid: string } | null {
  const kid = jwtKid(token);
  if (!kid) return null;
  const payload = decodePart(token.split(".")[1]!);
  if (!payload || !logoutClaims(payload, opts)) return null;
  return { kid };
}

/**
 * 003 EARS-65, ADR-0015 §4 «One sign-out» req. 6 — OIDC Back-Channel Logout
 * 1.0 §2.6 for a logout token from `issuer` to either storefront client:
 * RS256 signature against the issuer's JWKS, `iss`, `aud` naming one of
 * `clientIds`, a fresh `iat` (and `exp` when present), the back-channel
 * `events` member, a `sid`, and no `nonce` (which would make it an ID token).
 * `null` on any failure — the caller then revokes nothing.
 */
export function verifyLogoutToken(
  token: string,
  opts: LogoutTokenOpts & { readonly jwks: Jwks },
): VerifiedLogoutToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decodePart(h);
  const payload = decodePart(p);
  if (!header || !payload) return null;
  if (!signatureValid(header, `${h}.${p}`, s, opts.jwks)) return null;
  return logoutClaims(payload, opts);
}
