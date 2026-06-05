import type {
  CreatedUser,
  CreateUserInput,
  IdpClaims,
  IdpClient,
  IdpRefreshResult,
  IdpSession,
  IdpTokens,
  IdpUser,
  PasswordLoginResult,
} from "./idp.types.js";

/** Subset of `fetch` the adapter needs — narrowed so it can be faked in tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    /**
     * The OIDC authorize hop must read the `Location` redirect rather than
     * follow it — `manual` keeps the 302 visible. Optional so the User/Session
     * v2 callers (which omit it) are unchanged.
     */
    redirect?: "manual" | "follow";
  },
) => Promise<{
  ok: boolean;
  status: number;
  /**
   * Response headers — only the OIDC authorize hop reads them (the `Location`
   * redirect carrying the `authRequest` id). Optional so the existing fetch
   * doubles for the User/Session v2 paths need not provide them.
   */
  headers?: { get?(name: string): string | null } | Record<string, string>;
  json: () => Promise<unknown>;
}>;

export interface ZitadelConfig {
  /** Zitadel instance base URL, e.g. `https://idp.example.com`. */
  baseUrl: string;
  /** Service-account bearer token with User v2 management scope. */
  serviceToken: string;
  /**
   * OIDC **application** client id (the `ds-platform-dev` app created in the
   * Zitadel console — design §3, §11). Required for the session→token exchange
   * and the refresh-token grant; absent ⇒ those two paths fail closed (the
   * adapter still serves the whole User/Session v2 surface). Plumbed from
   * `IDP_CLIENT_ID` (`apps/api/src/config/env.schema.ts`).
   */
  clientId?: string | undefined;
  /** OIDC application client secret — confidential-client token-endpoint auth. */
  clientSecret?: string | undefined;
  /** OIDC redirect URI registered on the application (must match per grant). */
  redirectUri?: string | undefined;
  /**
   * OIDC scopes requested at authorize time. The project-roles claim
   * (`urn:zitadel:iam:org:project:roles`) requires the corresponding scope, so
   * the default includes it alongside `openid profile offline_access`.
   */
  scopes?: string[] | undefined;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike | undefined;
}

/** Zitadel project-roles claim key (design §3, ADR-0001 §6 — `roles[]`). */
const ZITADEL_PROJECT_ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";

const DEFAULT_OIDC_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  ZITADEL_PROJECT_ROLES_CLAIM,
];

/** The OIDC token-endpoint response shape (the subset the BFF reads). */
interface OidcTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

/**
 * Decode a JWT payload **without verifying the signature** — Zitadel signs the
 * id_token and the BFF trusts the channel (the token came straight from the
 * configured token endpoint over the trusted hop, design §2; `apps/api` signs
 * and verifies nothing). Returns `{}` on any malformed input so claim parsing
 * degrades to empty rather than throwing.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) return {};
  try {
    return JSON.parse(
      Buffer.from(part, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Parse the principal claims (design §3, EARS-8) from an OIDC id_token: `sub`,
 * the Zitadel project-roles claim → `roles[]`, and `amr` → `mfa`. The roles
 * claim is a map `{ roleKey: { orgId: orgDomain } }`; we surface the role keys.
 *
 * `mfa` is derived from the RFC 8176 dedicated multi-factor reference `"mfa"`
 * alone — NOT from the presence of any single second-factor method name. The
 * passwordless email-OTP (EARS-6) and SMS-OTP (EARS-7) logins are *single*
 * factor and emit `amr:["otp"]`; treating that as `mfa:true` would fail-open
 * the future `role → mfa_required` seam (design §7) whose verdict
 * `SessionService.establish` persists.
 */
function parseIdpClaims(idToken: string): IdpClaims {
  const payload = decodeJwtPayload(idToken);
  const sub =
    typeof payload["sub"] === "string" ? (payload["sub"] as string) : "";
  const rolesClaim = payload[ZITADEL_PROJECT_ROLES_CLAIM];
  const roles =
    rolesClaim && typeof rolesClaim === "object" && !Array.isArray(rolesClaim)
      ? Object.keys(rolesClaim as Record<string, unknown>)
      : [];
  const amr = payload["amr"];
  const mfa = Array.isArray(amr) && amr.includes("mfa");
  return { sub, roles, mfa };
}

