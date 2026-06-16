/**
 * IdP port (design §1, §2 — the native-vs-custom boundary).
 *
 * Every credential operation — user creation, OTP send/verify, password — is
 * **native Zitadel**, consumed through this interface and never reimplemented in
 * `apps/api` (Constraints; ADR-0001 §8). The BFF depends on this port, not on a
 * concrete Zitadel SDK, so (a) the domain logic (registration cascade, mirror
 * sync, verification) is unit-testable against an in-memory fake with a real
 * Postgres, and (b) a Zitadel API/version change is absorbed in one adapter.
 *
 * F1 (#85) needs the create + verify + list surface below; later iterations
 * (F2 session, F3 OTP login, F5 reset) extend the same port.
 */

/**
 * The IdP rejected the supplied password as too weak for its configured policy
 * (#147). The {@link IdpClient.createUser} contract maps a duplicate identifier
 * to `alreadyExisted` and treats every other failure as an opaque throw — but a
 * password-policy rejection is special: it is the residual race where the BFF
 * creation schema (which mirrors the deployed Zitadel default policy as a
 * baseline) passed, yet the *live* Zitadel is configured stricter than that
 * baseline and 400s inside `createUser`. The service catches THIS type and maps
 * it to a generic, non-enumerating "weak password" client error (422) — never a
 * 500, and identical regardless of whether the account exists. Zitadel v4.15
 * validates password complexity BEFORE the duplicate/uniqueness check (verified
 * live against the dev-stand: a second `createUser` on an existing email with a
 * policy-violating password returns 400 "Password must contain upper case", NOT
 * 409), so `existing+weak` and `new+weak` both 400 → this throw → the same 422,
 * and a *valid* duplicate is the 409 → `alreadyExisted` path that never reaches
 * here. No branch correlates with existence (no oracle). Any OTHER non-2xx from
 * `createUser` stays an opaque `Error` (a real server fault → 500), so this type
 * is the only password-correlated signal that crosses the port.
 */
export class IdpPasswordPolicyError extends Error {
  constructor(message = "password rejected by IdP policy") {
    super(message);
    this.name = "IdpPasswordPolicyError";
  }
}

/**
 * The IdP **deterministically** rejected the create request as
 * `invalid_argument` (#202) — a malformed / unacceptable request the IdP refuses
 * BEFORE creating anything, for any caller, every time (not an infra fault and
 * not existence-correlated). The canonical case is a create with no email:
 * Zitadel hard-requires an email on human-user creation (invariant across
 * `AddHumanUser` v1/v2 and `CreateUser` `/v2/users/new`), so a phone-only create
 * 400s `invalid AddHumanUserRequest.Email: value is required`. The service maps
 * this to the generic, enumeration-safe failure (a 4xx, NOT a 500 and NOT an
 * existence oracle, EARS-16) — the same taxonomy precedent as
 * {@link IdpPasswordPolicyError}. A duplicate identifier is NOT this error (it is
 * the 409 → `alreadyExisted` hinge); a password-policy 400 is NOT this error (it
 * is the more-specific {@link IdpPasswordPolicyError} → 422). This is the
 * residual "deterministic 4xx that is neither" so it can never surface as a 500.
 */
export class IdpInvalidArgumentError extends Error {
  constructor(message = "IdP rejected the request (invalid argument)") {
    super(message);
    this.name = "IdpInvalidArgumentError";
  }
}

/**
 * The IdP could not be reached or returned a genuine **infra fault** (5xx /
 * network) (#202) — transient and not the caller's fault. The service maps this
 * to a 503 "service temporarily unavailable" (the project's actionable-errors
 * rule: 5xx/net → "unavailable"), distinct from a deterministic 4xx
 * ({@link IdpInvalidArgumentError} → generic 4xx) so a real outage is reported
 * honestly rather than masqueraded as a client error — while still never a bare,
 * unhandled 500.
 */
export class IdpUnavailableError extends Error {
  constructor(message = "IdP is temporarily unavailable") {
    super(message);
    this.name = "IdpUnavailableError";
  }
}

/** Input to create a Zitadel user with a single primary identifier. */
export interface CreateUserInput {
  email?: string | undefined;
  phone?: string | undefined;
  /** The BFF forwards this to Zitadel; it never stores or hashes it (design §2). */
  password: string;
}

/**
 * Result of a create attempt. `alreadyExisted` is the enumeration-safety hinge
 * (EARS-1/16): a duplicate identifier resolves here, not to an error the caller
 * could turn into a distinguishable response. On the duplicate path `sub` may be
 * empty — the caller does not create a mirror row or send a code, it only needs
 * to know it must respond identically to the success path.
 */
export interface CreatedUser {
  sub: string;
  alreadyExisted: boolean;
}

/** A Zitadel user as seen by the reconciliation sweep (EARS-19). */
export interface IdpUser {
  sub: string;
  email?: string | undefined;
  phone?: string | undefined;
  emailVerified: boolean;
  phoneVerified: boolean;
}

