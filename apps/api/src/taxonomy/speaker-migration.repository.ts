import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  auditLedger,
  eventExperts,
  events,
  experts,
  speakerMigrationCutover,
  speakerMigrationReviews,
  type DrizzleHandle,
  type SpeakerMigrationReview,
} from "@ds/db";
import type {
  ResolveSpeakerMigrationReviewRequest,
  SpeakerMigrationReviewListQuery,
} from "@ds/schemas";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { TaxonomyError } from "./taxonomy.errors.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type SpeakerMigrationTx = Tx;

export interface ResolutionWrite {
  disposition: "existing_expert" | "created_expert" | "content_removed";
  expertId: string | null;
  eventExpertId: string | null;
  role: string | null;
  position: number | null;
  reviewerId: string;
  reviewedAt: Date;
}

@Injectable()
export class SpeakerMigrationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  async list(query: SpeakerMigrationReviewListQuery): Promise<{
    rows: SpeakerMigrationReview[];
    total: number;
  }> {
    const filters = [
      query.disposition
        ? eq(speakerMigrationReviews.disposition, query.disposition)
        : undefined,
      query.classification
        ? eq(
            speakerMigrationReviews.originalClassification,
            query.classification,
          )
        : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const where = filters.length > 0 ? and(...filters) : undefined;
    const offset = (query.page - 1) * query.pageSize;
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(speakerMigrationReviews)
        .where(where)
        .orderBy(
          asc(speakerMigrationReviews.createdAt),
          asc(speakerMigrationReviews.sourceSpeakerId),
        )
        .limit(query.pageSize)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(speakerMigrationReviews)
        .where(where),
    ]);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async find(sourceId: string): Promise<SpeakerMigrationReview | null> {
    const [row] = await this.db
      .select()
      .from(speakerMigrationReviews)
      .where(eq(speakerMigrationReviews.sourceSpeakerId, sourceId));
    return row ?? null;
  }

  async lockReview(
    tx: Tx,
    sourceId: string,
  ): Promise<SpeakerMigrationReview | null> {
    const [row] = await tx
      .select()
      .from(speakerMigrationReviews)
      .where(eq(speakerMigrationReviews.sourceSpeakerId, sourceId))
      .for("update");
    return row ?? null;
  }

  async lockExperts(tx: Tx, ids: string[]) {
    if (ids.length === 0) return [];
    return tx
      .select()
      .from(experts)
      .where(inArray(experts.id, [...new Set(ids)].sort()))
      .orderBy(asc(experts.id))
      .for("update");
  }

  async lockEvent(tx: Tx, eventId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    return Boolean(row);
  }

  async createExpert(
    tx: Tx,
    sourceId: string,
    input: Extract<
      ResolveSpeakerMigrationReviewRequest,
      { disposition: "created_expert" }
    >["expert"],
  ): Promise<string> {
    const [row] = await tx
      .insert(experts)
      .values({
        slug: `speaker-${sourceId}`,
        familyName: input.familyName,
        givenName: input.givenName,
        patronymic: input.patronymic ?? null,
        professionalRole: input.professionalRole ?? null,
      })
      .returning({ id: experts.id });
    if (!row) throw new Error("speaker migration expert insert returned no row");
    return row.id;
  }

  async createEventExpert(
    tx: Tx,
    input: {
      eventId: string;
      expertId: string;
      sourceId: string;
      role: string;
      position: number;
    },
  ): Promise<string> {
    const conflicts = await tx
      .select({ id: eventExperts.id })
      .from(eventExperts)
      .where(
        and(
          eq(eventExperts.eventId, input.eventId),
          sql`(${eventExperts.expertId} = ${input.expertId} OR ${eventExperts.legacySpeakerId} = ${input.sourceId} OR (${eventExperts.position} = ${input.position} AND ${eventExperts.status} = 'active'))`,
        ),
      )
      .limit(1);
    if (conflicts.length > 0) {
      throw new TaxonomyError(
        "SPEAKER_POSITION_OCCUPIED",
        "the selected expert, source row or event position is already linked",
      );
    }
    const [row] = await tx
      .insert(eventExperts)
      .values({
        eventId: input.eventId,
        expertId: input.expertId,
        legacySpeakerId: input.sourceId,
        role: input.role,
        position: input.position,
      })
      .returning({ id: eventExperts.id });
    if (!row) throw new Error("speaker migration event_expert insert returned no row");
    return row.id;
  }

  async resolve(
    tx: Tx,
    sourceId: string,
    write: ResolutionWrite,
    original: SpeakerMigrationReview,
  ): Promise<SpeakerMigrationReview> {
    const [row] = await tx
      .update(speakerMigrationReviews)
      .set({
        disposition: write.disposition,
        resolvedExpertId: write.expertId,
        eventExpertId: write.eventExpertId,
        resolvedRole: write.role,
        resolvedPosition: write.position,
        reviewerId: write.reviewerId,
        reviewedAt: write.reviewedAt,
        updatedAt: write.reviewedAt,
      })
      .where(
        and(
          eq(speakerMigrationReviews.sourceSpeakerId, sourceId),
          eq(speakerMigrationReviews.disposition, "unresolved"),
        ),
      )
      .returning();
    if (!row) {
      throw new TaxonomyError(
        "RELATIONSHIP_CONFLICT",
        "the migration review was already resolved",
      );
    }
    await tx.insert(auditLedger).values({
      eventId: randomUUID(),
      eventType: "SpeakerMigrationReviewResolved",
      subjectId: write.reviewerId,
      metadata: {
        sourceSpeakerId: original.sourceSpeakerId,
        eventId: original.eventId,
        sourcePosition: original.sourcePosition,
        contentFingerprint: original.contentFingerprint,
        originalClassification: original.originalClassification,
        disposition: write.disposition,
        resolvedExpertId: write.expertId,
        eventExpertId: write.eventExpertId,
        reviewerId: write.reviewerId,
        reviewedAt: write.reviewedAt.toISOString(),
      },
    });
    return row;
  }

  async isCutover(): Promise<boolean> {
    const [row] = await this.db
      .select({ status: speakerMigrationCutover.status })
      .from(speakerMigrationCutover)
      .where(eq(speakerMigrationCutover.id, "speaker_migration"));
    return row?.status === "cutover";
  }

  async completeCutover(tx: Tx, reviewerId: string) {
    const [state] = await tx
      .select()
      .from(speakerMigrationCutover)
      .where(eq(speakerMigrationCutover.id, "speaker_migration"))
      .for("update");
    if (!state) throw new Error("speaker migration cutover singleton missing");
    const [unresolvedRow] = await tx
      .select({ unresolved: count() })
      .from(speakerMigrationReviews)
      .where(eq(speakerMigrationReviews.disposition, "unresolved"));
    if (Number(unresolvedRow?.unresolved ?? 0) > 0) {
      throw new TaxonomyError(
        "RELATIONSHIP_CONFLICT",
        "speaker migration cutover requires every retained source row to be resolved",
      );
    }
    const [resolvedRow] = await tx
      .select({ resolved: count() })
      .from(speakerMigrationReviews)
      .where(inArray(speakerMigrationReviews.disposition, ["existing_expert", "created_expert"]));
    const [removedRow] = await tx
      .select({ removed: count() })
      .from(speakerMigrationReviews)
      .where(eq(speakerMigrationReviews.disposition, "content_removed"));
    const resolved = Number(resolvedRow?.resolved ?? 0);
    const removed = Number(removedRow?.removed ?? 0);
    if (state.status === "cutover") {
      return {
        resolved,
        contentRemoved: removed,
        completedAt: state.completedAt!,
      };
    }
    const completedAt = new Date();
    await tx
      .update(speakerMigrationCutover)
      .set({
        status: "cutover",
        completedBy: reviewerId,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(speakerMigrationCutover.id, "speaker_migration"));
    await tx.insert(auditLedger).values({
      eventId: randomUUID(),
      eventType: "SpeakerMigrationCutoverCompleted",
      subjectId: reviewerId,
      metadata: {
        resolved,
        contentRemoved: removed,
        completedAt: completedAt.toISOString(),
      },
    });
    return {
      resolved,
      contentRemoved: removed,
      completedAt,
    };
  }
}
