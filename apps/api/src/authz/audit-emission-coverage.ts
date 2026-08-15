/**
 * Audit-emission coverage registry (Layer 1 companion to `authz.types.ts`).
 *
 * Auth/security audit is **explicit emission by design**: every state-changing
 * auth command appends its terminal `auth_audit` row at the command site (the
 * `AuthAuditLog` port), NOT via an `@Authz`-driven interceptor (ADR-0002 §4.8;
 * `authz/README.md`). The risk that design carries is that a *new*
 * state-changing command silently forgets to emit — `audit-ledger.e2e-spec.ts`
 * asserts the one-terminal-row invariant per event, but cannot fail for a row
 * that was never wired.
 *
 * This registry closes that gap. `@Authz({ audit: "high-stakes" })` is the SSOT
 * for "this route is a state-changing/security command whose audit posture is
 * accounted for"; every such route MUST appear here, declaring one of three
 * accountings:
 *
 *   - `emits` — the `AuthAuditEvent` type(s) the command site appends, plus the
 *     covering e2e `it`. A bare `emits: []` is rejected: a covered route that
 *     names no event is an empty claim, not an accounting.
 *   - `deferred` — the row is genuinely owed but not yet wired; the gap is
 *     tracked by an Issue (AGENTS.md §6, no untracked seam). A TEMPORARY state.
 *   - `noneBySpec` — the route owes **no** durable row *because the governing
 *     spec says so*. A PERMANENT, positive statement, not a gap: e.g. 011's
 *     `StartMfaEnrollment` "emits nothing durable (the factor is not yet
 *     confirmed)". Before this marker existed the only way to state it was to
 *     under-classify the route as `audit: "low-stakes"` and leave it out of the
 *     registry — which hid a security-relevant route from the completeness
 *     guard entirely.
 *
 * The registry lives beside the classification contract (not inside the e2e
 * file) so its schema and validation are unit-testable without booting the app
 * or a database — see `audit-emission-coverage.spec.ts`; the router cross-check
 * (discovered set ≡ registered set) stays in
 * `test/authz/audit-emission-coverage.e2e-spec.ts`.
 */
import {
  AUTH_AUDIT_EVENT_TYPES,
  type AuthAuditEventType,
} from "../auth/session/auth-audit.types.js";

/** One route's audit-emission accounting. */
export type AuditEmissionCoverage =
  | {
      /** The `AuthAuditEvent` type(s) this route's command site emits. */
      emits: AuthAuditEventType[];
      /** Human pointer to the covering e2e `it` (audit-ledger.e2e-spec.ts). */
      coveredBy: string;
    }
  | {
      /**
       * The route is high-stakes and state-changing but does NOT yet emit a
       * terminal row; the gap is tracked. The guard treats it as accounted-for
       * (so it does not block) while the linked Issue stays open — see #135 and
       * AGENTS.md §6 (no untracked seam).
       */
      deferred: { reason: string; issue: number };
    }
  | {
      /**
       * The route owes NO durable row, by spec — a settled property to protect,
       * not a gap to close. `reason` states what the spec says; `spec` cites the
       * clause that says it. Distinct from `deferred` (a tracked gap that will
       * be closed) and from `emits: []` (an empty claim, rejected).
       */
      noneBySpec: { reason: string; spec: string };
    };

/**
 * The reviewed coverage registry: every `audit: high-stakes` endpoint → how its
 * terminal row is accounted for. Keyed by the derived `METHOD /vN/path` endpoint
 * id (matches the generated endpoint-authz matrix). Adding a high-stakes route
 * without adding its line here fails the e2e guard.
 */
