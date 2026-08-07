import type {
  AdminSessionRecord,
  AdminSessionStore,
  PendingAuthRecord,
  PendingAuthStore,
} from "./admin-session.types.js";

/**
 * In-memory {@link AdminSessionStore} / {@link PendingAuthStore} — the default
 * binding when no `REDIS_URL` is configured (the shared CI `api-e2e` job has no
 * Redis service), mirroring the 003 `InMemorySessionStore`. Both honour their TTL
 * by lazily evicting on read, so an expired record is indistinguishable from an
 * absent one — the same semantics Redis key expiry gives (EARS-10).
 */
export class InMemoryAdminSessionStore implements AdminSessionStore {
  private readonly bySid = new Map<string, AdminSessionRecord>();
  /** Secondary index `sub → live sids` so force-logout is targeted, not a scan. */
  private readonly bySub = new Map<string, Set<string>>();

  create(record: AdminSessionRecord): Promise<void> {
    this.bySid.set(record.sid, record);
    let sids = this.bySub.get(record.sub);
    if (!sids) this.bySub.set(record.sub, (sids = new Set()));
    sids.add(record.sid);
    return Promise.resolve();
  }

  get(sid: string): Promise<AdminSessionRecord | undefined> {
    const record = this.bySid.get(sid);
    if (!record) return Promise.resolve(undefined);
    if (record.expiresAtMs <= Date.now()) {
      this.unlink(record);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(record);
  }

  rotate(
    sid: string,
    accessToken: string,
    refreshToken: string,
  ): Promise<void> {
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

  deleteBySub(sub: string): Promise<string[]> {
    const revoked: string[] = [];
    for (const sid of [...(this.bySub.get(sub) ?? [])]) {
      const record = this.bySid.get(sid);
      if (record) {
        this.unlink(record);
        revoked.push(sid);
      }
    }
    this.bySub.delete(sub);
    return Promise.resolve(revoked);
  }

  private unlink(record: AdminSessionRecord): void {
    this.bySid.delete(record.sid);
    const sids = this.bySub.get(record.sub);
    if (!sids) return;
    sids.delete(record.sid);
    if (sids.size === 0) this.bySub.delete(record.sub);
  }
}

/** In-memory {@link PendingAuthStore} — a separate map, mirroring the separate Redis namespace. */
export class InMemoryPendingAuthStore implements PendingAuthStore {
  private readonly byRef = new Map<string, PendingAuthRecord>();

  create(record: PendingAuthRecord): Promise<void> {
    this.byRef.set(record.ref, record);
    return Promise.resolve();
  }

  get(ref: string): Promise<PendingAuthRecord | undefined> {
    const record = this.byRef.get(ref);
    if (!record) return Promise.resolve(undefined);
    if (record.expiresAtMs <= Date.now()) {
      this.byRef.delete(ref);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(record);
  }

  delete(ref: string): Promise<void> {
    this.byRef.delete(ref);
    return Promise.resolve();
  }
}
