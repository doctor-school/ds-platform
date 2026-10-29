import { Logger } from "@nestjs/common";
import type { FetchLike } from "../auth/idp/zitadel.idp.js";
import type { LinkedRefreshResult } from "../auth/session/shared-session.js";
import {
  buildClientAssertion,
  jwtKid,
  precheckLogoutToken,
  verifyIdToken,
  verifyLogoutToken,
  type ClientKey,
  type Jwks,
  type VerifiedIdToken,
  type VerifiedLogoutToken,
} from "./storefront-oidc.jwt.js";

/**
 * 003 EARS-62 (API half), ADR-0015 §4 step 3 / req. 2 — the storefront
 * clients' token endpoint call. The API is the only holder of the storefront
 * clients' `private_key_jwt` credentials; this port redeems one authorization
 * code with the transaction's PKCE verifier and hands back the tokens with a
 * VERIFIED ID token (signature, `iss`, `aud`/`azp`, `exp`). The `nonce` and
 * `sid` checks are the caller's: they need the transaction and the record.
 *
 * A port with a fake (as the sign-in host's own Zitadel calls are) so the API
 * e2e drives redeem without a live Zitadel.
 */
export const STOREFRONT_OIDC_IDP = Symbol("STOREFRONT_OIDC_IDP");

export interface CodeRedemption {
  readonly clientId: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface StorefrontTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: VerifiedIdToken;
}

export interface StorefrontOidcIdp {
  /** Zitadel's authorize endpoint (`<issuer>/oauth/v2/authorize`), the storefront entry's redirect target. */
  authorizeEndpoint(): string;
  /** `null` on any refusal: the code is spent, foreign, expired, the verifier wrong, the ID token invalid. */
  redeemCode(input: CodeRedemption): Promise<StorefrontTokens | null>;
  /**
   * 003 EARS-8 (amended) / EARS-9 — rotate a linked session's refresh token
   * through the storefront client that holds it (`refresh_token` grant with
   * that client's `private_key_jwt`). Any refusal is `reuseDetected` (fail closed).
   */
  refreshTokens(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<LinkedRefreshResult>;
  /**
   * 003 EARS-65 — verify an OIDC Back-Channel Logout token addressed to either
   * storefront client (signature against the issuer JWKS, `iss`, `aud`, the
   * back-channel `events`, `sid`, no `nonce`). `null` on any failure.
   */
  verifyLogoutToken(token: string): Promise<VerifiedLogoutToken | null>;
}

/**
 * 003 EARS-65 — the issuer JWKS is refetched at most once per this window,
 * and only for a `kid` the cache does not hold (a signing-key rotation). The
 * back-channel endpoint is public: a stream of forged tokens naming unknown
 * keys can then cost Zitadel at most one key fetch per window, never one per
 * request. 30 s bounds that to 120 fetches an hour while a real rotation is
 * picked up within one window.
 */
export const JWKS_REFRESH_MIN_INTERVAL_MS = 30_000;

const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
}

export interface ZitadelStorefrontOidcConfig {
  /** The Zitadel issuer — the token endpoint's base, the assertion `aud` and the ID token `iss`. */
  readonly issuer: string;
  /** Client id → its key; a client without a key fails closed. */
  readonly keys: ReadonlyMap<string, ClientKey>;
  readonly fetchImpl?: FetchLike;
  readonly clock?: () => Date;
}