export const HIGH_STAKES_AUDIT_COVERAGE: Record<string, AuditEmissionCoverage> =
  {
    "POST /v1/auth/register": {
      emits: ["Registered"],
      coveredBy:
        "audit-ledger.e2e: EARS-18 register appends one auth.register row",
    },
    "POST /v1/auth/login": {
      // Success and both failure branches (wrong_password / lock) emit here; the
      // tripping transition also emits AccountLocked (EARS-15).
      emits: ["LoginSucceeded", "LoginFailed", "AccountLocked"],
      coveredBy:
        "audit-ledger.e2e: EARS-18 login.success / login.failure + EARS-15 lockout.triggered",
    },
    "POST /v1/auth/login/otp": {
      emits: ["LoginSucceeded", "LoginFailed"],
      coveredBy:
        "login-otp.e2e (EARS-6/7/8); failure/success both record at the command site",
    },
    "POST /v1/auth/login/otp/request": {
      emits: ["OtpSent"],
      coveredBy: "login-otp.e2e (EARS-6/7); an actual send records auth.otp.sent",
    },
    "POST /v1/auth/logout": {
      emits: ["SessionRevoked"],
      coveredBy:
        "audit-ledger.e2e: EARS-18 logout appends auth.session.terminated (reason logout)",
    },
    "POST /v1/auth/password/reset": {
      emits: ["PasswordResetRequested"],
      coveredBy:
        "audit-ledger.e2e: EARS-18 reset request appends auth.password.reset_requested",
    },
    "POST /v1/auth/password/reset/complete": {
      // Success emits PasswordResetCompleted (+ a session-created LoginSucceeded);
      // #1112 adds PasswordResetFailed on a rejected reset-complete (masked,
      // reason-coded observability — no state change, the LoginFailed precedent).
      emits: ["PasswordResetCompleted", "PasswordResetFailed"],
      coveredBy:
        "password-reset.e2e (EARS-12); completion records auth.password.changed (reset); auth.service.spec #1112 covers the auth.password.reset_failed row",
    },
    "POST /v1/auth/verify": {
      // #164: EARS-3/4 verify emits its terminal row at the command site.
      // #1112: a REJECTED verify (no mirror row → no-account, or a bad code →
      // invalid) now emits a masked, reason-coded auth.account.verify_failed
      // observability row — the state-changing success path is unchanged.
      emits: ["IdentifierVerified", "VerifyFailed"],
      coveredBy:
        "audit-ledger.e2e: EARS-18 email verification appends one auth.account.verified row; auth.service.spec #1112 covers the auth.account.verify_failed row",
    },
    "POST /v1/admin/auth/login": {
      // 011 EARS-3: primary auth at the admin origin. Success emits the canonical
      // `auth.login.success` carrying `tier: "admin"` and NO session (the policy
      // fork issues a pending reference instead); every refusal branch — wrong
      // password, locked, and a principal the `role → mfa_required` policy does
      // not cover — emits `auth.login.failure` with the same tier field.
      emits: ["AdminPrimaryAuthSucceeded", "AdminPrimaryAuthFailed"],
      coveredBy:
        "mfa-policy.e2e (011 EARS-3): admin primary auth appends auth.login.success carrying tier: admin; the non-policy principal path appends auth.login.failure",
    },
    "POST /v1/admin/auth/mfa/enroll/start": {
      // 011 EARS-5. The route IS high-stakes — it is the one call that mints and
      // hands over the shared TOTP secret — but the 011 Event Model states that
      // `StartMfaEnrollment` "emits nothing durable (the factor is not yet
      // confirmed)". "No row" here is a property to protect (the secret must
      // never reach the ledger), not a gap to close: the lifecycle row belongs to
      // the verify below, where possession is actually proven.
      noneBySpec: {
        reason:
          "StartMfaEnrollment emits nothing durable — the provisional factor is not yet confirmed, and the secret this call hands over must never reach the ledger. The lifecycle row is the enroll/verify one, where possession is proven.",
        spec: "011 Event Model (StartMfaEnrollment); EARS-5",
      },
    },
    "POST /v1/admin/auth/mfa/enroll/verify": {
      // 011 EARS-5: a correct first code confirms the factor (`auth.mfa.enrolled`,
      // secret-free) and upgrades the pending authentication in place into the
      // admin session (`auth.session.created`, LD-1 — no second login).
      emits: ["MfaEnrolled", "AdminSessionEstablished"],
      coveredBy:
        "mfa-enroll.e2e (011 EARS-5.4): enrollment appends exactly one auth.mfa.enrolled row carrying method: totp + tier: admin, plus the one auth.session.created of the in-place upgrade",
    },
    "POST /v1/admin/auth/mfa/verify": {
      // 011 EARS-6/EARS-7: the challenge. A correct code satisfies the login's
      // second factor (`auth.mfa.used`) and upgrades the pending authentication in
      // place (`auth.session.created`); a refused one appends `auth.mfa.failure`,
      // and the attempt that crosses the §7 threshold additionally appends
      // `auth.lockout.triggered`. All four are listed because this route is the
      // producing site for each — a lockout row with no failure rows behind it, or
      // vice versa, is precisely the evidence gap this registry exists to catch.
      emits: [
        "MfaChallengeSucceeded",
        "AdminSessionEstablished",
        "MfaChallengeFailed",
        "LockoutTriggered",
      ],
      coveredBy:
        "mfa-challenge.e2e (011 EARS-6.1/7.3/7.4): the challenge appends auth.mfa.used + auth.session.created on success, auth.mfa.failure on every refusal (both verify surfaces, discriminated by metadata.stage), and exactly one auth.lockout.triggered with reason mfa_attempts at the §7 threshold",
    },
    "POST /v1/admin/auth/logout": {
      // 011 EARS-2: terminates the admin session record only — the concurrent
      // portal session (and its own `auth.session.terminated` row) is untouched.
      emits: ["AdminSessionEnded"],
      coveredBy:
        "admin-session-separation.e2e (011 EARS-2): admin logout clears only the admin cookies and leaves a concurrent portal session valid",
    },
    "DELETE /v1/admin/users/:id/mfa": {
      // 011 EARS-13: the LD-2 operator recovery. The whole reason this action is
      // an endpoint rather than an IdP-console step is that the console is never
      // observed by `apps/api`, so `auth.mfa.reset` — the terminal row EARS-9
      // mandates for a factor removal — could never be written. The refusal
      // branches emit `MfaChallengeFailed` (stage `factor_removal`) under the
      // shared EARS-7 discipline, so the ledger shows attempts against this route
      // and not only its successes.
      emits: ["MfaFactorRemoved", "MfaChallengeFailed"],
      coveredBy:
        "mfa-factor-removal.e2e (011 EARS-13.1/13.3): a removal appends exactly one auth.mfa.reset carrying by_admin + tier: admin, and a wrong caller code appends auth.mfa.failure with stage: factor_removal; admin-audit.e2e (011 EARS-9.7) asserts the same row from the audit side",
    },
    "POST /v1/auth/verify/resend": {
      // #319 (EARS-25): a resend re-issues the otp_email code ONLY for an existing,
      // unverified registrant → one auth.otp.sent row; the no-op paths (unknown /
      // already-verified) emit nothing, so the ledger is not an existence oracle.
      emits: ["OtpSent"],
      coveredBy:
        "verify.e2e (EARS-25): an existing+unverified resend appends exactly one auth.otp.sent row; no-op paths append none",
    },
  };

