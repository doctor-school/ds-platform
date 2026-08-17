import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/index.js";
import { IdempotencyService } from "../idempotency.service.js";
import { MediaCleanupService } from "./media-cleanup.service.js";

// 012-design §6, third bullet — the QUIESCENT orphan reconciler, the counterpart
// of `MediaCleanupService`.
//
// The two are deliberately disjoint (§6: "Request takeover and orphan cleanup are
// disjoint"):
//
//   MediaCleanupService  — an object a COMMITTED domain change released
//                          (replace / clear). Its handle is a `media_cleanup_jobs`
//                          row created in the ref-swap transaction.
//   this service         — an object a request UPLOADED for a command that never
//                          committed (a stored refusal, a 503, a fenced-out owner).
//                          Its handle is `idempotency_keys.cleanup_object_key`.
//
// Without this sweep every refused-after-upload request would leak its canonical
// object forever and `cleanup_object_key` would never clear — the resource-leak
// class §6 exists to close. It never invokes a domain handler: it only retains the
// deterministic locator, waits for quiescence, rechecks references, deletes if
// needed and repeats until absence is acknowledged.

/**
 * How long after the request lease lapses the locator is left ALONE. §6 wants
 * "the lease expiry plus the provider's documented maximum in-flight-write
 * duration and clock-skew grace" — a late PUT from a superseded owner must have
 * landed (and become visible to a HEAD) before we judge the object orphaned,
 * otherwise the sweep would see absence, clear the locator, and the late write
 * would then leak with no handle left to find it.
 *
 * 15 minutes: S3-compatible stores document single-PUT timeouts in minutes, and
 * the grace only delays reclamation of already-unreferenced bytes — being generous
 * costs storage, being stingy costs a permanent leak.
 */
export const UPLOAD_QUIESCENCE_GRACE_MS = 15 * 60 * 1000;

@Injectable()
export class UploadReconcileService {
  private readonly logger = new Logger(UploadReconcileService.name);

  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(MediaCleanupService)
    private readonly cleanup: MediaCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Reconcile one bounded batch of quiescent upload locators. Returns how many
   * locators reached the cleared state (absence acknowledged, or the object is
   * legitimately referenced so there is nothing to reclaim).
   *
   * A locator whose object is still present after a delete attempt is left in
   * place on purpose — the next sweep retries it. "Cleared without proof of
   * absence" is exactly the silent leak this guards against.
   *
   * Every row is acted on under a STOLEN lease, never on the due-read alone: the
   * read is stale by definition and a due row can still be takeover-eligible
   * (`processing`, lease lapsed). Losing the CAS means a retry owns the record —
   * it wins, the sweep skips the row untouched, and the locator survives for a
   * later sweep should that attempt fail too. This is what makes takeover and
   * cleanup disjoint (§6) instead of merely unlikely to collide.
   */
  async reconcileDueLocators(now = new Date(), limit = 50): Promise<number> {
    const cutoff = new Date(now.getTime() - UPLOAD_QUIESCENCE_GRACE_MS);
    const due = await this.idempotency.quiescentUploadLocators(cutoff, limit);
    let cleared = 0;
    for (const record of due) {
      try {
        const stolen = await this.idempotency.stealUploadLocatorLease({
          key: record.key,
          leaseEpoch: record.leaseEpoch,
          cutoff,
        });
        if (!stolen) {
          this.logger.log(
            `upload locator of record ${record.key} is owned by a newer lease; leaving it to that owner`,
          );
          continue;
        }
        // Under the stolen epoch: quiescence was re-asserted by the CAS itself,
        // the reference check below runs on the locator the stolen row carried,
        // and the clear is fenced on the same epoch.
        if (await this.reconcileOne(stolen.objectKey)) {
          if (
            await this.idempotency.clearReclaimedLocator(
              record.key,
              stolen.leaseEpoch,
            )
          ) {
            cleared += 1;
          } else {
            this.logger.warn(
              `locator clear for record ${record.key} was fenced out at epoch ${stolen.leaseEpoch}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `upload locator of record ${record.key} could not be reconciled; retrying on the next sweep: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (cleared > 0) {
      this.logger.log(`reconciled ${cleared} quiescent upload locator(s)`);
    }
    return cleared;
  }

  /** `true` once the locator may be cleared. */
  private async reconcileOne(objectKey: string): Promise<boolean> {
    // A referenced object belongs to the domain now — the command committed and
    // the upload is no orphan. Clear the locator, delete NOTHING: deleting here
    // would blank a live cover, the worst outcome this sweep could produce.
    if (await this.cleanup.isObjectReferenced(objectKey)) return true;

    // Absence already acknowledged (e.g. the PUT itself failed) — nothing to do.
    if (!(await this.storage.exists(objectKey))) return true;

    await this.storage.delete(objectKey);
    // Re-HEAD: the provider must ACKNOWLEDGE absence. An accepted delete that
    // still serves the object is precisely the case a "deleted, done" assumption
    // would turn into a silent leak.
    if (await this.storage.exists(objectKey)) {
      this.logger.warn(
        `object ${objectKey} is still present after delete; leaving the locator for the next sweep`,
      );
      return false;
    }
    return true;
  }

  /**
   * Periodic drain. Every step is idempotent and reference-checked, so concurrent
   * instances are safe; the interval is longer than the cleanup worker's because
   * this queue only fills on refusals and faults.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    try {
      await this.reconcileDueLocators();
    } catch (err) {
      this.logger.error(
        "upload-locator reconciliation sweep failed",
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
