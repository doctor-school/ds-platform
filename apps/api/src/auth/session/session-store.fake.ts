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
  /** Secondary index `sub → live sids`, so `deleteBySub` (EARS-12) is targeted and does not scan. */
  private readonly bySub = new Map<string, Set<string>>();

  create(record: SessionRecord): Promise<void> {
    this.bySid.set(record.sid, record);
    let sids = this.bySub.get(record.sub);
    if (!sids) this.bySub.set(record.sub, (sids = new Set()));
    sids.add(record.sid);
    return Promise.resolve();
  }

  get(sid: string): Promise<SessionRecord | undefined> {
    const record = this.bySid.get(sid);
    if (!record) return Promise.resolve(undefined);
    if (record.expiresAtMs <= Date.now()) {
      this.unlink(record);
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
    const record = this.bySid.get(sid);
    if (record) this.unlink(record);
    return Promise.resolve();
  }

  deleteBySub(sub: string): Promise<void> {
    // Revoke every session of the subject (EARS-12). Snapshot the sid set first
    // — `unlink` mutates it — then drop each record and the now-empty index entry.
    for (const sid of [...(this.bySub.get(sub) ?? [])]) {
      const record = this.bySid.get(sid);
      if (record) this.unlink(record);
    }
    return Promise.resolve();
  }

  /** Drop a record from both the primary map and the `sub` index, pruning the empty set. */
  private unlink(record: SessionRecord): void {
    this.bySid.delete(record.sid);
    const sids = this.bySub.get(record.sub);
    if (sids) {
      sids.delete(record.sid);
      if (sids.size === 0) this.bySub.delete(record.sub);
    }
  }
}
