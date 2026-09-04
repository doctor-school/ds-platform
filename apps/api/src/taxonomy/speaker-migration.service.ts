import { Inject, Injectable } from "@nestjs/common";
import type {
  ImportSpeakerMigrationReviewsRequest,
  RecordPhaseAwareReleaseRequest,
  ResolveSpeakerMigrationReviewRequest,
  SpeakerMigrationCutoverResult,
  SpeakerMigrationImportResult,
  SpeakerMigrationReviewItem,
  SpeakerMigrationReviewList,
  SpeakerMigrationReviewListQuery,
  SpeakerMigrationState,
} from "@ds/schemas";
import type { SpeakerMigrationReview } from "@ds/db";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";
import { SpeakerMigrationRepository } from "./speaker-migration.repository.js";

/**
 * 012 EARS-24 (#1607) — the legacy-speaker migration review queue and the
 * guarded cutover command.
 *
 * THE ONE RULE THAT SHAPES THIS WHOLE FILE: nothing here derives identity. No
 * name is read, compared, normalized or fuzzy-matched; no Expert or User record
 * is proposed; no candidate list is generated. Classification arrives from an
 * owner-reviewed artifact, resolution arrives from an explicit operator choice,
 * and the only thing the code contributes is validation, ordering and atomicity.
 */
