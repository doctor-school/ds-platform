import { createHmac, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { auditLedger, type DrizzleHandle, type NewAuditLedgerRow } from "@ds/db";
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
