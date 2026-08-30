import { Inject, Injectable } from "@nestjs/common";
import type {
  ResolveSpeakerMigrationReviewRequest,
  SpeakerMigrationCutoverResult,
  SpeakerMigrationReviewItem,
  SpeakerMigrationReviewList,
  SpeakerMigrationReviewListQuery,
} from "@ds/schemas";
import type { SpeakerMigrationReview } from "@ds/db";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";
import { SpeakerMigrationRepository } from "./speaker-migration.repository.js";

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

  isCutover(): Promise<boolean> {
    return this.repo.isCutover();
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
        let expertId: string | null = null;
        if (input.payload.disposition === "existing_expert") {
          const [expert] = await this.repo.lockExperts(tx, [input.payload.expertId]);
          if (!expert || expert.contentRemovedAt || expert.status === "retired") {
            throw new TaxonomyError("RESOURCE_NOT_FOUND");
          }
          expertId = expert.id;
        } else if (input.payload.disposition === "created_expert") {
          expertId = await this.repo.createExpert(
            tx,
            input.sourceId,
            input.payload.expert,
          );
        }
        if (!(await this.repo.lockEvent(tx, seed.eventId))) {
          throw new TaxonomyError("RESOURCE_NOT_FOUND");
        }
        const current = await this.repo.lockReview(tx, input.sourceId);
        if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
        if (current.disposition !== "unresolved") {
          const same =
            current.disposition === input.payload.disposition &&
            (input.payload.disposition === "content_removed" ||
              (current.resolvedExpertId === expertId &&
                current.resolvedRole === input.payload.role &&
                current.resolvedPosition === input.payload.position));
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

  async cutover(input: {
    reviewerId: string;
    lease: IdempotencyLease;
  }): Promise<SpeakerMigrationCutoverResult> {
    try {
      return await this.repo.transaction(async (tx) => {
        const result = await this.repo.completeCutover(tx, input.reviewerId);
        const body: SpeakerMigrationCutoverResult = {
          status: "cutover",
          resolved: result.resolved,
          contentRemoved: result.contentRemoved,
          completedAt: result.completedAt.toISOString(),
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
