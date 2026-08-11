import { describe, expect, it } from "vitest";
import { scanRealRouteSet } from "../../src/authz/authz.gate.js";
import { AUTH_AUDIT_EVENT_TYPES } from "../../src/auth/session/auth-audit.types.js";
import type { AuthAuditEventType } from "../../src/auth/session/auth-audit.types.js";

/**
 * Emission-completeness guard (#135 — resolving #90).
 *
 * Auth/security audit is **explicit emission by design**: every state-changing
 * auth command appends its terminal `auth_audit` row at the command site (the
 * `AuthAuditLog` port), NOT via an `@Authz`-driven interceptor (ADR-0002 §4.8;
 * authz/README.md). The one risk that design carries is the very thing an
 * interceptor would have removed for free: a *new* state-changing command could
 * be added that silently forgets to emit. `audit-ledger.e2e-spec.ts` asserts the
 * one-terminal-row invariant **per event** — but it cannot fail for a row that
 * was never wired.
 *
 * This guard closes that gap. The `@Authz({ audit: "high-stakes" })` class is the
 * SSOT for "this route is a state-changing/security command that owes a terminal
 * audit row" (endpoint-authorization-matrix-design §3). We discover the real
 * high-stakes route set over the actual Nest router (the same `scanRealRouteSet`
 * the endpoint-authz gate uses — no bespoke AST parse) and cross-check it against
 * an explicit, reviewed coverage registry below. Each registry entry names the
 * `AuthAuditEvent` type(s) the route emits and the covering e2e `it`, or records
 * an explicitly-tracked deferral (Issue #).
 *
 * The guard FAILS when:
 *   1. a discovered `high-stakes` route has no registry entry — someone added a
 *      state-changing handler and (probably) forgot its terminal emission;
 *   2. a registry entry references a route discovery does not find — the registry
 *      drifted (route renamed/removed);
 *   3. a covered entry names an event type that is not in the taxonomy
 *      ({@link AUTH_AUDIT_EVENT_TYPES}) — a typo'd / removed event.
 *
 * Adding a new high-stakes route therefore forces the author to declare, in a
 * reviewed table, how its terminal row is emitted (or to file the deferral) —
 * the discipline is enforced, not left to per-event vigilance.
 *
 * Unlike the other files here this guard issues no query (route discovery is
 * pure), so it does not strictly need Postgres — but it boots the real AppModule
 * via `scanRealRouteSet`, so it lives with the e2e suite that already has the
 * application wired.
 */

/** One route's audit-emission accounting. */
type Coverage =
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
    };

/**
 * The reviewed coverage registry: every `audit: high-stakes` endpoint → how its
 * terminal row is emitted. Keyed by the derived `METHOD /vN/path` endpoint id
 * (matches the generated endpoint-authz matrix). Adding a high-stakes route
 * without adding its line here fails the guard below.
 */
const HIGH_STAKES_AUDIT_COVERAGE: Record<string, Coverage> = {
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
  // `POST /v1/admin/auth/mfa/enroll/start` is deliberately absent: it is
  // classified `audit: low-stakes` because the 011 Event Model states that
  // `StartMfaEnrollment` "emits nothing durable (the factor is not yet
  // confirmed)". Carrying `high-stakes` there would assert a mandatory terminal
  // row that the spec forbids — and this registry has no honest way to say "owes
  // no row": `emits: []` is rejected, and `deferred` means a tracked GAP, which
  // this is not. The lifecycle row belongs to the verify below, which is where
  // possession is actually proven.
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
  "POST /v1/auth/verify/resend": {
    // #319 (EARS-25): a resend re-issues the otp_email code ONLY for an existing,
    // unverified registrant → one auth.otp.sent row; the no-op paths (unknown /
    // already-verified) emit nothing, so the ledger is not an existence oracle.
    emits: ["OtpSent"],
    coveredBy:
      "verify.e2e (EARS-25): an existing+unverified resend appends exactly one auth.otp.sent row; no-op paths append none",
  },
};

describe.skipIf(!process.env.DATABASE_URL)(
  "Auth-audit emission completeness (high-stakes routes)",
  () => {
    it("every audit:high-stakes route is accounted for in the coverage registry, and the registry has no stale entries", async () => {
      const { rows, violations } = await scanRealRouteSet();
      // Sanity: the underlying authz gate must itself be clean, else the
      // discovered set is meaningless.
      expect(violations).toEqual([]);

      const discovered = rows
        .filter((r) => r.meta.audit === "high-stakes")
        .map((r) => r.endpoint)
        .sort();

      const registered = Object.keys(HIGH_STAKES_AUDIT_COVERAGE).sort();

      // (1) Forgotten emission: a discovered high-stakes route with no registry
      // entry. This is the failure the guard exists to catch — a new
      // state-changing command added without declaring its terminal emission.
      const unregistered = discovered.filter(
        (e) => !(e in HIGH_STAKES_AUDIT_COVERAGE),
      );
      expect(
        unregistered,
        `New audit:high-stakes route(s) with no emission-coverage entry: ${unregistered.join(
          ", ",
        )}. Add a line to HIGH_STAKES_AUDIT_COVERAGE naming the AuthAuditEvent it emits + the covering e2e it, or (if the row is genuinely not owed yet) a tracked deferral. Auth audit is explicit-emission-by-design (ADR-0002 §4.8) — the row must be wired at the command site.`,
      ).toEqual([]);

      // (2) Stale registry: an entry whose route discovery no longer finds.
      const orphaned = registered.filter((e) => !discovered.includes(e));
      expect(
        orphaned,
        `Coverage-registry entries for route(s) the router no longer exposes: ${orphaned.join(
          ", ",
        )}. Remove the stale line(s) from HIGH_STAKES_AUDIT_COVERAGE.`,
      ).toEqual([]);

      // Belt-and-braces: the two sets are exactly equal.
      expect(discovered).toEqual(registered);
    });

    it("every covered entry names only events that exist in the AuthAuditEvent taxonomy", () => {
      const taxonomy = new Set<string>(AUTH_AUDIT_EVENT_TYPES);
      for (const [endpoint, coverage] of Object.entries(
        HIGH_STAKES_AUDIT_COVERAGE,
      )) {
        if ("deferred" in coverage) {
          // A deferral must point at a real, positive Issue number (#135 §6:
          // no untracked seam). It carries no event claim to validate.
          expect(
            coverage.deferred.issue,
            `${endpoint}: deferral must reference a tracking Issue`,
          ).toBeGreaterThan(0);
          continue;
        }
        expect(
          coverage.emits.length,
          `${endpoint}: a covered route must name at least one emitted event`,
        ).toBeGreaterThan(0);
        for (const ev of coverage.emits) {
          expect(
            taxonomy.has(ev),
            `${endpoint}: declares emit "${ev}" which is not in AUTH_AUDIT_EVENT_TYPES`,
          ).toBe(true);
        }
      }
    });
  },
);