/**
 * Real Zitadel adapter for the {@link IdpClient} port (design §2).
 *
 * It speaks the Zitadel **User v2 / Session v2 APIs** plus the **OIDC**
 * authorize/token endpoints — `apps/api` reimplements no auth primitive
 * (Constraints; AGPL §13 discipline: integrate via API only, never patch
 * Zitadel). It is bound by the {@link IdpModule} factory **only when a service
 * token is configured**; with the dev-stand's empty `IDP_CLIENT_SECRET` the
 * {@link FakeIdpClient} is used instead, so this adapter's HTTP paths are
 * exercised by integration runs that point at a real Zitadel (skipped in the
 * shared CI unit job — `IDP_ISSUER` is not in turbo `passThroughEnv`), not by
 * the default `api-e2e` job. Every failure path resolves fail-closed
 * (enumeration-safe / never an open gate, ADR-0001 §7). The session→token
 * exchange (EARS-8) and refresh rotation (EARS-9) additionally require the OIDC
 * **application** config (`clientId` / `redirectUri`); absent it those two paths
 * fail closed while the rest of the surface still works.
 */
export class ZitadelIdpClient implements IdpClient {
  private readonly fetchImpl: FetchLike;

  /**
   * Checked-session tokens captured at login, keyed by `zitadelSessionId`. The
   * OIDC authorize→token dance needs the session **token** (proof the session
   * passed its check), but the BFF port only carries the opaque `sessionId`
   * between {@link passwordLogin}/`loginWith*Otp` and
   * {@link exchangeSessionForTokens}. Zitadel's `POST /v2/sessions` returns both;
   * we cache the token here and consume it (single-use, deleted on exchange)
   * within the same request lifecycle on this singleton adapter. Memory-bounded
   * by the single-use delete — an unconsumed entry only lingers if a login is
   * never traded for tokens (a programming error in the BFF).
   */
  private readonly sessionTokens = new Map<string, string>();

  constructor(private readonly config: ZitadelConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  /**
   * Record the checked-session token Zitadel returned alongside a `sessionId`,
   * so the OIDC exchange can present it. Called by the login paths; exposed for
   * the unit spec (which drives the exchange in isolation, without a live
   * `/v2/sessions` round-trip).
   */
  rememberSessionToken(zitadelSessionId: string, sessionToken: string): void {
    this.sessionTokens.set(zitadelSessionId, sessionToken);
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.serviceToken}`,
      "content-type": "application/json",
    };
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async createUser(input: CreateUserInput): Promise<CreatedUser> {
    // Zitadel POST /v2/users/human — duplicate identifier returns 409, which is
    // the enumeration-safety hinge: surface it as `alreadyExisted`, not a throw.
    const body: Record<string, unknown> = {
      password: { password: input.password },
    };
    if (input.email) body["email"] = { email: input.email };
    if (input.phone) body["phone"] = { phone: input.phone };

    const res = await this.fetchImpl(this.url("/v2/users/human"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 409) return { sub: "", alreadyExisted: true };
    if (!res.ok) {
      throw new Error(`zitadel createUser failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { userId?: string };
    return { sub: data.userId ?? "", alreadyExisted: false };
  }

