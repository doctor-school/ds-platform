import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { auditLedger, type DrizzleHandle, type NewAuditLedgerRow } from "@ds/db";
import { DRIZZLE_DB } from "../../database/database.tokens.js";
import type { AuthAuditEvent, AuthAuditLog } from "./auth-audit.types.js";

type Db = DrizzleHandle["db"];

/**
 * Mask a raw identifier (email / phone) for the ledger (ADR-0001 §7, ADR-0003
 * §6): the `auth.login.failure` / `auth.password.reset_requested` /
 * `auth.otp.sent` rows record an `identifier_hash`, never the raw PD. SHA-256 is
 * one-way; a keyed HMAC pepper (so the access-controlled ledger is not itself an
 * existence oracle for a guessed identifier) is a documented hardening follow-up.
 */
export function hashIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier.toLowerCase()).digest("hex");
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
 */
export function toLedgerRow(event: AuthAuditEvent): MappedRow {
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
        metadata: { identifier_hash: hashIdentifier(event.identifier) },
      };
    case "OtpSent":
      return {
        eventType: "auth.otp.sent",
        subjectId: null,
        sid: null,
        reason: null,
        metadata: {
          channel: event.channel,
          identifier_hash: hashIdentifier(event.identifier),
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
        metadata: { identifier_hash: hashIdentifier(event.identifier) },
      };
    case "PasswordResetCompleted":
      return {
        eventType: "auth.password.reset.completed",
        subjectId: event.sub,
        sid: null,
        reason: null,
        metadata: {},
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
 */
@Injectable()
export class DrizzleAuthAuditLog implements AuthAuditLog {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async record(event: AuthAuditEvent): Promise<void> {
    const row = toLedgerRow(event);
    await this.db.insert(auditLedger).values({ eventId: randomUUID(), ...row });
  }
}