/**
 * Validate ONE registry entry. Returns a list of human-readable findings (empty
 * = the entry is a well-formed accounting). Pure — the unit spec and the e2e
 * guard run the same function, so "what the registry accepts" has exactly one
 * definition.
 *
 * @param taxonomy the legal `AuthAuditEvent` type names; defaults to the real
 *   {@link AUTH_AUDIT_EVENT_TYPES}.
 */
export function validateCoverageEntry(
  endpoint: string,
  coverage: AuditEmissionCoverage,
  taxonomy: readonly string[] = AUTH_AUDIT_EVENT_TYPES,
): string[] {
  const findings: string[] = [];

  if ("noneBySpec" in coverage) {
    // A permanent "owes no row" claim only counts if it says WHAT the spec says
    // and WHICH clause says it — otherwise it is an unaudited opt-out.
    if (!coverage.noneBySpec.reason?.trim()) {
      findings.push(
        `${endpoint}: a none-by-spec entry must state the spec's reason for owing no durable row`,
      );
    }
    if (!coverage.noneBySpec.spec?.trim()) {
      findings.push(
        `${endpoint}: a none-by-spec entry must cite the governing spec clause`,
      );
    }
    return findings;
  }

  if ("deferred" in coverage) {
    // A deferral must point at a real, positive Issue number (#135 §6: no
    // untracked seam). It carries no event claim to validate.
    if (!(coverage.deferred.issue > 0)) {
      findings.push(`${endpoint}: deferral must reference a tracking Issue`);
    }
    return findings;
  }

  // A covered route must name at least one emitted event. `emits: []` stays
  // rejected: "no row" is said with `noneBySpec`, never with an empty list.
  if (coverage.emits.length === 0) {
    findings.push(
      `${endpoint}: a covered route must name at least one emitted event (use noneBySpec to record a route that owes no durable row by spec)`,
    );
  }
  const legal = new Set<string>(taxonomy);
  for (const ev of coverage.emits) {
    if (!legal.has(ev)) {
      findings.push(
        `${endpoint}: declares emit "${ev}" which is not in AUTH_AUDIT_EVENT_TYPES`,
      );
    }
  }
  return findings;
}

/** Validate the whole registry (or any registry-shaped object). */
export function validateCoverageRegistry(
  registry: Record<string, AuditEmissionCoverage>,
  taxonomy: readonly string[] = AUTH_AUDIT_EVENT_TYPES,
): string[] {
  return Object.entries(registry).flatMap(([endpoint, coverage]) =>
    validateCoverageEntry(endpoint, coverage, taxonomy),
  );
}