  async requestEmailVerification(sub: string): Promise<void> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/email/_send_code`),
      { method: "POST", headers: this.headers(), body: JSON.stringify({}) },
    );
    // Surface a failed send instead of silently looking like success
    // (consistent with createUser); the caller decides the user-facing message.
    if (!res.ok) {
      throw new Error(`zitadel email send_code failed: HTTP ${res.status}`);
    }
  }

  async requestPhoneVerification(sub: string): Promise<void> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/phone/_send_code`),
      { method: "POST", headers: this.headers(), body: JSON.stringify({}) },
    );
    if (!res.ok) {
      throw new Error(`zitadel phone send_code failed: HTTP ${res.status}`);
    }
  }

  async verifyEmail(sub: string, code: string): Promise<boolean> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/email/_verify`),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ verificationCode: code }),
      },
    );
    return res.ok;
  }

  async verifyPhone(sub: string, code: string): Promise<boolean> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/phone/_verify`),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ verificationCode: code }),
      },
    );
    return res.ok;
  }

  async passwordLogin(
    identifier: string,
    password: string,
  ): Promise<PasswordLoginResult> {
    // Zitadel Session v2: POST /v2/sessions with a user + password check. A
    // failed check (unknown loginName / wrong password) is a non-2xx — resolve
    // it to `rejected` so the caller stays enumeration-safe (EARS-16); Zitadel's
    // native lockout policy counts the failure (EARS-15). The session that comes
    // back has already passed its check (design §3).
    //
    // Native-lockout *observation* (the `locked` verdict, EARS-15) is not
    // distinguished here: the BFF's lockout audit is a best-effort observation
    // and Zitadel owns the authoritative lock + its own notification + audit.
    // Mapping a specific locked-account error to `locked` is a refinement for
    // when this adapter is exercised against the live dev-stand instance (the
    // token-exchange paths below are still integration seams, design §11).
    const res = await this.fetchImpl(this.url("/v2/sessions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        checks: {
          user: { loginName: identifier },
          password: { password },
        },
      }),
    });
    if (!res.ok) return { outcome: "rejected" };
    const data = (await res.json()) as {
      sessionId?: string;
      sessionToken?: string;
      factors?: { user?: { id?: string } };
    };
    const zitadelSessionId = data.sessionId;
    const sub = data.factors?.user?.id;
    if (!zitadelSessionId || !sub) return { outcome: "rejected" };
    // Cache the session token for the OIDC exchange (see `sessionTokens`).
    if (data.sessionToken)
      this.rememberSessionToken(zitadelSessionId, data.sessionToken);
    return { outcome: "authenticated", session: { zitadelSessionId, sub } };
  }

  /** OIDC-application config the token/refresh grants require, or throw if absent. */
  private requireOidcApp(): {
    clientId: string;
    redirectUri: string;
  } {
    if (!this.config.clientId || !this.config.redirectUri) {
      throw new Error(
        "zitadel OIDC application config (IDP_CLIENT_ID / redirect URI) is not set; cannot complete the token exchange (design §3, §11)",
      );
    }
    return {
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
    };
  }

  /**
   * Form-encode the confidential-client token-endpoint auth. Zitadel accepts
   * `client_secret_post`; the secret is optional only for a public/PKCE client
   * (not the v1 BFF, which is confidential).
   */
  private tokenAuthParams(): Record<string, string> {
    const params: Record<string, string> = {
      client_id: this.config.clientId ?? "",
    };
    if (this.config.clientSecret)
      params["client_secret"] = this.config.clientSecret;
    return params;
  }

  /** Read a `Location`/`location` header from either a Headers object or a plain map. */
  private readLocation(res: {
    headers?: { get?(name: string): string | null } | Record<string, string>;
  }): string | null {
    const h = res.headers;
    if (!h) return null;
    if (typeof (h as { get?: unknown }).get === "function") {
      return (h as { get(name: string): string | null }).get("location");
    }
    const map = h as Record<string, string>;
    return map["location"] ?? map["Location"] ?? null;
  }

  /**
   * EARS-8 (design §3): turn a checked Zitadel session into OIDC tokens via the
   * authorize-with-session → code → token-endpoint dance.
   *
   * 1. `GET /oauth/v2/authorize` (redirect=manual) → a 302 whose `Location`
   *    carries the `authRequest` id (the pending OIDC auth request).
   * 2. `POST /v2/oidc/auth_requests/{id}` `{ session: { sessionId, sessionToken } }`
   *    links the checked session and returns a `callbackUrl` carrying the `code`.
   * 3. `POST /oauth/v2/token` (authorization_code grant) → access + rotating
   *    refresh + id_token; claims (`sub`, `roles[]`, `mfa`) are parsed from the
   *    id_token.
   *
   * Fails closed (throws, mints nothing) on any missing config, missing session
   * token, or non-2xx — never an open gate (ADR-0001 §7).
   */
  async exchangeSessionForTokens(zitadelSessionId: string): Promise<IdpTokens> {
    const { clientId, redirectUri } = this.requireOidcApp();
    const sessionToken = this.sessionTokens.get(zitadelSessionId);
    if (!sessionToken) {
      throw new Error(
        "no checked-session token captured for this session; cannot complete the OIDC exchange",
      );
    }

    // Consume the captured session token — single-use, on EVERY exit path
    // (success or a throw in any of steps 1–3). Leaving it in the Map on an
    // early throw would leak sensitive Zitadel session material indefinitely on
    // this global singleton adapter, so the delete lives in a `finally`.
    try {
      // 1. Start the OIDC auth request; read (do not follow) the redirect.
      const scopes = (this.config.scopes ?? DEFAULT_OIDC_SCOPES).join(" ");
      const authorizeQuery = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: scopes,
        prompt: "none",
      });
      const authorizeRes = await this.fetchImpl(
        this.url(`/oauth/v2/authorize?${authorizeQuery.toString()}`),
        { method: "GET", headers: this.headers(), redirect: "manual" },
      );
      const location = this.readLocation(authorizeRes);
      const authRequestId = location
        ? new URLSearchParams(location.split("?")[1] ?? "").get("authRequest")
        : null;
      if (!authRequestId) {
        throw new Error("zitadel authorize did not yield an authRequest id");
      }

      // 2. Link the checked session → callbackUrl with the code.
      const linkRes = await this.fetchImpl(
        this.url(`/v2/oidc/auth_requests/${authRequestId}`),
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            session: { sessionId: zitadelSessionId, sessionToken },
          }),
        },
      );
      if (!linkRes.ok) {
        throw new Error(
          `zitadel auth_request link failed: HTTP ${linkRes.status}`,
        );
      }
      const linkData = (await linkRes.json()) as { callbackUrl?: string };
      const code = linkData.callbackUrl
        ? new URLSearchParams(linkData.callbackUrl.split("?")[1] ?? "").get(
            "code",
          )
        : null;
      if (!code) {
        throw new Error("zitadel auth_request callback carried no code");
      }

      // 3. Exchange the code for tokens.
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        ...this.tokenAuthParams(),
      });
      const tokenRes = await this.fetchImpl(this.url("/oauth/v2/token"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.serviceToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: tokenBody.toString(),
      });
      if (!tokenRes.ok) {
        throw new Error(
          `zitadel token endpoint failed: HTTP ${tokenRes.status}`,
        );
      }
      const data = (await tokenRes.json()) as OidcTokenResponse;
      if (!data.access_token || !data.refresh_token) {
        throw new Error("zitadel token response missing access/refresh token");
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresInSeconds: data.expires_in ?? 0,
        claims: parseIdpClaims(data.id_token ?? ""),
      };
    } finally {
      this.sessionTokens.delete(zitadelSessionId);
    }
  }

  /**
   * EARS-9 (design §3): rotate a single-use refresh token via the OAuth
   * refresh-token grant. Zitadel issues rotating refresh tokens and owns
   * RFC-6819 reuse detection (ADR-0001 §7) — a replay of a consumed token is a
   * non-2xx (`invalid_grant`), which this adapter relays as `reuseDetected: true`
   * so the BFF invalidates the chain. A success yields the fresh token pair and
   * the re-parsed claims. Fails closed (any non-2xx ⇒ reuse) — never mints on
   * an ambiguous response.
   */
  async refreshTokens(refreshToken: string): Promise<IdpRefreshResult> {
    if (!this.config.clientId) {
      throw new Error(
        "zitadel OIDC application config (IDP_CLIENT_ID) is not set; cannot rotate (design §3, §11)",
      );
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: (this.config.scopes ?? DEFAULT_OIDC_SCOPES).join(" "),
      ...this.tokenAuthParams(),
    });
    const res = await this.fetchImpl(this.url("/oauth/v2/token"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.serviceToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    // A rejected grant — the IdP's RFC-6819 reuse verdict — fails closed.
    if (!res.ok) return { reuseDetected: true };
    const data = (await res.json()) as OidcTokenResponse;
    if (!data.access_token || !data.refresh_token) {
      return { reuseDetected: true };
    }
    return {
      reuseDetected: false,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresInSeconds: data.expires_in ?? 0,
        claims: parseIdpClaims(data.id_token ?? ""),
      },
    };
  }

  /**
   * Resolve an identifier (email or phone) to a Zitadel `userId`, or `null` if no
   * user matches. Uses the User v2 search with an EQUALS query on the matching
   * channel. Fails closed — any non-2xx or empty result is `null` — so the reset
   * paths below stay enumeration-safe (an unknown identifier looks like a hiccup).
   */
  private async resolveUserId(identifier: string): Promise<string | null> {
    const query = identifier.startsWith("+")
      ? { phoneQuery: { number: identifier } }
      : { emailQuery: { emailAddress: identifier } };
    const res = await this.fetchImpl(this.url("/v2/users"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ queries: [query] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: Array<{ userId?: string }> };
    return data.result?.[0]?.userId ?? null;
  }

  async requestPasswordReset(identifier: string): Promise<void> {
    // Zitadel User v2: POST /v2/users/{userId}/password_reset triggers the
    // forgot-password code (Zitadel sends it via the configured notifier). Every
    // step is best-effort and swallowed: an unknown identifier, or any provider
    // error, must produce the IDENTICAL outcome as success so the BFF response is
    // not an existence oracle (EARS-11/16). We therefore never throw here.
    const userId = await this.resolveUserId(identifier);
    if (!userId) return;
    await this.fetchImpl(this.url(`/v2/users/${userId}/password_reset`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    }).catch(() => undefined);
  }

  async completePasswordReset(
    identifier: string,
    code: string,
    newPassword: string,
  ): Promise<{ sub: string } | null> {
    // Zitadel User v2: POST /v2/users/{userId}/password with the verificationCode
    // from the reset flow sets the new password. A non-2xx (bad/expired code) or
    // an unknown identifier both resolve to `null` — indistinguishable, generic
    // (EARS-16). The IdP owns the password and the code check (design §2).
    const userId = await this.resolveUserId(identifier);
    if (!userId) return null;
    const res = await this.fetchImpl(this.url(`/v2/users/${userId}/password`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        newPassword: { password: newPassword },
        verificationCode: code,
      }),
    });
    return res.ok ? { sub: userId } : null;
  }

  // ── Passwordless login OTP (EARS-6/7) — INTEGRATION SEAM (design §3, §6, §11) ──
  // Zitadel login OTP is Session v2: create a session with a `user` check and an
  // `otpEmail`/`otpSms` challenge (Zitadel sends the code), then update the same
  // session with the submitted code, then exchange the checked session for tokens.
  // The challenge is bound to a server-side session that must be carried between
  // the request and verify calls, and the final hop is the same authorize-with-
  // session → token exchange that `exchangeSessionForTokens` still lacks the
  // OIDC-application config for (IDP_CLIENT_ID / redirect, created against the
  // dev-stand console as a recipe follow-up). Until that config is plumbed and
  // verifiable against a live instance, fail closed — send/verify nothing — rather
  // than ship an unverifiable OTP-login path. The BFF orchestration (EARS-6/7) and
  // the SMS toll-fraud budget (EARS-14) are proven against FakeIdpClient.
  requestEmailOtp(_identifier: string): Promise<void> {
    return Promise.reject(
      new Error(
        "zitadel email-OTP login is not wired against the dev-stand yet (design §11)",
      ),
    );
  }

  loginWithEmailOtp(
    _identifier: string,
    _code: string,
  ): Promise<IdpSession | null> {
    return Promise.reject(
      new Error(
        "zitadel email-OTP login is not wired against the dev-stand yet (design §11)",
      ),
    );
  }

  requestSmsOtp(_identifier: string): Promise<void> {
    return Promise.reject(
      new Error(
        "zitadel SMS-OTP login is not wired against the dev-stand yet (design §11)",
      ),
    );
  }

  loginWithSmsOtp(
    _identifier: string,
    _code: string,
  ): Promise<IdpSession | null> {
    return Promise.reject(
      new Error(
        "zitadel SMS-OTP login is not wired against the dev-stand yet (design §11)",
      ),
    );
  }

  async listUsers(): Promise<IdpUser[]> {
    const res = await this.fetchImpl(this.url("/v2/users"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      result?: Array<{
        userId?: string;
        human?: {
          email?: { email?: string; isVerified?: boolean };
          phone?: { phone?: string; isVerified?: boolean };
        };
      }>;
    };
    return (data.result ?? []).map((u) => ({
      sub: u.userId ?? "",
      email: u.human?.email?.email,
      phone: u.human?.phone?.phone,
      emailVerified: u.human?.email?.isVerified ?? false,
      phoneVerified: u.human?.phone?.isVerified ?? false,
    }));
  }
}
