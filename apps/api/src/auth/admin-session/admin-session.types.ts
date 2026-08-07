/**
 * 011 admin-tier record shapes + store ports (design §8 — EARS-1, EARS-3, EARS-10).
 *
 * **Two record kinds, not one flag.** A pending authentication and an established
 * admin session are structurally distinct types held in distinct key namespaces
 * behind distinct ports, so "the session hook accidentally accepts a pending
 * reference" is a shape error rather than a boolean someone forgets to check
 * (011 Constraints: _the pending-auth state is not a session_).
 *
 * Both live server-side in Redis (the production binding) with an in-memory fake
 * for the suite, exactly as the 003 {@link SessionStore} does — 011 introduces no
 * new credential store and no new session model (EARS-10).
 */

/** The next step a pending authentication requires (EARS-3). */
export type AdminNextStep =
  "mfa_enrollment_required" | "mfa_challenge_required";

/**
 * A **pending authentication** (EARS-3): primary auth succeeded and the
 * `role → mfa_required` policy hit, so no session was issued. Short-lived,
 * single-purpose, server-side; the reference travels in
 * `__Host-ds_admin_pending` and reaches nothing except the (not-yet-built)
 * enrollment/challenge endpoints.
 *
 * It carries the checked Zitadel session handle because the admin session is
 * **upgraded in place** from this record once the factor is satisfied (LD-1,
 * design §4) — the proof-of-check must survive the pending window, which is why
 * that window is minutes rather than hours. Nothing here is ever surfaced.
 */
export interface PendingAuthRecord {
  /** Opaque pending reference — the value carried in `__Host-ds_admin_pending`. */
  ref: string;
  /** IdP subject that completed primary auth. */
  sub: string;
  /** Roles asserted by the IdP; the policy verdict was computed from these. */
  roles: string[];
  /** Which second-factor step this principal owes (EARS-3). */
  nextStep: AdminNextStep;
  /** The Zitadel session this pending auth wraps (upgraded in place — LD-1). */
  zitadelSessionId: string;
  /** Single-use proof-of-check for the OIDC exchange the upgrade performs. */
  sessionToken: string;
  /** `hash(UA + IP/24 + accept-language)` bound at primary auth (design §3). */
  fingerprint: string;
  /** Epoch ms at which the pending reference expires (minutes, not hours). */
  expiresAtMs: number;
}

/**
 * An **established admin session** (EARS-1, EARS-10). Conforms to the ADR-0001
 * §6 / design §7.1 profile: server-side in Redis, fingerprint-bound, TTL'd,
 * force-logout revocable. `mfa` is `true` by construction — no code path writes
 * this record without a satisfied factor, so the field is an invariant the guard
 * re-asserts defensively rather than a state to branch on (design §8).
 */
export interface AdminSessionRecord {
  /** Opaque admin session id — the value carried in `__Host-ds_admin_session`. */
  sid: string;
  /** The Zitadel session this admin session wraps. */
  zitadelSessionId: string;
  sub: string;
  /** Roles asserted by the IdP (includes `platform_admin`). */
  roles: string[];
  /** ALWAYS `true` — the EARS-1/3 invariant (design §8). */
  mfa: true;
  /** Access JWT, held server-side; never sent to the browser. */
  accessToken: string;
  /** Opaque rotating refresh token, held server-side. */
  refreshToken: string;
  /** `hash(UA + IP/24 + accept-language)`, re-checked on every request (EARS-10). */
  fingerprint: string;
  /** EARS-10 CSRF double-submit token; matched against the request header. */
  csrfToken: string;
  /** Epoch ms at which the session expires (drives the store TTL). */
  expiresAtMs: number;
}

/** Server-side store for {@link PendingAuthRecord}s — its own key namespace (design §3). */
export interface PendingAuthStore {
  create(record: PendingAuthRecord): Promise<void>;
  get(ref: string): Promise<PendingAuthRecord | undefined>;
  /** Consumed on upgrade to a session, or on an explicit abandon. Idempotent. */
  delete(ref: string): Promise<void>;
}

/** Server-side store for {@link AdminSessionRecord}s (EARS-10). */
export interface AdminSessionStore {
  create(record: AdminSessionRecord): Promise<void>;
  get(sid: string): Promise<AdminSessionRecord | undefined>;
  /** Replace the stored token pair after a rotation, keeping sid/principal/TTL. */
  rotate(sid: string, accessToken: string, refreshToken: string): Promise<void>;
  /** Revoke one admin session (logout). Idempotent. */
  delete(sid: string): Promise<void>;
  /**
   * EARS-10 force-logout: revoke **every** admin session of `sub`. Idempotent.
   * Resolves the `sid`s actually revoked, so the caller can append one terminal
   * `auth.session.terminated` row per revoked session rather than one vague row
   * for the batch (EARS-9's one-row-per-lifecycle-event discipline).
   */
  deleteBySub(sub: string): Promise<string[]>;
}

/** DI token the {@link AdminSessionStore} port is bound to (fake or Redis adapter). */
export const ADMIN_SESSION_STORE = Symbol("ADMIN_SESSION_STORE");

/** DI token the {@link PendingAuthStore} port is bound to (fake or Redis adapter). */
export const PENDING_AUTH_STORE = Symbol("PENDING_AUTH_STORE");
