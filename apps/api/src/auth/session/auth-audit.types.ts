/**
 * Auth security-event sink (the F4 slice of the EARS-18 audit ledger).
 *
 * F4 must record two session-security events — refresh-token reuse detection
 * (EARS-9) and session revocation on logout (EARS-10). The full `audit_ledger`
 * writer + per-request terminal-audit interceptor (EARS-18) is **F6 (#90)**, so
 * F4 introduces this as a narrow port with an in-memory default binding (mirrors
 * the {@link IdpClient} / {@link SessionStore} fake-vs-real split). F6 binds the
 * durable writer to {@link AUTH_AUDIT} without touching these call sites.
 *
 * The event `type`s are the spec/EARS names (`RefreshReuseDetected`,
 * `SessionRevoked`). Their canonical `<class>.<event>` wire ids — owned by
 * `identity-auth-rbac-design §7.3` / ADR-0001 §7.3 — are `auth.token.theft_detected`
 * and `auth.session.terminated` (reason `logout`); reconciling the name → wire-id
 * mapping is F6's job (recorded as decision-debt for this iteration).
 */
export type AuthAuditEvent =
  | { type: "RefreshReuseDetected"; sub: string; sid: string }
  | { type: "SessionRevoked"; sub: string; sid: string }
  // EARS-12: a completed password reset. User-level (no `sid`) — it spans every
  // session of the subject, all of which are revoked as part of the same step.
  // Canonical wire id `auth.password.reset.completed` (EARS-18 taxonomy);
  // name → wire-id reconciliation stays F6's job (decision-debt, as for F4).
  | { type: "PasswordResetCompleted"; sub: string };

export interface AuthAuditLog {
  /** Append one auth security event (append-only; never updated or deleted). */
  record(event: AuthAuditEvent): Promise<void>;
}

/** DI token the {@link AuthAuditLog} port is bound to (in-memory now, durable in F6). */
export const AUTH_AUDIT = Symbol("AUTH_AUDIT");
