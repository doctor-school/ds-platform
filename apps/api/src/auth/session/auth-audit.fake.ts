import type { AuthAuditEvent, AuthAuditLog } from "./auth-audit.types.js";

/**
 * In-memory {@link AuthAuditLog} — the F4 default binding, and the test double.
 *
 * It keeps appended events in order so a test can assert the right security
 * event fired (EARS-9 reuse, EARS-10 logout). It is the binding until F6 (#90)
 * wires the durable `audit_ledger` writer (EARS-18) — exactly as the in-memory
 * session store stands in for Redis until a `REDIS_URL` is configured.
 */
export class InMemoryAuthAuditLog implements AuthAuditLog {
  readonly events: AuthAuditEvent[] = [];

  record(event: AuthAuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}