@Injectable()
export class SpeakerMigrationService {
  constructor(
    @Inject(SpeakerMigrationRepository)
    private readonly repo: SpeakerMigrationRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(
    query: SpeakerMigrationReviewListQuery,
  ): Promise<SpeakerMigrationReviewList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(toItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async state(): Promise<SpeakerMigrationState> {
    const row = await this.repo.state();
    return {
      phase: row.phase,
      version: row.version,
      phaseAwareReleaseSha: row.phaseAwareReleaseSha,
      phaseAwareReleaseOrdinal: row.phaseAwareReleaseOrdinal,
      minimumCompatibleReleaseSha: row.minimumCompatibleReleaseSha,
      minimumCompatibleReleaseOrdinal: row.minimumCompatibleReleaseOrdinal,
      phaseAdvancedAt: row.phaseAdvancedAt?.toISOString() ?? null,
        sourceImportCompletedAt:
          row.sourceImportCompletedAt?.toISOString() ?? null,
    };
  }

  /** Phase-aware read branch used by the legacy write/read seams. */
  isSourceClosed(): Promise<boolean> {
    return this.repo.isSourceClosed();
  }

  /**
   * Import the owner-reviewed classification artifact (design §2.3).
   *
   * The ORDER of the steps below is the requirement, not an implementation
   * detail. Validation compares the RAW ordered rows against the source set and
   * fails closed on a missing, repeated or extra source UUID *before* any keyed
   * UUID map is materialized and *before* a single queue, domain or audit row is
   * written. A keyed map built first would silently collapse a repeated UUID
   * into last-one-wins — the precise defect the artifact review exists to catch.
   */
  async importReviewedRows(input: {
    payload: ImportSpeakerMigrationReviewsRequest;
    actorId: string;
    lease: IdempotencyLease;
  }): Promise<SpeakerMigrationImportResult> {
    try {
      return await this.repo.transaction(async (tx) => {
        // The same singleton lock the fence trigger takes: while it is held no
        // legacy INSERT can commit, so the source set the validation sees is the
        // source set the insert writes against.
        const state = await this.repo.lockState(tx);
        if (state.phase !== "review_open") {
          throw new TaxonomyError(
            "SPEAKER_MIGRATION_SOURCE_IMMUTABLE",
            "the legacy speaker source set is already closed",
          );
        }
        // The import marker, not the row count, answers "already imported":
        // it is true even for a source set that was empty at import time, and
        // it is the same fact the enqueue trigger gates on.
        if (state.sourceImportCompletedAt !== null) {
          throw new TaxonomyError(
            "RELATIONSHIP_CONFLICT",
            "the migration review queue has already been imported",
          );
        }

        const rows = input.payload.reviewedRows;
        const sourceIds = await this.repo.allSourceIds(tx);
        assertExactCoverage(rows, sourceIds);

        const inserted = await this.repo.insertReviews(tx, rows);
        if (inserted !== sourceIds.length) {
          // Unreachable given the validation above; kept because a silent
          // partial import is the one failure this command must never produce.
          throw new TaxonomyError(
            "RELATIONSHIP_CONFLICT",
            "the migration import did not queue every retained source row",
          );
        }
        // Arm the enqueue trigger in the SAME transaction as the reviewed rows:
        // from here a legacy INSERT joins the queue, and there is no committed
        // state in which the queue exists but new rows escape it.
        await this.repo.markSourceImported(tx, state.id);
        const counts = await this.repo.classificationCounts(tx);
        const result: SpeakerMigrationImportResult = {
          imported: inserted,
          ...counts,
        };
        await this.repo.recordImportAudit(tx, input.actorId, result);
        await this.idempotency.complete(tx, input.lease, {
          status: 200,
          body: result,
        });
        return result;
      });
    } catch (error) {
      throw markReplayable(error, input.lease);
    }
  }

  async recordPhaseAwareRelease(input: {
    payload: RecordPhaseAwareReleaseRequest;
    actorId: string;
    lease: IdempotencyLease;
  }): Promise<SpeakerMigrationState> {
    try {
      return await this.repo.transaction(async (tx) => {
        const row = await this.repo.recordPhaseAwareRelease(tx, {
          releaseSha: input.payload.releaseSha,
          releaseOrdinal: input.payload.releaseOrdinal,
          actorId: input.actorId,
        });
        const body: SpeakerMigrationState = {
          phase: row.phase,
          version: row.version,
          phaseAwareReleaseSha: row.phaseAwareReleaseSha,
          phaseAwareReleaseOrdinal: row.phaseAwareReleaseOrdinal,
          minimumCompatibleReleaseSha: row.minimumCompatibleReleaseSha,
          minimumCompatibleReleaseOrdinal: row.minimumCompatibleReleaseOrdinal,
          phaseAdvancedAt: row.phaseAdvancedAt?.toISOString() ?? null,
        sourceImportCompletedAt:
          row.sourceImportCompletedAt?.toISOString() ?? null,
        };
        await this.idempotency.complete(tx, input.lease, {
          status: 200,
          body,
        });
        return body;
      });
    } catch (error) {
      throw markReplayable(error, input.lease);
    }
  }

  async resolve(input: {
    sourceId: string;
    payload: ResolveSpeakerMigrationReviewRequest;
    reviewerId: string;
    lease: IdempotencyLease;
  }): Promise<SpeakerMigrationReviewItem> {
    try {
      const seed = await this.repo.find(input.sourceId);
      if (!seed) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const result = await this.repo.transaction(async (tx) => {
        const state = await this.repo.lockState(tx);
        if (state.phase !== "review_open") {
          throw new TaxonomyError(
            "SPEAKER_MIGRATION_SOURCE_IMMUTABLE",
            "the legacy speaker source set is closed; reviews are terminal",
          );
        }
        // §6 shared invariant protocol: experts first, then the parent event,
        // then the review row.
        let expertId: string | null = null;
        if (input.payload.disposition === "existing_expert") {
          const [expert] = await this.repo.lockExperts(tx, [
            input.payload.expertId,
          ]);
          // An Expert linked to ANOTHER event stays eligible — the only refusal
          // EARS-24 names is the retained duplicate pair, enforced below.
          if (!expert || expert.contentRemovedAt) {
            throw new TaxonomyError("RESOURCE_NOT_FOUND");
          }
          expertId = expert.id;
        }
        if (!(await this.repo.lockEvent(tx, seed.eventId))) {
          throw new TaxonomyError("RESOURCE_NOT_FOUND");
        }
        const current = await this.repo.lockReview(tx, input.sourceId);
        if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
        if (current.disposition !== "unresolved") {
          // Terminal. An identical replay answers the stored row; anything else
          // is a conflict — the disposition trigger would refuse it anyway.
          const same =
            current.disposition === input.payload.disposition &&
            (input.payload.disposition === "content_removed" ||
              (current.resolvedRole === input.payload.role &&
                current.resolvedPosition === input.payload.position &&
                (input.payload.disposition !== "existing_expert" ||
                  current.resolvedExpertId === input.payload.expertId)));
          if (!same) {
            throw new TaxonomyError(
              "RELATIONSHIP_CONFLICT",
              "the migration review already has a different terminal resolution",
            );
          }
          await this.idempotency.complete(tx, input.lease, {
            status: 200,
            body: toItem(current),
          });
          return current;
        }

        // Creating the Expert happens only after the review row is proven
        // unresolved, so a rejected resolution leaves no orphan Expert behind.
        if (input.payload.disposition === "created_expert") {
          expertId = await this.repo.createExpert(
            tx,
            input.sourceId,
            input.payload.expert,
          );
        }

        let eventExpertId: string | null = null;
        let role: string | null = null;
        let position: number | null = null;
        if (input.payload.disposition !== "content_removed") {
          role = input.payload.role;
          position = input.payload.position;
          eventExpertId = await this.repo.createEventExpert(tx, {
            eventId: current.eventId,
            expertId: expertId!,
            sourceId: current.sourceSpeakerId,
            role: input.payload.role,
            position: input.payload.position,
          });
        }
        const reviewed = await this.repo.resolve(
          tx,
          input.sourceId,
          {
            disposition: input.payload.disposition,
            expertId,
            eventExpertId,
            role,
            position,
            reviewerId: input.reviewerId,
            reviewedAt: new Date(),
          },
          current,
        );
        await this.idempotency.complete(tx, input.lease, {
          status: 200,
          body: toItem(reviewed),
        });
        return reviewed;
      });
      return toItem(result);
    } catch (error) {
      throw markReplayable(error, input.lease);
    }
  }

  /**
   * Design §2.3 stage 2 — the serializable source-closure transaction.
   *
   * It locks the singleton, proves EXACT source↔queue coverage (every retained
   * source row has a review, and every review names a retained source row —
   * neither direction alone is enough), proves every review is terminal, copies
   * the phase-aware release pair into the rollback floor and advances the phase.
   * All of that is one transaction: any unresolved source, missing review or
   * concurrently inserted source row leaves phase, floor and projection exactly
   * as they were.
   */
  async closeSource(input: {
    actorId: string;
    lease: IdempotencyLease;
  }): Promise<SpeakerMigrationCutoverResult> {
    try {
      return await this.repo.serializableTransaction(async (tx) => {
        const state = await this.repo.lockState(tx);
        if (state.phase === "source_closed") {
          throw new TaxonomyError(
            "SPEAKER_MIGRATION_SOURCE_IMMUTABLE",
            "the legacy speaker source set is already closed",
          );
        }
        if (
          state.phaseAwareReleaseSha === null ||
          state.phaseAwareReleaseOrdinal === null
        ) {
          // Fail closed. Advancing without a floor is what would let
          // `deploy:prod --rollback` put a pre-expand image back on a closed
          // database; the CHECK constraint refuses it too, less legibly.
          throw new TaxonomyError(
            "PRECONDITION_REQUIRED",
            "the expand release must record its phase-aware SHA/ordinal before source closure",
          );
        }

        const sourceIds = await this.repo.allSourceIds(tx);
        const queued = await this.repo.countReviews(tx);
        if (queued !== sourceIds.length) {
          throw new TaxonomyError(
            "RELATIONSHIP_CONFLICT",
            `source↔queue coverage is not exact: ${sourceIds.length} retained source rows, ${queued} reviews`,
          );
        }
        const unresolved = await this.repo.countUnresolved(tx);
        if (unresolved > 0) {
          throw new TaxonomyError(
            "RELATIONSHIP_CONFLICT",
            `${unresolved} retained source rows are still unresolved`,
          );
        }

        const resolvedSources = await this.repo.countByDisposition(tx, [
          "existing_expert",
          "created_expert",
        ]);
        const contentRemoved = await this.repo.countByDisposition(tx, [
          "content_removed",
        ]);
        const phaseAdvancedAt = new Date();
        await this.repo.advanceToSourceClosed(tx, {
          id: state.id,
          sha: state.phaseAwareReleaseSha,
          ordinal: state.phaseAwareReleaseOrdinal,
          phaseAdvancedAt,
          actorId: input.actorId,
          resolvedSources,
          contentRemoved,
        });
        const body: SpeakerMigrationCutoverResult = {
          phase: "source_closed",
          resolvedSources,
          contentRemoved,
          minimumCompatibleReleaseSha: state.phaseAwareReleaseSha,
          minimumCompatibleReleaseOrdinal: state.phaseAwareReleaseOrdinal,
          phaseAdvancedAt: phaseAdvancedAt.toISOString(),
        };
        await this.idempotency.complete(tx, input.lease, {
          status: 200,
          body,
        });
        return body;
      });
    } catch (error) {
      throw markReplayable(error, input.lease);
    }
  }
}

/**
 * Compare the RAW ordered artifact rows with the retained source set. Runs
 * before any keyed map exists, and throws before any write.
 *
 * Three independent defects, reported separately because they mean different
 * things to whoever produced the artifact: a source row nobody classified, the
 * same source row classified twice, and a UUID that is not a source row at all.
 */
function assertExactCoverage(
  rows: readonly { sourceId: string; classification: string }[],
  sourceIds: readonly string[],
): void {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const row of rows) {
    if (seen.has(row.sourceId)) repeated.push(row.sourceId);
    else seen.add(row.sourceId);
  }
  const sources = new Set(sourceIds);
  const extra = [...seen].filter((id) => !sources.has(id)).sort();
  const missing = sourceIds.filter((id) => !seen.has(id));

  if (repeated.length === 0 && extra.length === 0 && missing.length === 0) {
    return;
  }
  throw new TaxonomyError(
    "VALIDATION_FAILED",
    "the reviewed classification list does not exactly cover the retained source set",
    [
      ...missing.map((id) => ({
        path: "reviewedRows",
        message: `missing source ${id}`,
      })),
      ...[...new Set(repeated)].sort().map((id) => ({
        path: "reviewedRows",
        message: `repeated source ${id}`,
      })),
      ...extra.map((id) => ({
        path: "reviewedRows",
        message: `extra source ${id}`,
      })),
    ],
  );
}

function toItem(row: SpeakerMigrationReview): SpeakerMigrationReviewItem {
  return {
    sourceId: row.sourceSpeakerId,
    eventId: row.eventId,
    sourcePosition: row.sourcePosition,
    sourceName: row.sourceName,
    sourceRegalia: row.sourceRegalia,
    contentFingerprint: row.contentFingerprint,
    originalClassification: row.originalClassification,
    disposition: row.disposition,
    resolvedExpertId: row.resolvedExpertId,
    eventExpertId: row.eventExpertId,
    resolvedRole: row.resolvedRole,
    resolvedPosition: row.resolvedPosition,
    reviewerId: row.reviewerId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