/**
 * A Zitadel session that has passed its required check (design §3, EARS-5/8).
 * `passwordLogin` returns one on a successful password check; the BFF then trades
 * it for tokens via {@link IdpClient.exchangeSessionForTokens}.
 */
export interface IdpSession {
  /** Opaque Zitadel session id, bound to the BFF session record (design §3). */
  zitadelSessionId: string;
  sub: string;
}

/**
 * Outcome of a password check (EARS-5/15/18). The BFF stays enumeration-safe by
 * collapsing every non-success to the same generic 401 (EARS-16) at the
 * controller, but the IdP's verdict is richer than a bare `null` so the audit
 * ledger can record the real reason (EARS-18) and the native lockout can be
 * observed (EARS-15):
 * - `authenticated` — checked session to trade for tokens.
 * - `rejected` — unknown identifier or wrong password (indistinguishable).
 * - `locked` — the native Zitadel lockout policy has soft-locked the account
 *   (EARS-15); `justLocked` is true only on the attempt that tripped it, so the
 *   BFF emits `auth.lockout.triggered` exactly once. The counter, the lock, and
 *   the notification email are all native Zitadel (Constraints); the BFF only
 *   *observes* the verdict here — it never counts failures itself.
 */
export type PasswordLoginResult =
  | { outcome: "authenticated"; session: IdpSession }
  | { outcome: "rejected" }
  | { outcome: "locked"; sub: string; justLocked: boolean };

/**
 * The principal claims Zitadel asserts for the authenticated subject. These are
 * the identity claims the BFF mirrors into its session record and surfaces via
 * the session-read route; the full signed JWT (adding `sid, iat, exp, jti`) is
 * Zitadel's — `apps/api` signs nothing (Constraints, design §2).
 */
export interface IdpClaims {
  sub: string;
  roles: string[];
  mfa: boolean;
}

/**
 * Result of the OIDC exchange (design §3, EARS-8): the short-lived access JWT,
 * the opaque rotating refresh token (stored server-side, never sent to the
 * browser), the access-token lifetime, and the parsed principal claims.
 */
export interface IdpTokens {
  accessToken: string;
  refreshToken: string;
  /**
   * The **access-token** lifetime (≈15 min, ADR-0001 §6) — NOT the session/cookie
   * lifetime. The web session lives as long as the refresh token (30 d), so the
   * cookie `Max-Age` and the store TTL are driven by that, not by this value
   * (which F4/EARS-9 uses to decide when to rotate). Do not wire it to the cookie.
   */
  expiresInSeconds: number;
  claims: IdpClaims;
}

/**
 * Result of a refresh exchange (design §3, EARS-9). The refresh token is
 * single-use: a successful exchange yields fresh token material; presenting an
 * already-consumed token is RFC-6819 **reuse**, which the IdP detects (ADR-0001
 * §7 — "refresh token theft detection", owner = IdP) and the BFF answers by
 * invalidating the chain + revoking the session.
 */
export type IdpRefreshResult =
  | { reuseDetected: false; tokens: IdpTokens }
  | { reuseDetected: true };

