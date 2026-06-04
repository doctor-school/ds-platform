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
   * (email or phone). Resolves to the session on success and to `null` on any
   * failure — unknown identifier and wrong password are indistinguishable so the
   * caller stays enumeration-safe (EARS-16); a failed check is counted by the
   * native Zitadel lockout policy (EARS-15), not by the BFF.
   */
  passwordLogin(identifier: string, password: string): Promise<IdpSession | null>;
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
   * EARS-12: set a new password using a reset code. Resolves to the subject on
   * success (so the BFF can revoke that user's sessions and emit the audit event)
   * and to `null` on an invalid/expired code or unknown identifier — the two are
   * indistinguishable so the caller answers with the same generic failure
   * (EARS-16). The IdP is the only party that sets the password (design §2).
   */
  completePasswordReset(
    identifier: string,
    code: string,
    newPassword: string,
  ): Promise<{ sub: string } | null>;
}

/** DI token the port is bound to — rebound to the real Zitadel adapter in prod. */
export const IDP_CLIENT = Symbol("IDP_CLIENT");
