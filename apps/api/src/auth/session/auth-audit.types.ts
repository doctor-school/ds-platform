/**
 * Auth-audit port + the EARS-18 event taxonomy.
 *
 * F4 introduced this as a narrow port with an in-memory default; F6 (#90) makes
 * it the EARS-18 audit-ledger seam: the full event vocabulary, the canonical
 * `<class>.<event>` wire-id reconciliation (one place — {@link toLedgerRow}),
 * and the durable `audit_ledger` writer ({@link DrizzleAuthAuditLog}). The
 * in-memory {@link InMemoryAuthAuditLog} stays the unit-test double.
 *
 * Discipline (003 invariant): every state-changing auth command emits **exactly
 * one** terminal event here, and the writer masks PD (no raw identifier — only a
 * hash) before it touches the ledger (ADR-0001 §7, ADR-0003 §6).
 */

/** A masked OTP / verification channel, carried into the ledger metadata. */
export type AuthChannel = "email" | "sms";

/** The login method, recorded on a login success (ADR-0001 §7.3 `method`). */
export type LoginMethod = "password" | "email-otp" | "sms-otp";

/** Why a login failed — the `auth.login.failure` reason (ADR-0001 §7.3). Audit-only; never surfaced (EARS-16). */
export type LoginFailureReason =
  | "wrong_password"
  | "no_user"
  | "lock"
  | "captcha_failed";

/**
 * The auth-event taxonomy (EARS-18). The `type` is the internal (spec/EARS)
 * name; its canonical `auth.<class>.<event>` wire id — owned by
 * identity-auth-rbac-design §7.3 / ADR-0001 §7.3 — is assigned in exactly one
 * place, {@link toLedgerRow}. Events keyed by an `identifier` carry the **raw**
 * identifier here (the writer masks it to an `identifier_hash`); events keyed by
 * a `sub` carry the opaque Zitadel subject (not PD).
 */
export type AuthAuditEvent =
  // Registration (EARS-1/2/20). Consent versions ride in the metadata rather
  // than a separate `consent.captured` row — the one-terminal-entry invariant
  // (the standalone consent event belongs to the ADR-0009 subsystem, not 003).
  | {
      type: "Registered";
      sub: string;
      channel: AuthChannel;
      consent: { purpose: string; version: string }[];
    }
  // Login (EARS-5/6/7). Success carries the subject + method; failure carries
  // the (to-be-masked) identifier + reason — the enumeration/oracle detail that
  // lives only here (EARS-16).
  | { type: "LoginSucceeded"; sub: string; method: LoginMethod }
  | { type: "LoginFailed"; identifier: string; reason: LoginFailureReason }
  // EARS-6/7 OTP send (email or SMS). Identifier masked.
  | { type: "OtpSent"; identifier: string; channel: AuthChannel }
  // EARS-9 rotation happy path (F4 deferred this to F6's terminal audit).
  | { type: "RefreshRotated"; sub: string; sid: string }
  // EARS-9 reuse / EARS-10 logout (F4 seam — wire ids reconciled here now).
  | { type: "RefreshReuseDetected"; sub: string; sid: string }
  | { type: "SessionRevoked"; sub: string; sid: string }
  // EARS-11 reset initiate (identifier masked; no subject — pre-identity).
  | { type: "PasswordResetRequested"; identifier: string }
  // EARS-12 reset complete (user-level; spans every session of the subject).
  | { type: "PasswordResetCompleted"; sub: string }
  // EARS-15 native-lockout observation. Subject-level; the BFF records it when
  // the IdP reports the account soft-locked (the counter itself is Zitadel's).
  | { type: "AccountLocked"; sub: string };

/**
 * The runtime-enumerable taxonomy of event `type` discriminants — the same set
 * carried by {@link AuthAuditEvent}, in a form the emission-completeness guard
 * (`test/authz/audit-emission-coverage.e2e-spec.ts`) can iterate (a TS union is
 * erased at runtime). The two `satisfies`/assignment checks below keep this array
 * and the union in lockstep: adding a variant to one without the other is a
 * compile error.
 */
export const AUTH_AUDIT_EVENT_TYPES = [
  "Registered",
  "LoginSucceeded",
  "LoginFailed",
  "OtpSent",
  "RefreshRotated",
  "RefreshReuseDetected",
  "SessionRevoked",
  "PasswordResetRequested",
  "PasswordResetCompleted",
  "AccountLocked",
] as const satisfies readonly AuthAuditEvent["type"][];

export type AuthAuditEventType = (typeof AUTH_AUDIT_EVENT_TYPES)[number];

// Bidirectional exhaustiveness: if a new AuthAuditEvent variant is added without
// extending AUTH_AUDIT_EVENT_TYPES (or vice versa), one of these assignments
// fails to type-check — so the runtime list can never silently drift from the
// union the writer maps.
const _eventTypeExhaustive: AuthAuditEventType =
  null as unknown as AuthAuditEvent["type"];
void _eventTypeExhaustive;

export interface AuthAuditLog {
  /** Append one auth event (append-only; never updated or deleted). */
  record(event: AuthAuditEvent): Promise<void>;
}

/** DI token the {@link AuthAuditLog} port is bound to (durable Drizzle writer with DB; in-memory fake otherwise). */
export const AUTH_AUDIT = Symbol("AUTH_AUDIT");
