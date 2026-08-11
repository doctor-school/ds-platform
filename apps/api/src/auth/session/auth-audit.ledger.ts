import { createHmac, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  auditLedger,
  type DrizzleHandle,
  type NewAuditLedgerRow,
} from "@ds/db";
import { DRIZZLE_DB } from "../../database/database.tokens.js";
import { loadEnv } from "../../config/env.schema.js";
import type { AuthAuditEvent, AuthAuditLog } from "./auth-audit.types.js";

type Db = DrizzleHandle["db"];

/**
 * Fixed, deterministic pepper used ONLY under the test runtime (VITEST), so the
 * DB-gated e2e suite runs without provisioning a secret. Never reached in any
 * non-test runtime — the writer fails closed there when no real pepper is set.
 */
const TEST_FALLBACK_PEPPER = "test-only-insecure-audit-identifier-pepper";

/**
 * 011 EARS-9 tier discriminator. The admin tier shares the canonical
 * `auth.session.*` / `auth.login.*` classes with the doctor portal, so every row
 * the admin tier writes carries `tier: "admin"` in the ledger row's `metadata` —
 * the §7.3 idiom of discriminating within a class by attribute (as `method` does
 * on `auth.mfa.*` and `reason` on `auth.session.terminated`), not a new class.
 */
export const ADMIN_TIER = "admin";

/**
 * Mask a raw identifier (email / phone) for the ledger (ADR-0001 §7, ADR-0003
 * §6): the `auth.login.failure` / `auth.password.reset_requested` /
 * `auth.otp.sent` rows record an `identifier_hash`, never the raw PD. The mask is
 * a keyed **HMAC-SHA256** over the lowercased identifier: a bare digest over a
 * low-entropy identifier space is a reproducible existence oracle (a rainbow
 * table over a phone range), so without the server-side `pepper` the masked value
 * is not reproducible. The pepper is threaded in explicitly (resolved once in the
 * writer's constructor) — this function never reads the environment.
 */
export function hashIdentifier(identifier: string, pepper: string): string {
  return createHmac("sha256", pepper)
    .update(identifier.toLowerCase())
    .digest("hex");
}

/** The ledger-row shape an event maps to, minus the generated `eventId`/`id`/`createdAt`. */
type MappedRow = Pick<
  NewAuditLedgerRow,
  "eventType" | "subjectId" | "sid" | "reason" | "metadata"
>;

/**
 * The single place the internal (EARS) event name is reconciled to its canonical
 * `auth.<class>.<event>` wire id (ADR-0001 §7.3, owned by
 * identity-auth-rbac-design §7.3) and its PD is masked. F4 deferred this mapping
 * to F6 as decision-debt; it lives here so there is no second source to drift.
 *
 * `mask` is the bound identifier-masking function (HMAC-SHA256 over a
 * pepper, {@link hashIdentifier}) — injected so this stays a pure, unit-testable
 * mapping that never reads the environment.
 */
