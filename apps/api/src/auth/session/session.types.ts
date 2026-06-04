/**
 * Server-side BFF session store (design §3 — the `ActiveSession` read model).
 *
 * The browser holds only the `__Host-` cookie carrying the `sid`; everything
 * else — the Zitadel session id, the OIDC tokens, the device fingerprint — is
 * held server-side keyed by that `sid`, so a token never reaches client
 * JavaScript (EARS-8). Like the {@link IdpClient} port, the store is an interface
 * with an in-memory fake (default / test binding) and a Redis adapter (the
 * production binding, ADR-0001 §6) bound only when `REDIS_URL` is configured —
 * so the suite runs without a live Redis, mirroring the IdP fake/real split.
 *
 * Refresh **rotation** (single-use, reuse-detection) is EARS-9 / F4; F2 only
 * needs create + read, but the record already carries the refresh token so F4
 * extends the store, not the record shape.
 */
export interface SessionRecord {
  /** BFF session id — the opaque value carried in the `__Host-` cookie. */
  sid: string;
  /** The Zitadel session this BFF session wraps (design §3). */
  zitadelSessionId: string;
  /** Principal subject (Zitadel `sub`). */
  sub: string;
  /** Roles asserted by the IdP (v1: `["doctor_guest"]`). */
  roles: string[];
  /** MFA claim — present even when no `doctor_guest` flow requires it (seam). */
  mfa: boolean;
  /** Access JWT, held server-side; never sent to the browser (EARS-8). */
  accessToken: string;
  /** Opaque rotating refresh token, held server-side (EARS-8/9). */
  refreshToken: string;
  /** `hash(UA + IP/24 + accept-language)` bound at login (design §3). */
  fingerprint: string;
  /** Epoch ms at which the session expires (drives the store TTL). */
  expiresAtMs: number;
}

export interface SessionStore {
  /** Persist a new session, expiring it at `record.expiresAtMs`. */
  create(record: SessionRecord): Promise<void>;
  /** Look a session up by `sid`; `undefined` if absent or expired. */
  get(sid: string): Promise<SessionRecord | undefined>;
  /**
   * EARS-9: replace the stored tokens after a single-use refresh rotation,
   * keeping the `sid`, principal, fingerprint, and expiry. No-op if the session
   * is absent. The session lifetime is unchanged — rotation refreshes the
   * access/refresh pair *within* the session, not the session's TTL.
   */
  rotate(sid: string, accessToken: string, refreshToken: string): Promise<void>;
  /**
   * EARS-9/10: delete the session, which invalidates its refresh chain (the
   * tokens live only inside the record). The force-logout / chain-revoke
   * primitive (ADR-0001 §6). Idempotent — deleting an absent `sid` is a no-op.
   */
  delete(sid: string): Promise<void>;
}

/** DI token the {@link SessionStore} port is bound to (fake or Redis adapter). */
export const SESSION_STORE = Symbol("SESSION_STORE");