export class ZitadelStorefrontOidc implements StorefrontOidcIdp {
  private readonly logger = new Logger(ZitadelStorefrontOidc.name);
  private readonly fetchImpl: FetchLike;
  private readonly clock: () => Date;
  private readonly issuer: string;
  private jwks: Jwks | null = null;
  /** The one JWKS fetch in flight (single-flight), if any. */
  private jwksRefresh: Promise<void> | null = null;
  private lastJwksFetchAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: ZitadelStorefrontOidcConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.clock = config.clock ?? (() => new Date());
    this.issuer = config.issuer.replace(/\/$/, "");
  }

  authorizeEndpoint(): string {
    return `${this.issuer}/oauth/v2/authorize`;
  }

  async redeemCode(input: CodeRedemption): Promise<StorefrontTokens | null> {
    const data = await this.tokenCall(input.clientId, {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
    if (!data?.access_token || !data.refresh_token || !data.id_token)
      return null;
    const idToken = await this.verify(data.id_token, input.clientId);
    if (!idToken) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken,
    };
  }

  async refreshTokens(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<LinkedRefreshResult> {
    // No `scope`: a refresh re-issues the originally granted set (see the BFF
    // adapter's `refreshTokens` — Zitadel refuses re-requesting the roles URN).
    const data = await this.tokenCall(input.clientId, {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    });
    if (!data?.access_token || !data.refresh_token)
      return { reuseDetected: true };
    return {
      reuseDetected: false,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      },
    };
  }

  /** One token-endpoint call authenticated by the client's `private_key_jwt`; `null` on any refusal. */
  private async tokenCall(
    clientId: string,
    grant: Record<string, string>,
  ): Promise<TokenResponse | null> {
    const key = this.config.keys.get(clientId);
    if (!key) {
      this.logger.error(
        "storefront token call: no client key is configured for this client; it fails closed",
      );
      return null;
    }
    try {
      const res = await this.fetchImpl(`${this.issuer}/oauth/v2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...grant,
          client_id: clientId,
          client_assertion_type: ASSERTION_TYPE,
          client_assertion: buildClientAssertion(
            key,
            this.issuer,
            this.clock(),
          ),
        }).toString(),
      });
      if (!res.ok) return null;
      return (await res.json()) as TokenResponse;
    } catch {
      return null;
    }
  }

  async verifyLogoutToken(token: string): Promise<VerifiedLogoutToken | null> {
    // The audiences are the storefront clients this API holds keys for — the
    // two that register the back-channel URI (ADR-0015 §4 req. 6).
    const opts = {
      issuer: this.issuer,
      clientIds: [...this.config.keys.keys()],
      now: this.clock(),
    };
    // Parse and check the claims first: a token that can never verify never
    // reaches the key fetch.
    const pre = precheckLogoutToken(token, opts);
    if (!pre) return null;
    const jwks = await this.keysFor(pre.kid);
    return jwks ? verifyLogoutToken(token, { ...opts, jwks }) : null;
  }

  private async verify(
    token: string,
    clientId: string,
  ): Promise<VerifiedIdToken | null> {
    const kid = jwtKid(token);
    if (!kid) return null;
    const jwks = await this.keysFor(kid);
    return jwks
      ? verifyIdToken(token, {
          issuer: this.issuer,
          clientId,
          now: this.clock(),
          jwks,
        })
      : null;
  }

  /**
   * The cached JWKS, refetched only when it lacks `kid` — single-flight and
   * at most once per {@link JWKS_REFRESH_MIN_INTERVAL_MS}. A failed or empty
   * fetch never replaces good cached keys.
   */
  private async keysFor(kid: string): Promise<Jwks | null> {
    if (!this.jwks?.keys.some((k) => k.kid === kid)) await this.refreshJwks();
    return this.jwks;
  }

  private refreshJwks(): Promise<void> {
    if (this.jwksRefresh) return this.jwksRefresh;
    const nowMs = this.clock().getTime();
    if (nowMs - this.lastJwksFetchAtMs < JWKS_REFRESH_MIN_INTERVAL_MS)
      return Promise.resolve();
    this.lastJwksFetchAtMs = nowMs;
    this.jwksRefresh = this.fetchJwks()
      .then((fetched) => {
        if (fetched && fetched.keys.length > 0) this.jwks = fetched;
      })
      .finally(() => {
        this.jwksRefresh = null;
      });
    return this.jwksRefresh;
  }

  private async fetchJwks(): Promise<Jwks | null> {
    try {
      const res = await this.fetchImpl(`${this.issuer}/oauth/v2/keys`, {
        method: "GET",
        headers: {},
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { keys?: unknown };
      return Array.isArray(data.keys)
        ? { keys: data.keys as Jwks["keys"] }
        : null;
    } catch {
      return null;
    }
  }
}