export function toLedgerRow(
  event: AuthAuditEvent,
  mask: (identifier: string) => string,
): MappedRow {
  switch (event.type) {
    case "Registered":
      return {
        eventType: "auth.register",
        subjectId: event.sub,
        sid: null,
        reason: null,
        // Consent versions are not PD (purpose + version strings); folding them
        // here keeps registration a single terminal row (003 invariant).
        metadata: { channel: event.channel, consent: event.consent },
      };
    case "LoginSucceeded":
      return {
        eventType: "auth.login.success",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: { method: event.method },
      };
    case "LoginFailed":
      return {
        eventType: "auth.login.failure",
        subjectId: null,
        sid: null,
        reason: event.reason,
        metadata: { identifier_hash: mask(event.identifier) },
      };
    case "VerifyFailed":
      // #1112: a rejected email verification. Canonical class `auth.account`
      // (the account-lifecycle namespace, mirroring `auth.account.verified`);
      // `verify_failed` is the rejected-activation outcome. Identifier-keyed and
      // masked like `LoginFailed` (no subject — the attempt-counting join key is
      // the `identifier_hash`); the `reason` collapses to what the boolean IdP
      // port exposes. No raw PD, no one-time code (003 EARS-30).
      return {
        eventType: "auth.account.verify_failed",
        subjectId: null,
        sid: null,
        reason: event.reason,
        metadata: { identifier_hash: mask(event.identifier) },
      };
    case "PasswordResetFailed":
      // #1112: a rejected reset-complete. Canonical class `auth.password`
      // (mirroring `auth.password.reset_requested` / `.changed`); `reset_failed`
      // is the rejected-completion outcome. Same identifier-keyed masked shape as
      // `VerifyFailed` — no subject, no raw PD, no one-time code (003 EARS-30).
      return {
        eventType: "auth.password.reset_failed",
        subjectId: null,
        sid: null,
        reason: event.reason,
        metadata: { identifier_hash: mask(event.identifier) },
      };
    case "OtpSent":
      return {
        eventType: "auth.otp.sent",
        subjectId: null,
        sid: null,
        reason: null,
        metadata: {
          channel: event.channel,
          identifier_hash: mask(event.identifier),
        },
      };
    case "RefreshRotated":
      return {
        eventType: "auth.token.rotated",
        subjectId: event.sub,
        sid: event.sid,
        reason: null,
        metadata: {},
      };
    case "RefreshReuseDetected":
      return {
        eventType: "auth.token.theft_detected",
        subjectId: event.sub,
        sid: event.sid,
        reason: null,
        metadata: {},
      };
    case "SessionRevoked":
      return {
        eventType: "auth.session.terminated",
        subjectId: event.sub,
        sid: event.sid,
        reason: "logout",
        metadata: {},
      };
    case "PasswordResetRequested":
      return {
        eventType: "auth.password.reset_requested",
        subjectId: null,
        sid: null,
        reason: null,
        metadata: { identifier_hash: mask(event.identifier) },
      };
    case "PasswordResetCompleted":
      // Canonical class is `auth.password.{changed, reset_requested}` (ADR-0001
      // §7.3, the taxonomy owner) — a completed self-service reset is a password
      // change `by_self`; `reason: "reset"` distinguishes it from an in-session
      // change. (EARS-18's prose list says `password.reset.completed`, but §7.3
      // is authoritative and every other event here is normalized to it.)
      return {
        eventType: "auth.password.changed",
        subjectId: event.sub,
        sid: null,
        reason: "reset",
        metadata: { by: "self" },
      };
    case "AccountLocked":
      return {
        eventType: "auth.lockout.triggered",
        subjectId: event.sub,
        sid: null,
        reason: "lock",
        metadata: {},
      };
    case "IdentifierVerified":
      // EARS-3/4 verification success — the account's identifier reached the
      // verified state. Canonical wire id `auth.account.verified` (ADR-0001
      // §7.3): the `auth.account` class is the account-lifecycle namespace, and
      // `verified` is the activation outcome (not an OTP *send* — that is the
      // separate `auth.otp.sent`). Keyed by the opaque subject; the verified
      // channel rides in the metadata. No raw PD.
      return {
        eventType: "auth.account.verified",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: { channel: event.channel },
      };
    case "ReconcileDivergence":
      // EARS-19 reconcile depth (#753): the sweep overwrote mirror identity
      // fields Zitadel diverged on (Zitadel-wins). Keyed by the opaque subject;
      // the changed **field names** ride in metadata — never the values, so the
      // ledger stays PD-free (ADR-0001 §7, ADR-0003 §6).
      return {
        eventType: "auth.reconcile.divergence",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: { fields: event.fields },
      };

    // ---- 011 admin tier (EARS-9) --------------------------------------------
    // Canonical §7.3 ids only — 011 invents none and defines no parallel
    // taxonomy (011 design §8a). `tier: "admin"` is the discriminating field
    // that keeps an admin forensic query from silently returning portal rows on
    // the shared `auth.session.*` / `auth.login.*` classes; it rides the
    // existing `metadata` jsonb, so there is NO schema migration.
    case "AdminPrimaryAuthSucceeded":
      return {
        eventType: "auth.login.success",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: { method: "password", tier: ADMIN_TIER },
      };
    case "AdminPrimaryAuthFailed":
      return {
        eventType: "auth.login.failure",
        // Named only on the `not_permitted` branch (see the event's doc): the
        // IdP had already asserted this subject, so the row can say WHO was
        // refused instead of filing a valid-credential probe as anonymous noise.
        subjectId: event.sub,
        sid: null,
        reason: event.reason,
        metadata: { identifier_hash: mask(event.identifier), tier: ADMIN_TIER },
      };
    case "MfaEnrolled":
      // EARS-5/EARS-9: the canonical id ADR-0001 design §8.5 already defines,
      // reused rather than twinned. `method` is the §7.3 discriminator within
      // `auth.mfa.*`; `tier` separates this from any future portal-side factor.
      // The row is deliberately secret-free — there is no field here that could
      // carry the shared secret, the provisioning URI, or the submitted code.
      return {
        eventType: "auth.mfa.enrolled",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: { method: "totp", tier: ADMIN_TIER },
      };
    case "MfaChallengeSucceeded":
      // EARS-6/EARS-9: the canonical `auth.mfa.used` id of the 011 Event Model —
      // "a login's second factor satisfied". Distinct from `auth.mfa.enrolled`
      // (a factor came into existence) because a forensic reader asking "when did
      // this operator last prove possession?" must not have to guess which of the
      // two a row meant.
      return {
        eventType: "auth.mfa.used",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: { method: "totp", tier: ADMIN_TIER },
      };
    case "MfaChallengeFailed":
      // EARS-7/EARS-9: `auth.mfa.failure`, written by BOTH verify surfaces — the
      // enrollment verify had no failure row at all before this slice, which made
      // "10 failed attempts" a threshold with no evidence trail behind it. `stage`
      // separates the two surfaces without splitting the wire id, exactly as
      // `tier` separates admin from portal inside a shared class (design §8a).
      // The submitted code is absent from the event SHAPE, so no future edit to
      // this mapper can leak it into a row.
      return {
        eventType: "auth.mfa.failure",
        subjectId: event.sub,
        sid: null,
        reason: event.reason,
        metadata: { method: "totp", stage: event.stage, tier: ADMIN_TIER },
      };
    case "MfaFactorRemoved":
      // EARS-13/EARS-9: the canonical `auth.mfa.reset` id. `by_admin` is the
      // §7.3 field defined for exactly this action — it names the OPERATOR, while
      // `subjectId` names the admin whose factor is gone; a row carrying only one
      // of the two would answer "whose factor?" or "who did it?" but never both,
      // and the whole reason this action is an endpoint is that both are the
      // record (011 requirements → LD-2).
      //
      // The metadata is exactly the pair the 011 Event Model declares. It is also
      // the SHAPE the LD-2 break-glass script writes, because that script goes
      // through this same mapper — so a ledger reader cannot tell an endpoint
      // removal from a break-glass one, and the trail has no hole (design §10).
      return {
        eventType: "auth.mfa.reset",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: { by_admin: event.byAdmin, tier: ADMIN_TIER },
      };
    case "LockoutTriggered":
      // EARS-7: the admin-tier soft-lock. Shares 003's canonical
      // `auth.lockout.triggered` id; `reason: "mfa_attempts"` is what separates a
      // BFF-owned TOTP-attempt lock from the `lock` rows that merely OBSERVE
      // Zitadel's native password lockout (`AccountLocked`).
      return {
        eventType: "auth.lockout.triggered",
        subjectId: event.sub,
        sid: null,
        reason: "mfa_attempts",
        metadata: { tier: ADMIN_TIER },
      };
    case "AdminSessionEstablished":
      return {
        eventType: "auth.session.created",
        subjectId: event.sub,
        sid: event.sid,
        reason: null,
        metadata: { tier: ADMIN_TIER },
      };
    case "AdminSessionEnded":
      return {
        eventType: "auth.session.terminated",
        subjectId: event.sub,
        sid: event.sid,
        reason: event.reason,
        metadata: { tier: ADMIN_TIER },
      };
    case "AdminSessionRejected":
      // The one id 011 adds: a NEW event inside the EXISTING canonical
      // `auth.session` class (not a new class). Registered upstream by the
      // forward-reference line in ADR-0001 design §7.3 naming spec 011.
      return {
        eventType: "auth.session.rejected",
        subjectId: event.sub,
        sid: null,
        reason: event.reason,
        metadata: { tier: ADMIN_TIER },
      };
  }
}

