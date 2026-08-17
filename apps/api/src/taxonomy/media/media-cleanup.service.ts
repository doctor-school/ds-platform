import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, lte, or, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { mediaCleanupJobs, projects } from "@ds/db";
import { DRIZZLE_DB } from "../../database/database.tokens.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/index.js";

// 012-design §5.1 — the durable old-reference cleanup obligation and its leased
// worker.
//
// The split that matters: a committed media replace/clear MUST NOT be rolled
// back because object storage is unavailable. The domain change is what the
// operator asked for; deleting the superseded object is a separate, durable
// obligation. So the ref-swap transaction inserts one `active`/`pending` job
// (same transaction — an obligation that can be lost is not an obligation), and
// this worker finishes it afterwards, retrying until both providers acknowledge
// absence.
//
// Fencing: a worker CAS-acquires a NEWER `lease_epoch` before touching a
// provider, and completion matches on owner + epoch. A stale owner's late
// completion updates zero rows, so it can never declare cleanup done for work a
// newer owner is still doing.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** How long an acquired job stays leased before another worker may take it. */
export const CLEANUP_LEASE_MS = 5 * 60 * 1000;

export interface CleanupJobInput {
  cleanupKind: "replace" | "clear" | "content_removal";
  entityKind: "project" | "expert" | "partner";
  entityId: string;
  slot: "cover" | "photo" | "logo";
  /** The RELEASED object key — the one that must eventually disappear. */
  objectKey: string;
  /** CDN key/path to purge or invalidate; equal to the object key by default. */
  cdnKey?: string;
}

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Enqueue the obligation INSIDE the caller's ref-swap transaction. Never call
   * this outside that transaction: a job without its ref change would delete a
   * live object, and a ref change without its job would leak one forever.
   */
  async enqueue(tx: Tx | Db, input: CleanupJobInput): Promise<string> {
    const [row] = await tx
      .insert(mediaCleanupJobs)
      .values({
        cleanupKind: input.cleanupKind,
        entityKind: input.entityKind,
        entityId: input.entityId,
        slot: input.slot,
        objectKey: input.objectKey,
        cdnKey: input.cdnKey ?? input.objectKey,
        status: "active",
        executionState: "pending",
      })
      .returning({ id: mediaCleanupJobs.id });
    if (!row) throw new Error("media cleanup job insert returned no row");
    return row.id;
  }

  /**
   * Run one bounded batch of due jobs. Returns how many reached the terminal
   * cleared shape. Safe to run concurrently on several instances — every step is
   * a fenced CAS.
   */
  async runDueJobs(limit = 10, now = new Date()): Promise<number> {
    const owner = randomUUID();
    const due = await this.db
      .select({
        id: mediaCleanupJobs.id,
        leaseEpoch: mediaCleanupJobs.leaseEpoch,
      })
      .from(mediaCleanupJobs)
      .where(
        and(
          eq(mediaCleanupJobs.status, "active"),
          or(
            eq(mediaCleanupJobs.executionState, "pending"),
            and(
              eq(mediaCleanupJobs.executionState, "processing"),
              lte(mediaCleanupJobs.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .limit(limit);

    let completed = 0;
    for (const job of due) {
      if (await this.processOne(job.id, job.leaseEpoch, owner, now)) {
        completed += 1;
      }
    }
    return completed;
  }

  /**
   * Acquire → recheck references → delete every version/derivative → purge the
   * CDN key → complete under the matching owner+epoch. Any provider failure
   * records an ENUM-only error and leaves the job active for a later attempt:
   * the obligation is never dropped, and the row never accumulates free-text
   * provider output.
   */
  private async processOne(
    id: string,
    observedEpoch: number,
    owner: string,
    now: Date,
  ): Promise<boolean> {
    const nextEpoch = observedEpoch + 1;
    const [acquired] = await this.db
      .update(mediaCleanupJobs)
      .set({
        executionState: "processing",
        leaseEpoch: nextEpoch,
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS),
        attemptCount: sql`${mediaCleanupJobs.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaCleanupJobs.id, id),
          eq(mediaCleanupJobs.leaseEpoch, observedEpoch),
          eq(mediaCleanupJobs.status, "active"),
        ),
      )
      .returning();
    // Lost the race — another worker owns a newer epoch. Not an error.
    if (!acquired?.objectKey) return false;

    const objectKey = acquired.objectKey;
    // Re-check every CURRENT media reference before deleting. An operator can
    // have re-pointed the row back at this key between enqueue and now; deleting
    // it then would break a live public projection.
    if (await this.isObjectReferenced(objectKey)) {
      await this.recordFailure(id, nextEpoch, owner, "still_referenced");
      return false;
    }

    try {
      await this.storage.delete(objectKey);
      if (acquired.cdnKey && acquired.cdnKey !== objectKey) {
        await this.storage.delete(acquired.cdnKey);
      }
      // Absence must be ACKNOWLEDGED, not assumed: a store that accepted the
      // delete but still serves the object is exactly the case that would leave
      // a "removed" cover publicly reachable.
      if (await this.storage.exists(objectKey)) {
        await this.recordFailure(id, nextEpoch, owner, "object_storage_unavailable");
        return false;
      }
    } catch (err) {
      this.logger.warn(
        `media cleanup job ${id} could not delete its object; retrying later: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.recordFailure(id, nextEpoch, owner, "object_storage_unavailable");
      return false;
    }

    const [done] = await this.db
      .update(mediaCleanupJobs)
      .set({
        status: "expired",
        executionState: "completed",
        deletedAt: now,
        completedAt: now,
        objectKey: null,
        cdnKey: null,
        entityId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaCleanupJobs.id, id),
          eq(mediaCleanupJobs.leaseEpoch, nextEpoch),
          eq(mediaCleanupJobs.leaseOwner, owner),
          eq(mediaCleanupJobs.status, "active"),
        ),
      )
      .returning({ id: mediaCleanupJobs.id });
    // A zero-row fencing update cannot declare cleanup complete (§5.1).
    return Boolean(done);
  }

  /**
   * Whether any current domain row still references `objectKey`. #1283 owns the
   * `projects.cover_ref` slot; #1284/#1286 extend this predicate with
   * `experts.photo_ref` and `partners.logo_ref` when those columns land.
   *
   * PUBLIC because `UploadReconcileService` asks the same question about a
   * different handle (an upload locator rather than a cleanup job). Keeping ONE
   * predicate means a new media slot cannot be taught to one sweep and forgotten
   * in the other — which would let that sweep delete a live object.
   */
  async isObjectReferenced(objectKey: string): Promise<boolean> {
    const [hit] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.coverRef, objectKey))
      .limit(1);
    return Boolean(hit);
  }

  private async recordFailure(
    id: string,
    epoch: number,
    owner: string,
    error: "object_storage_unavailable" | "cdn_unavailable" | "still_referenced",
  ): Promise<void> {
    await this.db
      .update(mediaCleanupJobs)
      .set({
        executionState: "pending",
        lastError: error,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaCleanupJobs.id, id),
          eq(mediaCleanupJobs.leaseEpoch, epoch),
          eq(mediaCleanupJobs.leaseOwner, owner),
        ),
      );
  }

  /** Periodic drain. Best-effort immediate cleanup never replaces this. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    try {
      await this.runDueJobs();
    } catch (err) {
      this.logger.error(
        "media cleanup sweep failed",
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
