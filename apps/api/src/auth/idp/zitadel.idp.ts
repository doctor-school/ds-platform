import {
  IdpInvalidArgumentError,
  IdpPasswordPolicyError,
  IdpUnavailableError,
  type CreatedUser,
  type CreateUserInput,
  type IdpClaims,
  type IdpClient,
  type IdpRefreshResult,
  type IdpSession,
  type IdpTokens,
  type IdpUser,
  type PasswordLoginResult,
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
  /**
   * #157: the Zitadel **project** that owns the `doctor_guest` role (the
   * `PROJECT_ID` emitted by `infra/dev-stand/idp/provision.sh`). Required by
   * {@link ZitadelIdpClient.grantProjectRole} — it is the project the per-user
   * grant authorizes, which is what the OIDC token's project-roles claim then
   * asserts. Absent ⇒ `grantProjectRole` fails closed, consistent with the
   * adapter's other OIDC-config-gated paths (clientId/redirectUri). Plumbed from
   * `IDP_PROJECT_ID` (`apps/api/src/config/env.schema.ts`).
   */
  projectId?: string | undefined;
  /**
   * #203: the Zitadel **organization** id the resource API requires in the body
   * of {@link ZitadelIdpClient.createUser} (`CreateUser` `POST /v2/users/new`) and
   * {@link ZitadelIdpClient.grantProjectRole} (`CreateAuthorization`). The
   * deprecated `AddHumanUser` / management-v1 grant inferred the org from the
   * service token; the resource API does NOT — `organizationId` is a required
   * request field (proven live: a `CreateUser` without it 400s
   * `invalid CreateUserRequest.OrganizationId: value length must be between 1 and
   * 200`). Optional here: absent, the adapter resolves the service account's own
   * org once via `GET /management/v1/orgs/me` and caches it (see
   * {@link ZitadelIdpClient.resolveOrgId}), so the dev-stand needs no new env.
   * Plumbed from `IDP_ORG_ID`.
   */
  orgId?: string | undefined;
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

  /**
   * Live OTP-login challenges captured between the two port calls, keyed by the
   * lowercased `identifier`. The {@link IdpClient} port passes ONLY `identifier`
   * to both `requestEmailOtp`/`requestSmsOtp` (which arms the challenge) and the
   * matching `loginWith*Otp` (which verifies the code) — no Zitadel session
   * handle crosses the port — so this adapter must carry the server-side session
   * (`sessionId` + the still-unchecked `sessionToken`) between the two calls
   * itself. We stash it here on the request hop and consume it (single-use,
   * deleted on the verify hop) on the same singleton adapter within the request
   * lifecycle, exactly mirroring the {@link sessionTokens} pattern.
   *
   * NB: this is the **second** hidden cross-request state on this singleton
   * adapter — the exact concern #143 (IdpSession port widening: thread an
   * explicit end-to-end session handle through the port instead of caching it in
   * the adapter) tracks. #153 directs mirroring the existing `sessionTokens`
   * pattern here because #143 has not landed; doing so ADDS one more entry to the
   * #143 debt openly rather than deepening the hidden state silently. When #143
   * lands, both Maps fold into the explicit port handle.
   */
  private readonly otpChallenges = new Map<
    string,
    { sessionId: string; sessionToken: string; sub: string }
  >();

  /**
   * #203: the resolved org id the resource API (`CreateUser` /
   * `CreateAuthorization`) needs in the request body. Seeded from
   * `config.orgId` when configured; otherwise resolved once on first need from
   * the service account's own org and memoised here (a single in-flight promise
   * so concurrent first-calls share one round-trip). See {@link resolveOrgId}.
   */
  private orgIdPromise: Promise<string> | undefined;

  constructor(private readonly config: ZitadelConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  /**
   * #203: resolve the Zitadel org id the resource API requires in the body of
   * `CreateUser` / `CreateAuthorization`. Prefers the explicitly-configured
   * `config.orgId`; otherwise asks the instance for the service account's own org
   * (`GET /management/v1/orgs/me` → `{ org: { id } }`, proven live) and caches it.
   * The lookup is memoised in a single shared promise so the first concurrent
   * creates issue ONE round-trip. Throws {@link IdpUnavailableError} if the org
   * cannot be resolved (no configured id and the lookup failed) — a create that
   * cannot name its org must fail closed as "unavailable", never a bare 500.
   */
  private resolveOrgId(): Promise<string> {
    if (this.config.orgId) return Promise.resolve(this.config.orgId);
    if (!this.orgIdPromise) {
      this.orgIdPromise = (async () => {
        let res;
        try {
          res = await this.fetchImpl(this.url("/management/v1/orgs/me"), {
            method: "GET",
            headers: this.headers(),
          });
        } catch (err) {
          throw new IdpUnavailableError(
            `zitadel orgs/me unreachable: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (!res.ok) {
          throw new IdpUnavailableError(
            `zitadel orgs/me failed: HTTP ${res.status}`,
          );
        }
        const data = (await res.json()) as { org?: { id?: string } };
        const id = data.org?.id;
        if (!id) {
          throw new IdpUnavailableError(
            "zitadel orgs/me returned no org id",
          );
        }
        return id;
      })().catch((err: unknown) => {
        // Do not cache a failed resolution — a transient outage must not poison
        // every later create; clear the memo so the next call retries.
        this.orgIdPromise = undefined;
        throw err;
      });
    }
    return this.orgIdPromise;
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
    // #203: the CURRENT resource API `CreateUser` — `POST /v2/users/new` — which
    // REPLACES the deprecated `AddHumanUser` (`POST /v2/users/human`). A duplicate
    // identifier still returns 409 (proven live: `Пользователь уже существует
    // (V3-DKcYh)`), the enumeration-safety hinge: surface it as `alreadyExisted`,
    // not a throw.
    //
    // CreateUser wire-shape deltas vs AddHumanUser (all proven live against the
    // v4.15 dev-stand, #203):
    //   • `organizationId` is a REQUIRED top-level body field — AddHumanUser
    //     inferred the org from the service token; CreateUser does not (omitting
    //     it 400s `invalid CreateUserRequest.OrganizationId`). Resolved via
    //     {@link resolveOrgId} (configured `IDP_ORG_ID`, else the service
    //     account's own org).
    //   • the human fields nest under a `human` object (`human.profile`,
    //     `human.email`, `human.phone`, `human.password`) — AddHumanUser had them
    //     at the top level.
    //   • the new-user id is returned as `id` (not `userId`).
    //   • the email auto-send-suppression directive is unchanged: `returnCode: {}`
    //     under `human.email` still suppresses the auto-send (the code is echoed
    //     in the response as `emailCode` instead — proven live), preserving the
    //     #153 single-delivered-code invariant below.
    //
    // The `profile` placeholder (#145) is unchanged: self-service registration
    // (EARS-1) collects NO name — the `users` mirror has no name column (design
    // §5) — so we send a minimal placeholder the domain never sees: `givenName` =
    // the email local-part (or `"doctor"`) and a fixed `familyName` = `"guest"`
    // (the `doctor_guest` role, ADR-0001 §1). A pure adapter detail, never read
    // back, mirrored, or surfaced.
    const givenName = input.email
      ? (input.email.split("@")[0] ?? "doctor")
      : "doctor";
    const human: Record<string, unknown> = {
      profile: { givenName, familyName: "guest" },
      password: { password: input.password },
    };
    // Live wire-shape (#153, carried onto CreateUser): a bare `email: { email }`
    // (no verification directive) makes Zitadel AUTO-SEND a verification code on
    // creation. The BFF then sends its OWN code via `requestEmailVerification`
    // (design §4), so the registrant would receive TWO emails with TWO different
    // codes — and the auto-sent first code is immediately INVALIDATED by the
    // second, leaving a registrant who opens the earlier mail with a dead code.
    // `returnCode: {}` suppresses the auto-send (the code is echoed in the create
    // RESPONSE as `emailCode` instead — server-side only, never surfaced),
    // leaving the BFF's single deliberate `requestEmailVerification` as the ONE
    // delivered code. Confirmed live on CreateUser: `returnCode: {}` ⇒ the
    // response carries `emailCode` and Mailpit receives no auto-send. Same
    // directive on the phone object for the symmetric phone case.
    if (input.email)
      human["email"] = { email: input.email, returnCode: {} };
    if (input.phone)
      human["phone"] = { phone: input.phone, returnCode: {} };

    let orgId: string;
    try {
      orgId = await this.resolveOrgId();
    } catch (err) {
      // The org could not be resolved (no configured id and the lookup failed) —
      // fail closed as "unavailable", never a bare 500 (#202). `resolveOrgId`
      // already throws {@link IdpUnavailableError}; re-throw as-is.
      if (err instanceof IdpUnavailableError) throw err;
      throw new IdpUnavailableError(
        `zitadel createUser could not resolve org: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const body: Record<string, unknown> = {
      organizationId: orgId,
      human,
    };
    // Set `username` to the email/phone for a stable, human-readable login name
    // (CreateUser's `username` is optional and defaults to the user id otherwise);
    // matches what AddHumanUser derived implicitly and keeps `loginNames` aligned
    // with the identifier the user registers with.
    if (input.email) body["username"] = input.email;
    else if (input.phone) body["username"] = input.phone;

    let res;
    try {
      res = await this.fetchImpl(this.url("/v2/users/new"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      // A network/transport failure (fetch rejects) is an infra fault, not a
      // deterministic rejection — surface it as {@link IdpUnavailableError} so the
      // service answers a 503, never a bare 500 (#202).
      throw new IdpUnavailableError(
        `zitadel createUser unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status === 409) return { sub: "", alreadyExisted: true };
    if (!res.ok) {
      // #147 residual race: the BFF creation schema mirrors the deployed Zitadel
      // default complexity policy as a baseline, so a baseline-violating password
      // is rejected at the DTO layer before this call. If a *stricter* live policy
      // rejects the password here it is a 400 whose body names the password/policy
      // — surface it as the typed {@link IdpPasswordPolicyError} so the service can
      // answer with a generic, non-enumerating "weak password" 422 (never a 500,
      // never an existence oracle; a duplicate is the 409 handled above).
      if (res.status === 400 && (await this.isPasswordPolicyRejection(res))) {
        throw new IdpPasswordPolicyError(
          "zitadel createUser rejected the password (policy)",
        );
      }
      // #202 error taxonomy: a deterministic 4xx `invalid_argument` (any other bad
      // request the IdP refuses before creating anything — e.g. the removed
      // phone-only/no-email shape, which on CreateUser 400s `invalid
      // CreateUserRequest.Human: ... invalid CreateUserRequest_Human.Email: value
      // is required`) maps to the generic, enumeration-safe failure (a 4xx, NOT a
      // 500, NOT an existence oracle). A genuine infra fault (5xx) maps to a 503
      // "unavailable". This is what guarantees a deterministic IdP rejection never
      // surfaces as a bare 500.
      if (res.status >= 400 && res.status < 500) {
        throw new IdpInvalidArgumentError(
          `zitadel createUser rejected the request: HTTP ${res.status}`,
        );
      }
      throw new IdpUnavailableError(
        `zitadel createUser failed: HTTP ${res.status}`,
      );
    }
    // #203: CreateUser returns the new id as `id` (CreateUserResponse), NOT the
    // `userId` AddHumanUser returned. Proven live: a successful create responds
    // `{ id, creationDate, emailCode }`.
    const data = (await res.json()) as { id?: string };
    return { sub: data.id ?? "", alreadyExisted: false };
  }

  /**
   * Inspect a `createUser` 400 body to decide whether it is a password-policy
   * rejection (#147). Zitadel's error envelope carries a stable, machine-readable
   * error `id` (e.g. `COMMA-HuJf6`) plus a human `message`. We match PRIMARILY on
   * the language-independent `COMMA-` id prefix, because the live dev-stand now
   * answers in **Russian** (#195 localised the notification/error texts to RU):
   * every password-complexity rejection carries `COMMA-…` regardless of UI
   * language, while the human message no longer contains the English tokens
   * "password"/"complexity" (proven live on CreateUser, #203: a short password
   * 400s `Пароль слишком короткий (COMMA-HuJf6)`, an upper-case-missing one
   * `Пароль должен содержать верхний регистр (COMMA-VoaRj)`, etc.). The English
   * tokens are kept as a fallback for an English-configured instance. We FAIL
   * CLOSED to `false` (an unreadable body, or a non-password 400 such as the
   * invalid-email 400 which carries no `COMMA-` id, is treated as a non-password
   * fault → the generic enumeration-safe path) so we never mislabel an unknown
   * 400 as "weak password". The signal only ever *narrows* one specific 400 into
   * the enumeration-safe client error; it never widens a server fault.
   */
  private async isPasswordPolicyRejection(res: {
    json: () => Promise<unknown>;
  }): Promise<boolean> {
    try {
      const body = await res.json();
      const text = JSON.stringify(body);
      // Zitadel's password-complexity command errors share the `COMMA-` id
      // namespace — the stable, locale-independent signal.
      if (text.includes("COMMA-")) return true;
      const lower = text.toLowerCase();
      return lower.includes("password") || lower.includes("complexity");
    } catch {
      return false;
    }
  }

  async requestEmailVerification(sub: string): Promise<void> {
    // Live wire-shape delta (#148, vs Zitadel v4.15): the verification-code
    // **resend** is `POST /v2/users/{id}/email/resend` — the merged code's
    // `/email/_send_code` (the gRPC-transcoded custom-verb spelling assumed by
    // #86/#122) 404s against the live instance (proven on the dev-stand). The
    // request body is the Zitadel `SendEmailVerificationCode` oneof: `sendCode`
    // routes the code through the configured SMTP notifier (→ Mailpit on the
    // dev-stand), whereas `returnCode` echoes it in the HTTP response. We send
    // `{ sendCode: {} }` so the code is delivered by email (EARS-3, design §4),
    // matching the production notifier path — never returning the secret inline.
    const res = await this.fetchImpl(this.url(`/v2/users/${sub}/email/resend`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ sendCode: {} }),
    });
    // Surface a failed send instead of silently looking like success
    // (consistent with createUser); the caller decides the user-facing message.
    if (!res.ok) {
      throw new Error(`zitadel email send_code failed: HTTP ${res.status}`);
    }
  }

  async requestPhoneVerification(sub: string): Promise<void> {
    // Same #148 wire-shape delta as the email send, on the analogous phone hop:
    // `POST /v2/users/{id}/phone/resend` with the `{ sendCode: {} }` oneof (the
    // old `/phone/_send_code` is the same 404 bug class). `sendCode` routes the
    // code through the configured SMS notifier. Path-aligned by parity with the
    // email fix; the dev-stand has no SMS provider, so this hop is not live-
    // verified here (no Mailpit equivalent for SMS) — flagged on #148.
    const res = await this.fetchImpl(this.url(`/v2/users/${sub}/phone/resend`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ sendCode: {} }),
    });
    if (!res.ok) {
      throw new Error(`zitadel phone send_code failed: HTTP ${res.status}`);
    }
  }

  async verifyEmail(sub: string, code: string): Promise<boolean> {
    // Live wire-shape delta (#148, same bug class as the send): the verify hop
    // is `POST /v2/users/{id}/email/verify` — the merged `/email/_verify` also
    // 404s against Zitadel v4.15 (proven on the dev-stand). #148 is scoped to
    // the send, but the verify path is corrected in the same change because the
    // round-trip the live test asserts (send → fetch code from Mailpit → verify)
    // is otherwise unprovable; the identical custom-verb→REST-verb rename applies.
    const res = await this.fetchImpl(this.url(`/v2/users/${sub}/email/verify`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ verificationCode: code }),
    });
    return res.ok;
  }

  async verifyPhone(sub: string, code: string): Promise<boolean> {
    // #148 wire-shape delta on the phone verify hop, by parity with email:
    // `POST /v2/users/{id}/phone/verify` (the old `/phone/_verify` is the same
    // 404 bug class). Not live-verified (no SMS provider on the dev-stand).
    const res = await this.fetchImpl(this.url(`/v2/users/${sub}/phone/verify`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ verificationCode: code }),
    });
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
    if (!zitadelSessionId) return { outcome: "rejected" };
    // Live wire-shape delta (#145, vs Zitadel v4.15): the `POST /v2/sessions`
    // RESPONSE carries only `sessionId`/`sessionToken` — it does NOT echo the
    // `factors` object (that was assumed by the merged #86/#122 code). The
    // checked user's id (our `sub`) lives on the session resource, read via a
    // follow-up `GET /v2/sessions/{id}`. We prefer the POST body when present
    // (kept for the unit fake) and fall back to the GET for the real instance.
    let sub = data.factors?.user?.id;
    if (!sub) sub = await this.fetchSessionUserId(zitadelSessionId);
    if (!sub) return { outcome: "rejected" };
    // Cache the session token for the OIDC exchange (see `sessionTokens`).
    if (data.sessionToken)
      this.rememberSessionToken(zitadelSessionId, data.sessionToken);
    return { outcome: "authenticated", session: { zitadelSessionId, sub } };
  }

  /**
   * Read the checked user's id (`factors.user.id`) off an existing session via
   * `GET /v2/sessions/{id}` — needed because the `POST /v2/sessions` response
   * omits `factors` on the live Zitadel v4 (#145). Returns `null` on any non-2xx
   * so `passwordLogin` stays enumeration-safe (falls through to `rejected`).
   */
  private async fetchSessionUserId(
    zitadelSessionId: string,
  ): Promise<string | undefined> {
    const res = await this.fetchImpl(
      this.url(`/v2/sessions/${zitadelSessionId}`),
      { method: "GET", headers: this.headers() },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      session?: { factors?: { user?: { id?: string } } };
    };
    return data.session?.factors?.user?.id;
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
      // Live wire-shape delta (#145, vs Zitadel v4.15): the authorize 302
      // redirects to the login-UI page carrying `authRequestID` (capital `ID`,
      // e.g. `/ui/login/login?authRequestID=<id>`), not the lowercase
      // `authRequest` the merged #122 code parsed. Read both (the canonical live
      // `authRequestID` first, `authRequest` kept for back-compat / the fake).
      const locationParams = location
        ? new URLSearchParams(location.split("?")[1] ?? "")
        : null;
      const authRequestId =
        locationParams?.get("authRequestID") ??
        locationParams?.get("authRequest") ??
        null;
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
    // Send NO `scope` on the refresh grant. Per RFC 6749 §6 a refresh request
    // may only narrow to a subset of the originally-granted scopes; Zitadel v4.15
    // rejects the reserved project-roles URN scope here with `invalid_scope`
    // (proven live against the dev-stand — the authorize hop grants it, the
    // refresh hop refuses to re-request it). Omitting `scope` re-issues the full
    // originally-granted set, and the project-roles claim still rides the rotated
    // id_token via the app's role-assertion config (provision.sh sets
    // accessTokenRoleAssertion/idTokenRoleAssertion + projectRoleAssertion), so
    // `parseIdpClaims` still recovers `roles[]`. This is the EARS-9 wire-shape fix
    // on top of the merged #122 adapter (which sent the full scope and 400'd).
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
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
  ): Promise<IdpSession | null> {
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
    if (!res.ok) return null;
    // #221: auto-login after reset — create a CHECKED session for the subject by
    // running the same password check `passwordLogin` does, now with the
    // just-set password. `POST /v2/sessions` with a `user` + `password` check
    // returns `sessionId` + `sessionToken`; cache the token for the downstream
    // OIDC exchange (mirroring passwordLogin) and hand back the checked
    // {@link IdpSession}, so the BFF mints a fresh session via the shared
    // establishment hop. A failure here falls through to a fresh login rather than
    // a bare 500: we return null only if no session could be checked.
    const sessionRes = await this.fetchImpl(this.url("/v2/sessions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        checks: {
          user: { loginName: identifier },
          password: { password: newPassword },
        },
      }),
    });
    if (!sessionRes.ok) return null;
    const data = (await sessionRes.json()) as {
      sessionId?: string;
      sessionToken?: string;
      factors?: { user?: { id?: string } };
    };
    const zitadelSessionId = data.sessionId;
    if (!zitadelSessionId) return null;
    let sub = data.factors?.user?.id;
    if (!sub) sub = await this.fetchSessionUserId(zitadelSessionId);
    if (!sub) return null;
    if (data.sessionToken)
      this.rememberSessionToken(zitadelSessionId, data.sessionToken);
    return { zitadelSessionId, sub };
  }

  // ── Passwordless login OTP (EARS-6/7) — design §3, §6; live-wired #153 ──
  // Zitadel login OTP is Session v2: create a session with a `user` check and an
  // `otpEmail`/`otpSms` challenge (Zitadel sends the code through its notifier),
  // then update the same session with the submitted code, then exchange the
  // checked session for tokens (the shared `exchangeSessionForTokens` hop). The
  // challenge is bound to a server-side session carried between the request and
  // verify calls via the `otpChallenges` cache (mirroring `sessionTokens`).
  //
  // Wire-shape risk note (same class as #122 → corrected by #145/#148 live): the
  // exact Session-v2 field names/paths below are PINNED DETERMINISTICALLY BY THE
  // UNIT SPEC but AWAIT LIVE CONFIRMATION against the dev-stand — a follow-up may
  // adjust the precise shape (the accepted #122→#145/#148 precedent). Fail-closed
  // discipline holds throughout: request* never throws (enumeration-safe),
  // loginWith* returns null on any miss.

  /**
   * Ensure the user carries the email/SMS one-time-code factor the `otpEmail`/
   * `otpSms` session challenge requires. Live wire-shape delta (#153, vs Zitadel
   * v4.15): a `POST /v2/sessions` `otpEmail` challenge on a user who has only a
   * password rejects with `COMMAND-JKLJ3 "Multifactor OTP (OneTimePassword) isn't
   * ready"` — the challenge presupposes the factor is registered. Registering it
   * is `POST /v2/users/{id}/{otp_email|otp_sms}`; a 409 means it already exists,
   * which is the converged state we want (idempotent). Enumeration-safe by
   * inheritance: any non-2xx other than 409 is left for the create hop to handle
   * (it will then no-op), and the caller still resolves void.
   */
  private async ensureOtpFactor(
    userId: string,
    challenge: "otpEmail" | "otpSms",
  ): Promise<void> {
    const factor = challenge === "otpEmail" ? "otp_email" : "otp_sms";
    await this.fetchImpl(this.url(`/v2/users/${userId}/${factor}`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    // 2xx (just registered) and 409 (already present) are both the desired
    // converged state; any other status simply leaves the factor unregistered and
    // the following challenge create no-ops — still enumeration-safe.
  }

  /** The `otpEmail`/`otpSms` challenge oneof Zitadel's `POST /v2/sessions` accepts. */
  private async requestOtpChallenge(
    identifier: string,
    challenge: "otpEmail" | "otpSms",
  ): Promise<void> {
    // Enumeration-safe like `requestPasswordReset`: an unknown identifier (no
    // user) is a silent no-op, and ANY provider error still resolves void — the
    // caller's acknowledgement must never become an existence/health oracle
    // (EARS-6/7/16). A code is sent only if the user exists, but the caller can't
    // tell which.
    try {
      const userId = await this.resolveUserId(identifier);
      if (!userId) return;
      // The `otpEmail`/`otpSms` challenge requires the matching factor to be
      // registered on the user first (#153 live delta) — register it (idempotent).
      await this.ensureOtpFactor(userId, challenge);
      // Create-with-challenge. Asserted-by-unit-test / awaiting-live-confirmation:
      // `POST /v2/sessions` body `{ checks: { user: { userId } }, challenges: {
      // otpEmail: {} } }` (SMS: `{ otpSms: {} }`) — Zitadel arms the challenge and
      // dispatches the code via its notifier; the response carries `sessionId` +
      // `sessionToken` (the not-yet-checked session, same response shape as the
      // password-check create, #145).
      const res = await this.fetchImpl(this.url("/v2/sessions"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          checks: { user: { userId } },
          challenges: { [challenge]: {} },
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        sessionId?: string;
        sessionToken?: string;
      };
      if (!data.sessionId || !data.sessionToken) return;
      this.otpChallenges.set(identifier.toLowerCase(), {
        sessionId: data.sessionId,
        sessionToken: data.sessionToken,
        sub: userId,
      });
    } catch {
      // A thrown fetch (network hiccup) is indistinguishable from success to the
      // caller — swallow it, exactly like `requestPasswordReset`'s `.catch`.
      return;
    }
  }

  /**
   * Verify a login OTP against the cached challenge for `identifier` and, on
   * success, hand the now-checked session to the OIDC exchange. Returns the
   * checked {@link IdpSession} or `null` on any miss (no live challenge /
   * wrong-or-expired code), all indistinguishable (EARS-16).
   */
  private async loginWithOtpChallenge(
    identifier: string,
    code: string,
    check: "otpEmail" | "otpSms",
  ): Promise<IdpSession | null> {
    const key = identifier.toLowerCase();
    const challenge = this.otpChallenges.get(key);
    // No prior `request*Otp` for this identifier (or an unknown identifier, which
    // armed nothing) → null, indistinguishable from a wrong code (EARS-16).
    if (!challenge) return null;
    // Verify the code by updating the session: `PATCH /v2/sessions/{sessionId}`
    // body `{ sessionToken, checks: { otpEmail: { code } } }` (SMS: `{ otpSms: {
    // code } }`). Live wire-shape delta (#153, vs Zitadel v4.15): the session
    // *update* verb is PATCH, not POST — a POST to an existing session resource
    // returns `405 Method Not Allowed` (proven on the dev-stand), so a real OTP
    // code never verified. A non-2xx (wrong/expired code) resolves to null
    // (EARS-16); a 2xx returns a FRESH `sessionToken` proving the session passed
    // its OTP check.
    const res = await this.fetchImpl(this.url(`/v2/sessions/${challenge.sessionId}`), {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({
        sessionToken: challenge.sessionToken,
        checks: { [check]: { code } },
      }),
    });
    // Drop the challenge ONLY on a successful verify (single-use, mirroring the
    // fake's `loginWith*Otp`). On a failure we KEEP the cached challenge so the
    // user can retry the SAME already-delivered code against the SAME Zitadel
    // session: Zitadel natively owns the attempt-limit, lockout, and code expiry
    // (never reimplement an IdP primitive, EARS-15), so dropping our cache after
    // one wrong digit would re-implement an attempt-limit the IdP already enforces.
    // It would also force a brand-new `requestSmsOtp` per typo, burning a paid SMS
    // send and the EARS-14 toll-fraud budget on every mistake; keeping the
    // challenge lets the retry reuse the already-sent code for free.
    if (!res.ok) return null;
    this.otpChallenges.delete(key);
    const data = (await res.json()) as { sessionToken?: string };
    // Feed the OIDC exchange: cache the CHECKED-session token under the sessionId
    // so the downstream `exchangeSessionForTokens(sessionId)` finds it (mirrors
    // how `passwordLogin` captures `sessionToken`). Prefer the fresh token from
    // the verify response; fall back to the challenge token if the live response
    // omits it (awaiting-live-confirmation — the update may not re-issue a token).
    this.rememberSessionToken(
      challenge.sessionId,
      data.sessionToken ?? challenge.sessionToken,
    );
    return { zitadelSessionId: challenge.sessionId, sub: challenge.sub };
  }

  async requestEmailOtp(identifier: string): Promise<void> {
    await this.requestOtpChallenge(identifier, "otpEmail");
  }

  loginWithEmailOtp(
    identifier: string,
    code: string,
  ): Promise<IdpSession | null> {
    return this.loginWithOtpChallenge(identifier, code, "otpEmail");
  }

  async requestSmsOtp(identifier: string): Promise<void> {
    // The EARS-14 SMS toll-fraud budget is gated by the CALLER before this hop —
    // a refused send never reaches here, so this method always attempts the
    // native send (no budget logic here, by contract).
    await this.requestOtpChallenge(identifier, "otpSms");
  }

  loginWithSmsOtp(
    identifier: string,
    code: string,
  ): Promise<IdpSession | null> {
    return this.loginWithOtpChallenge(identifier, code, "otpSms");
  }

  /**
   * #157/#203: authorize `sub` for the project role `roleKey` via the CURRENT
   * resource API — the v2 **AuthorizationService.CreateAuthorization** (Zitadel's
   * "Role Assignment", which REPLACES the deprecated management-v1 user-grant
   * `POST /management/v1/users/{sub}/grants`). The deprecated v1 RPC and its whole
   * management-v1 user surface are marked `deprecated = true` in the v4.15 proto;
   * the GA v2 replacement is live and functional on the dev-stand (proven #203:
   * a CreateAuthorization for a fresh user returns `{ id, creationDate }` HTTP 200,
   * and the subsequent v1 grant then 409s "already exists" — confirming the v2
   * call genuinely created the assignment).
   *
   * Wire note (#203): in v4.15.0 the GA AuthorizationService is reachable via its
   * connect/gRPC-transcoded URL `POST
   * /zitadel.authorization.v2.AuthorizationService/CreateAuthorization` — the
   * clean `/v2/authorizations` REST alias is NOT yet served by this version's
   * gateway (it 404s, proven live). We call the GA RPC path it actually serves; a
   * later Zitadel may add the REST alias, at which point this URL can be swapped
   * with no body/semantics change. The body is `{ userId, projectId,
   * organizationId, roleKeys: [roleKey] }` — note the v2 RPC requires
   * `organizationId` (resolved via {@link resolveOrgId}), which the v1 grant
   * inferred from the token.
   *
   * This is the authz source of truth the guard reads: Zitadel asserts
   * `urn:zitadel:iam:org:project:roles` in the OIDC token ONLY for roles the
   * subject was granted here (ADR-0001 — the `users.role` mirror is a downstream
   * projection, not an authz authority). Without this grant the token's roles
   * claim is empty and the `doctor_guest`-requiring `AuthzGuard` 403s.
   *
   * **Idempotent:** Zitadel returns 409 / `ALREADY_EXISTS` ("User grant already
   * exists") when the assignment is present — treated as SUCCESS so the webhook
   * (EARS-19) and the reconcile sweep can re-grant on every pass without error.
   * Any OTHER non-2xx is a real failure → throw (a transient fault is loud; the
   * webhook + sweep are idempotent backstops that re-grant). Absent `projectId`
   * fails closed, consistent with the other OIDC-config-gated paths.
   */
  async grantProjectRole(sub: string, roleKey: string): Promise<void> {
    if (!this.config.projectId) {
      throw new Error(
        "zitadel project config (IDP_PROJECT_ID) is not set; cannot grant the project role (design §3/§5, #157)",
      );
    }
    const orgId = await this.resolveOrgId();
    const res = await this.fetchImpl(
      this.url(
        "/zitadel.authorization.v2.AuthorizationService/CreateAuthorization",
      ),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          userId: sub,
          projectId: this.config.projectId,
          organizationId: orgId,
          roleKeys: [roleKey],
        }),
      },
    );
    // Idempotency: an already-existing assignment is the converged state, not a
    // failure — Zitadel signals it with 409 (ALREADY_EXISTS). Resolve.
    if (res.ok || res.status === 409) return;
    throw new Error(
      `zitadel grant project role failed: HTTP ${res.status}`,
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