/**
 * Durable {@link AuthAuditLog} — the EARS-18 `audit_ledger` writer (003-design
 * §7.3). Maps each event to its canonical row ({@link toLedgerRow}), stamps a
 * fresh idempotency `eventId`, and appends. The table is append-only at the DB
 * level (migration 0002 trigger), so this writer only ever INSERTs.
 *
 * Bound to {@link AUTH_AUDIT} in {@link SessionModule} when a database handle is
 * present — replacing the F4 in-memory default without touching any call site,
 * exactly as `RedisSessionStore` replaces the in-memory store.
 *
 * The HMAC pepper ({@link AUDIT_IDENTIFIER_PEPPER}) is resolved **once** here via
 * the inline `loadEnv()` pattern (as `SessionModule` reads `REDIS_URL`), and the
 * mask is bound from it. Fail-closed: if no pepper is configured and the process
 * is not a test runtime (`VITEST` unset), construction throws — masking with no
 * secret would silently reintroduce the existence oracle (#141). Under VITEST a
 * fixed {@link TEST_FALLBACK_PEPPER} keeps the DB-gated e2e suite runnable
 * without provisioning a secret.
 */
@Injectable()
export class DrizzleAuthAuditLog implements AuthAuditLog {
  private readonly mask: (identifier: string) => string;

  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {
    const pepper = resolveAuditPepper();
    this.mask = (identifier: string): string =>
      hashIdentifier(identifier, pepper);
  }

  async record(event: AuthAuditEvent): Promise<void> {
    const row = toLedgerRow(event, this.mask);
    await this.db.insert(auditLedger).values({ eventId: randomUUID(), ...row });
  }
}

/**
 * Resolve the ledger HMAC pepper, applying the fail-closed / test-fallback rule
 * (#141). Returns the configured `AUDIT_IDENTIFIER_PEPPER`; falls back to the
 * fixed test pepper under VITEST; throws otherwise so a misconfigured non-test
 * runtime never masks with a missing secret.
 */
function resolveAuditPepper(): string {
  const pepper = loadEnv().AUDIT_IDENTIFIER_PEPPER;
  if (pepper) return pepper;
  if (process.env.VITEST) return TEST_FALLBACK_PEPPER;
  throw new Error(
    "AUDIT_IDENTIFIER_PEPPER is not configured — the audit ledger refuses to " +
      "mask identifiers without a keyed HMAC pepper (an unkeyed digest over a " +
      "low-entropy identifier space is a reproducible existence oracle, #141). " +
      "Set AUDIT_IDENTIFIER_PEPPER to a server-side secret.",
  );
}
