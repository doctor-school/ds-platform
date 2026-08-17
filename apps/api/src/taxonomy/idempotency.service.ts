import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { idempotencyKeys } from "@ds/db";
import {
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_TTL_MS,
  isCanonicalIdempotencyKey,
  MEDIA_PROFILE_VERSION,
} from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// 012-design §6 / EARS-17 — the retained, fenced idempotency record. Introduced
// by #1283 as the first 012 mutation and consumed unchanged by every later
// handler.
//
// The three invariants this service exists to hold:
//
// 1. **A key is globally reserved, forever.** Not per actor, not per route, not
//    per 24-hour window. So a second actor replaying someone else's key gets a
//    refusal, never that command's stored response.
// 2. **The binding is immutable once written.** A retry recomputes its own
//    fingerprint from its own bytes; a mismatch is refused BEFORE normalization
//    or upload. Two byte-different files that would normalize identically stay
//    two different requests — the canonical output is not the identity.
// 3. **Completion is fenced.** The domain transaction commits only if the
//    record still names this owner's `lease_epoch`. A stale owner's write
//    updates zero rows and takes the whole transaction down with it, so a
//    resumed request can never double-apply.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Everything the fingerprint binds (012-design §6). */
export interface FingerprintInput {
  method: string;
  /** Concrete path INCLUDING the resolved route parameters. */
  path: string;
  /** Query parameters — order-insensitive, so `?a=1&b=2` and `?b=2&a=1` agree. */
  query?: Record<string, string | undefined>;
  /** The parsed request payload; canonicalized before hashing. */
  payload?: unknown;
  ifMatch?: string;
  lifecycleImpactToken?: string;
  /** SHA-256 of the uploaded file, or null for a JSON-only request. */
  fileSha256?: string | null;
  /** Byte length of the uploaded file, or null for a JSON-only request. */
  fileBytes?: number | null;
}

/** A record this request owns and may complete. */
export interface IdempotencyLease {
  key: string;
  actorId: string | null;
  method: string;
  route: string;
  fingerprint: string;
  leaseEpoch: number;
  leaseOwner: string;
}

/** A completed record whose stored outcome must be replayed verbatim. */
export interface IdempotencyReplay {
  status: number;
  body: unknown;
  etag: string | null;
  location: string | null;
}

export type IdempotencyOutcome =
  | { kind: "owned"; lease: IdempotencyLease }
  | { kind: "replay"; replay: IdempotencyReplay };

/** The deterministic outcome stored on a record (success, 409 or 412 alike). */
export interface StoredResponse {
  status: number;
  body: unknown;
  etag?: string | null;
  location?: string | null;
}

/**
 * Thrown when a fenced write matches zero rows — another owner took the record
 * over mid-flight. The caller lets it abort the transaction: every domain, media
 * and audit write of this attempt rolls back.
 */
