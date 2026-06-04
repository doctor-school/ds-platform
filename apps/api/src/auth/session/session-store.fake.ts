import type { SessionRecord, SessionStore } from "./session.types.js";

/**
 * In-memory {@link SessionStore} (the testable side of the design §3 boundary).
 *
 * The default binding when no `REDIS_URL` is configured (the shared CI `api-e2e`
 * job has no Redis service; the dev-stand may run without one), so the BFF
 * session flows (EARS-5/8) run end-to-end against a real Postgres without a live
 * Redis — exactly as {@link FakeIdpClient} stands in for Zitadel. It honours the
 * TTL by lazily evicting on read so an expired session is indistinguishable from
 * an absent one, matching the Redis adapter's key-expiry semantics.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly bySid = new Map<string, SessionRecord>();

  create(record: SessionRecord): Promise<void> {
    this.bySid.set(record.sid, record);
    return Promise.resolve();
  }

  get(sid: string): Promise<SessionRecord | undefined> {
    const record = this.bySid.get(sid);
    if (!record) return Promise.resolve(undefined);
    if (record.expiresAtMs <= Date.now()) {
      this.bySid.delete(sid);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(record);
  }

  rotate(sid: string, accessToken: string, refreshToken: string): Promise<void> {
    const record = this.bySid.get(sid);
    // No-op if the session is gone (expired/revoked) — rotation never resurrects.
    if (record) this.bySid.set(sid, { ...record, accessToken, refreshToken });
    return Promise.resolve();
  }

  delete(sid: string): Promise<void> {
    this.bySid.delete(sid);
    return Promise.resolve();
  }
}