export interface IdpClient {
  /** Create a user; a duplicate identifier returns `alreadyExisted: true`, not a throw. */
  createUser(input: CreateUserInput): Promise<CreatedUser>;
  /** Trigger a Zitadel `otp_email` verification code (EARS-1). */
  requestEmailVerification(sub: string): Promise<void>;
  /** Trigger a Zitadel `otp_sms` verification code (EARS-2). */
  requestPhoneVerification(sub: string): Promise<void>;
  /** Verify an email OTP code via Zitadel `otp_email` (EARS-3); `false` = invalid/expired. */
  verifyEmail(sub: string, code: string): Promise<boolean>;
  /** Verify an SMS OTP code via Zitadel `otp_sms` (EARS-4); `false` = invalid/expired. */
  verifyPhone(sub: string, code: string): Promise<boolean>;
  /** Enumerate users for the reconciliation sweep (EARS-19). */
  listUsers(): Promise<IdpUser[]>;
  /**
   * EARS-6: trigger a Zitadel `otp_email` **login** code for `identifier`.
   * Resolves identically whether or not the identifier exists — a code is sent
   * only if it does, but the result never reveals which (enumeration-safe,
   * EARS-16). Resolves rather than throws on an unknown identifier or a provider
   * hiccup, so the caller's acknowledgement cannot become an existence oracle.
   */
  requestEmailOtp(identifier: string): Promise<void>;
  /**
   * EARS-6: verify an email login OTP and, on success, return the **checked**
   * Zitadel session — the same `IdpSession` shape `passwordLogin` yields, so the
   * BFF trades it for tokens via {@link exchangeSessionForTokens} and every login
   * variant converges on one session-establishment step (design §6). Resolves to
   * `null` on any failure (unknown identifier / wrong-or-expired code), which are
   * indistinguishable so the caller stays enumeration-safe (EARS-16).
   */
  loginWithEmailOtp(identifier: string, code: string): Promise<IdpSession | null>;
  /**
   * EARS-7: trigger a Zitadel `otp_sms` **login** code. Same enumeration-safe
   * contract as {@link requestEmailOtp}. The SMS toll-fraud budget (EARS-14) is
   * the caller's gate **before** this method — a refused send never reaches here,
   * so this method always attempts the (native) send.
   */
  requestSmsOtp(identifier: string): Promise<void>;
  /**
   * EARS-7: verify an SMS login OTP → checked {@link IdpSession} or `null`. Same
   * contract as {@link loginWithEmailOtp} (design §6 convergence; EARS-16).
   */
  loginWithSmsOtp(identifier: string, code: string): Promise<IdpSession | null>;
  /**
   * EARS-5: create a Zitadel session with a password check for `identifier`
   * (email or phone). Resolves to a {@link PasswordLoginResult} — `authenticated`
   * on success, or `rejected` / `locked` on failure (the two failure variants are
   * indistinguishable to the *client* per EARS-16, but the BFF uses the verdict
   * for the audit ledger and the EARS-15 lockout observation). A failed check is
   * counted by the native Zitadel lockout policy (EARS-15), never by the BFF.
   */
  passwordLogin(identifier: string, password: string): Promise<PasswordLoginResult>;
  /**
   * EARS-8: complete the OIDC exchange against a checked session, yielding the
   * access JWT, the rotating opaque refresh token, and the principal claims.
   */
  exchangeSessionForTokens(zitadelSessionId: string): Promise<IdpTokens>;
  /**
   * EARS-9: rotate a single-use refresh token. On success the old token is
   * consumed and fresh access + refresh tokens are returned; a replay of an
   * already-consumed token resolves to `{ reuseDetected: true }` (RFC 6819,
   * ADR-0001 §7) — the BFF then invalidates the chain and revokes the session.
   */
  refreshTokens(refreshToken: string): Promise<IdpRefreshResult>;
  /**
   * EARS-11: trigger Zitadel's forgot-password code flow for `identifier` (email
   * or phone). Resolves **identically regardless of whether the identifier
   * exists** — a code is sent only if it does, but the result never reveals which
   * (enumeration-safe, EARS-16). Resolves rather than throws even on an unknown
   * identifier or a provider hiccup, so the caller's response cannot become a
   * distinguishable oracle.
   */
  requestPasswordReset(identifier: string): Promise<void>;
  /**
   * EARS-12: set a new password using a reset code and, on success, return a
   * **checked** Zitadel session — the same {@link IdpSession} shape `passwordLogin`
   * yields — so the BFF can revoke that user's prior sessions, emit the audit
   * event, AND mint a fresh authenticated session (auto-login, #221) by trading it
   * for tokens via {@link exchangeSessionForTokens}, exactly as login does
   * (design §6 convergence). Resolves to `null` on an invalid/expired code or
   * unknown identifier — the two are indistinguishable so the caller answers with
   * the same generic failure (EARS-16). The IdP is the only party that sets the
   * password (design §2).
   */
  completePasswordReset(
    identifier: string,
    code: string,
    newPassword: string,
  ): Promise<IdpSession | null>;
  /**
   * #157: authorize `sub` for the Zitadel **project role** `roleKey` (the v1
   * authenticated baseline is `doctor_guest`, {@link DOCTOR_GUEST_ROLE}). This is
   * the authz source of truth the guard reads: the OIDC token's
   * `urn:zitadel:iam:org:project:roles` claim is asserted ONLY for roles actually
   * granted in Zitadel (ADR-0001 — Zitadel is the identity/authz authority; the
   * `users.role` column is a downstream **mirror** projection, NOT an authz
   * authority). Granting nothing here leaves the token's roles claim empty → the
   * `AuthzGuard` (which requires `doctor_guest`) denies with 403.
   *
   * **Idempotent:** granting an already-granted role resolves (never throws) — the
   * webhook (EARS-19) and the reconcile sweep re-grant on every pass, so the call
   * must converge, not duplicate or fail. Any *other* failure (transient infra,
   * missing project config) is a real fault and throws, so it surfaces loudly
   * rather than silently leaving a registered user un-authorized.
   */
  grantProjectRole(sub: string, roleKey: string): Promise<void>;
}

/**
 * #157: the v1 authenticated-baseline project role (ADR-0001 §1; matches
 * `authz.types.ts` ROLES and the `provision.sh` `SEED_ROLE`). The single literal
 * the three write paths (register / webhook / reconcile sweep) grant, so the
 * role key is never scattered as a bare string.
 */
export const DOCTOR_GUEST_ROLE = "doctor_guest";

/** DI token the port is bound to — rebound to the real Zitadel adapter in prod. */
export const IDP_CLIENT = Symbol("IDP_CLIENT");