export class IdempotencyFenceError extends Error {
  constructor(readonly key: string) {
    super(`idempotency record ${key} was taken over by a newer lease`);
  }
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Validate the raw `Idempotency-Key` header. Absent/blank is 428
   * `IDEMPOTENCY_KEY_REQUIRED`; present but non-canonical is 400
   * `IDEMPOTENCY_KEY_INVALID`. Both run before a multipart file is read, so a
   * keyless upload never even streams (012-design §5.1 failure order).
   */
  requireKey(raw: unknown): string {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length === 0) {
      throw new TaxonomyError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "every mutating taxonomy request requires an Idempotency-Key",
      );
    }
    if (!isCanonicalIdempotencyKey(value)) {
      throw new TaxonomyError(
        "IDEMPOTENCY_KEY_INVALID",
        "Idempotency-Key must be canonical lowercase UUID text",
      );
    }
    return value;
  }

  /**
   * SHA-256 over the exact §6 input set. Canonical JSON (sorted keys) so a
   * client that serializes its object in a different property order still
   * replays instead of colliding; `media_profile_version` included so a
   * normalizer profile change is a new request rather than a silent re-encode
   * under an old key.
   */
  fingerprint(input: FingerprintInput): string {
    const query = Object.entries(input.query ?? {})
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const parts = [
      input.method.toUpperCase(),
      input.path,
      query,
      canonicalJson(input.payload ?? null),
      input.ifMatch ?? "",
      input.lifecycleImpactToken ?? "",
      input.fileSha256 ?? "",
      input.fileBytes === null || input.fileBytes === undefined
        ? ""
        : String(input.fileBytes),
      MEDIA_PROFILE_VERSION,
    ];
    return createHash("sha256").update(parts.join("\n")).digest("hex");
  }

  /**
   * Reserve the key or resolve what an existing record means for this attempt.
   *
   * Returns `owned` when this request may proceed, or `replay` when the record
   * already holds a deterministic outcome. Throws:
   *
   * - 409 `IDEMPOTENCY_KEY_REUSED` — a different actor, route, method or
   *   fingerprint, or an expired record whose replay window has closed. The key
   *   stays reserved forever, so this is a refusal, never a fresh reservation.
   * - 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS` — an identical request still holds a
   *   live lease. A retry is welcome after it finishes; guessing would
   *   double-apply.
   */
  async begin(params: {
    key: string;
    scope: string;
    actorId: string | null;
    method: string;
    route: string;
    fingerprint: string;
  }): Promise<IdempotencyOutcome> {
    const leaseOwner = randomUUID();
    const now = new Date();
    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({
        key: params.key,
        scope: params.scope,
        actorId: params.actorId,
        method: params.method.toUpperCase(),
        route: params.route,
        requestFingerprint: params.fingerprint,
        executionState: "processing",
        leaseEpoch: 1,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + IDEMPOTENCY_LEASE_MS),
        status: "active",
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      })
      .onConflictDoNothing({ target: idempotencyKeys.key })
      .returning();

    if (inserted[0]) {
      return {
        kind: "owned",
        lease: {
          key: params.key,
          actorId: params.actorId,
          method: params.method.toUpperCase(),
          route: params.route,
          fingerprint: params.fingerprint,
          leaseEpoch: 1,
          leaseOwner,
        },
      };
    }

    const [existing] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, params.key));
    if (!existing) {
      // The row vanished between the conflicting insert and this read — only a
      // physical delete could do that, and §6 forbids one. Refuse rather than
      // retry into an unknown state.
      throw new TaxonomyError(
        "IDEMPOTENCY_KEY_REUSED",
        "the idempotency record could not be resolved",
      );
    }

    if (existing.status === "expired") {
      throw new TaxonomyError(
        "IDEMPOTENCY_KEY_REUSED",
        "this Idempotency-Key is permanently reserved and its replay window has closed",
      );
    }
    if (
      existing.actorId !== params.actorId ||
      existing.method !== params.method.toUpperCase() ||
      existing.route !== params.route
    ) {
      throw new TaxonomyError(
        "IDEMPOTENCY_KEY_REUSED",
        "this Idempotency-Key belongs to a different actor or route",
      );
    }
    if (existing.requestFingerprint !== params.fingerprint) {
      throw new TaxonomyError(
        "IDEMPOTENCY_KEY_REUSED",
        "this Idempotency-Key was first used with different input",
      );
    }

    if (existing.executionState === "completed") {
      return {
        kind: "replay",
        replay: {
          status: existing.responseStatus ?? 200,
          body: existing.responseBody ?? null,
          etag: existing.responseEtag,
          location: existing.responseLocation,
        },
      };
    }

    // Same input, still processing. Only an EXPIRED lease may be taken over,
    // and only by CAS on the epoch this read observed.
    const leaseLive =
      existing.leaseExpiresAt !== null && existing.leaseExpiresAt > now;
    if (leaseLive) {
      throw new TaxonomyError(
        "IDEMPOTENCY_REQUEST_IN_PROGRESS",
        "an identical request is still in progress",
      );
    }
    const nextEpoch = existing.leaseEpoch + 1;
    const takenOver = await this.db
      .update(idempotencyKeys)
      .set({
        leaseEpoch: nextEpoch,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + IDEMPOTENCY_LEASE_MS),
      })
      .where(
        and(
          eq(idempotencyKeys.key, params.key),
          eq(idempotencyKeys.leaseEpoch, existing.leaseEpoch),
          eq(idempotencyKeys.executionState, "processing"),
          eq(idempotencyKeys.status, "active"),
        ),
      )
      .returning();
    if (!takenOver[0]) {
      throw new TaxonomyError(
        "IDEMPOTENCY_REQUEST_IN_PROGRESS",
        "an identical request is still in progress",
      );
    }
    this.logger.log(
      `idempotency record ${params.key} taken over at epoch ${nextEpoch}`,
    );
    return {
      kind: "owned",
      lease: {
        key: params.key,
        actorId: params.actorId,
        method: params.method.toUpperCase(),
        route: params.route,
        fingerprint: params.fingerprint,
        leaseEpoch: nextEpoch,
        leaseOwner,
      },
    };
  }

  /**
   * Fenced completion INSIDE the caller's transaction (012-design §6). Stores
   * the exact deterministic outcome — success, 409 invariant or 412 refusal
   * alike — and marks the record completed only while the epoch still matches.
   * A zero-row update throws {@link IdempotencyFenceError}, which aborts the
   * transaction and rolls back every domain and audit write with it.
   */
  async complete(
    tx: Tx | Db,
    lease: IdempotencyLease,
    response: StoredResponse,
  ): Promise<void> {
    const updated = await tx
      .update(idempotencyKeys)
      .set({
        executionState: "completed",
        responseStatus: response.status,
        responseBody: (response.body ?? null) as never,
        responseEtag: response.etag ?? null,
        responseLocation: response.location ?? null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(idempotencyKeys.key, lease.key),
          eq(idempotencyKeys.leaseEpoch, lease.leaseEpoch),
          eq(idempotencyKeys.executionState, "processing"),
          eq(idempotencyKeys.status, "active"),
        ),
      )
      .returning({ key: idempotencyKeys.key });
    if (!updated[0]) throw new IdempotencyFenceError(lease.key);
  }

  /**
   * Record the deterministic locator of an object this request uploaded, so the
   * quiescent sweep can reclaim it if the command never commits (012-design §6).
   * Written outside the domain transaction, before the PUT — an orphan we know
   * about is recoverable; one we do not is a permanent leak.
   */
  async noteUploadLocator(lease: IdempotencyLease, objectKey: string): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ cleanupObjectKey: objectKey })
      .where(
        and(
          eq(idempotencyKeys.key, lease.key),
          eq(idempotencyKeys.leaseEpoch, lease.leaseEpoch),
        ),
      );
  }

  /**
   * The deterministic, record-scoped object key of an upload (012-design §6).
   * Derived from the record key and the canonical content hash, so a retry of
   * the SAME request writes the SAME key (with `If-None-Match: *`, no stale
   * owner can overwrite it) while a replacement always lands on a fresh key
   * instead of overwriting a still-referenced object in place.
   */
  objectKeyFor(params: {
    lease: IdempotencyLease;
    prefix: string;
    canonicalSha256: string;
    extension: string;
  }): string {
    return `${params.prefix}/${params.lease.key}-${params.canonicalSha256.slice(0, 32)}.${params.extension}`;
  }

  /**
   * The 24-hour retained expiry (012-design §6): ONE transaction per due row set
   * that sets `expired` + `deleted_at`, closes replay and every upload
   * capability, and clears actor/request/response/fingerprint content — while
   * permanently keeping the globally unique key and the terminal enums and
   * timestamps. No row is deleted, reactivated or reused.
   *
   * `cleanup_object_key` is deliberately NOT cleared here: it is the non-content
   * locator the quiescent reconciler still needs (§6). It is cleared only once
   * absence is acknowledged.
   */
  async expireDueRecords(now = new Date()): Promise<number> {
    const expired = await this.db
      .update(idempotencyKeys)
      .set({
        status: "expired",
        deletedAt: now,
        actorId: null,
        method: null,
        route: null,
        requestFingerprint: null,
        responseBody: null,
        responseEtag: null,
        responseLocation: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(idempotencyKeys.status, "active"),
          lte(idempotencyKeys.expiresAt, now),
        ),
      )
      .returning({ key: idempotencyKeys.key });
    if (expired.length > 0) {
      this.logger.log(`expired ${expired.length} idempotency record(s)`);
    }
    return expired.length;
  }

  /**
   * Clear the retained upload locator of an expired record once the reconciler
   * has acknowledged the object's absence (§6) — the last piece of live content
   * on the row, after which only the key and terminal state remain.
   */
  async clearReclaimedLocator(key: string): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ cleanupObjectKey: null })
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.status, "expired"),
        ),
      );
  }

  /** Expired records whose upload locator still awaits reconciliation. */
  async pendingReclaimLocators(limit = 50): Promise<
    { key: string; objectKey: string }[]
  > {
    const rows = await this.db
      .select({
        key: idempotencyKeys.key,
        objectKey: idempotencyKeys.cleanupObjectKey,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.status, "expired"),
          sql`${idempotencyKeys.cleanupObjectKey} IS NOT NULL`,
        ),
      )
      .limit(limit);
    return rows.flatMap((r) =>
      r.objectKey ? [{ key: r.key, objectKey: r.objectKey }] : [],
    );
  }

  /** Live records that never completed and whose lease has lapsed (orphan sweep input). */
  async lapsedUploadLocators(
    now = new Date(),
    limit = 50,
  ): Promise<{ key: string; objectKey: string }[]> {
    const rows = await this.db
      .select({
        key: idempotencyKeys.key,
        objectKey: idempotencyKeys.cleanupObjectKey,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.status, "active"),
          eq(idempotencyKeys.executionState, "processing"),
          lte(idempotencyKeys.leaseExpiresAt, now),
          sql`${idempotencyKeys.cleanupObjectKey} IS NOT NULL`,
          isNull(idempotencyKeys.deletedAt),
        ),
      )
      .limit(limit);
    return rows.flatMap((r) =>
      r.objectKey ? [{ key: r.key, objectKey: r.objectKey }] : [],
    );
  }

  /** Hourly retained-expiry sweep. Idempotent, so concurrent instances are safe. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpired(): Promise<void> {
    try {
      await this.expireDueRecords();
    } catch (err) {
      this.logger.error(
        "idempotency expiry sweep failed",
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

/** Stable JSON with sorted object keys — property order must not change identity. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
