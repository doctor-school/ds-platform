import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { LinkedRefreshResult } from "../auth/session/shared-session.js";
import type {
  CodeRedemption,
  StorefrontOidcIdp,
  StorefrontTokens,
} from "./storefront-oidc.idp.js";
import {
  BACK_CHANNEL_LOGOUT_EVENT,
  verifyLogoutToken,
  type Jwks,
  type VerifiedLogoutToken,
} from "./storefront-oidc.jwt.js";
import { s256 } from "./storefront-oidc.service.js";

/** The fake issuer: the authorize endpoint base and every logout token `iss`. */
export const FAKE_STOREFRONT_ISSUER = "http://idp.e2e.test";

interface IssuedCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly sid: string;
  readonly sub: string;
  readonly nonce: string;
  readonly roles: string[];
  readonly expiresAtMs: number;
  used: boolean;
}

/**
 * In-memory {@link StorefrontOidcIdp} for the API e2e: the test issues a code
 * as Zitadel would after a finalisation (bound to its client, redirect URI,
 * `S256` challenge, the Zitadel session `sid` and the transaction `nonce`),
 * and the redeem enforces what Zitadel's token endpoint does — single use
 * (a second attempt is refused), expiry, client and redirect binding, and the
 * PKCE verifier.
 */
export class FakeStorefrontOidc implements StorefrontOidcIdp {
  private readonly codes = new Map<string, IssuedCode>();
  /** Every redeem attempt, for the suites that assert what reached the token endpoint. */
  readonly attempts: CodeRedemption[] = [];
  /** Every refresh grant, with the client that presented it. */
  readonly refreshes: Array<{ clientId: string; refreshToken: string }> = [];
  /** Live refresh token → the client it was issued to (single use, as Zitadel rotates). */
  private readonly liveRefresh = new Map<string, string>();
  /**
   * 003 EARS-65 — the fake issuer signing key: the e2e signs logout tokens as
   * Zitadel would, and they are verified by the same {@link verifyLogoutToken}
   * the real adapter runs, against this JWKS.
   */
  private readonly signing = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  private readonly jwks: Jwks = {
    keys: [
      {
        ...this.signing.publicKey.export({ format: "jwk" }),
        kid: "fake-sig-1",
        alg: "RS256",
        use: "sig",
      },
    ],
  };

  /** `clientIds` — the storefront clients a logout token may be addressed to. */
  constructor(private readonly clientIds: ReadonlyArray<string> = []) {}

  verifyLogoutToken(token: string): Promise<VerifiedLogoutToken | null> {
    return Promise.resolve(
      verifyLogoutToken(token, {
        jwks: this.jwks,
        issuer: FAKE_STOREFRONT_ISSUER,
        clientIds: this.clientIds,
        now: new Date(),
      }),
    );
  }

  /**
   * A logout token as Zitadel posts it (BCL §2.4), signed by the fake issuer;
   * `claims` overrides or (with `undefined`) removes a member.
   */
  signLogoutToken(input: {
    aud: string;
    sid: string;
    sub?: string;
    claims?: Record<string, unknown>;
  }): string {
    const iat = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      iss: FAKE_STOREFRONT_ISSUER,
      aud: input.aud,
      ...(input.sub ? { sub: input.sub } : {}),
      sid: input.sid,
      jti: randomBytes(8).toString("hex"),
      iat,
      exp: iat + 120,
      events: { [BACK_CHANNEL_LOGOUT_EVENT]: {} },
      ...input.claims,
    };
    const part = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const signed = `${part({ alg: "RS256", kid: "fake-sig-1", typ: "logout+jwt" })}.${part(payload)}`;
    const signature = sign(
      "sha256",
      Buffer.from(signed),
      this.signing.privateKey,
    );
    return `${signed}.${signature.toString("base64url")}`;
  }

  /** The fake issuer's authorize endpoint — the e2e reads its parameters, never follows it. */
  authorizeEndpoint(): string {
    return `${FAKE_STOREFRONT_ISSUER}/oauth/v2/authorize`;
  }

  refreshTokens(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<LinkedRefreshResult> {
    this.refreshes.push({ ...input });
    const owner = this.liveRefresh.get(input.refreshToken);
    // A spent, unknown or another client's token is a refused grant.
    if (owner !== input.clientId)
      return Promise.resolve({ reuseDetected: true });
    this.liveRefresh.delete(input.refreshToken);
    const refreshToken = `rt-${randomBytes(8).toString("hex")}`;
    this.liveRefresh.set(refreshToken, input.clientId);
    return Promise.resolve({
      reuseDetected: false,
      tokens: {
        accessToken: `at-${randomBytes(8).toString("hex")}`,
        refreshToken,
      },
    });
  }

  issueCode(input: {
    clientId: string;
    redirectUri: string;
    /** The transaction's `S256` challenge, as the authorize request carried it. */
    codeChallenge: string;
    sid: string;
    sub: string;
    nonce: string;
    roles?: string[];
    ttlSeconds?: number;
  }): string {
    const code = randomBytes(16).toString("base64url");
    this.codes.set(code, {
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      sid: input.sid,
      sub: input.sub,
      nonce: input.nonce,
      roles: input.roles ?? ["doctor_guest"],
      expiresAtMs: Date.now() + (input.ttlSeconds ?? 600) * 1000,
      used: false,
    });
    return code;
  }

  /** The code outlived its lifetime at the IdP. */
  expireCode(code: string): void {
    const issued = this.codes.get(code);
    if (issued) this.codes.set(code, { ...issued, expiresAtMs: 0 });
  }

  redeemCode(input: CodeRedemption): Promise<StorefrontTokens | null> {
    this.attempts.push(input);
    const issued = this.codes.get(input.code);
    if (!issued || issued.used) return Promise.resolve(null);
    issued.used = true;
    if (
      issued.expiresAtMs <= Date.now() ||
      issued.clientId !== input.clientId ||
      issued.redirectUri !== input.redirectUri ||
      issued.codeChallenge !== s256(input.codeVerifier)
    ) {
      return Promise.resolve(null);
    }
    const refreshToken = `rt-${randomBytes(8).toString("hex")}`;
    this.liveRefresh.set(refreshToken, input.clientId);
    return Promise.resolve({
      accessToken: `at-${randomBytes(8).toString("hex")}`,
      refreshToken,
      idToken: {
        sub: issued.sub,
        sid: issued.sid,
        nonce: issued.nonce,
        roles: issued.roles,
        mfa: false,
        expiresAtMs: Date.now() + 3600 * 1000,
      },
    });
  }
}
