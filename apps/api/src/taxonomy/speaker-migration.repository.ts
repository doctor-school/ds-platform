import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import {
  auditLedger,
  eventExperts,
  events,
  eventSpeakers,
  experts,
  speakerMigrationCutover,
  speakerMigrationReviews,
  type DrizzleHandle,
  type SpeakerMigrationCutover,
  type SpeakerMigrationReview,
} from "@ds/db";
import type {
  ResolveSpeakerMigrationReviewRequest,
  SpeakerMigrationClassification,
  SpeakerMigrationReviewedRow,
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

export interface ImportCounts {
  imported: number;
  unmatched: number;
  ambiguous: number;
  duplicate: number;
}

/**
 * 012 EARS-24 (#1607) — persistence for the legacy-speaker review queue and the
 * guarded cutover.
 *
 * The cutover SSOT (`speaker_migration_cutover`), the `event_speakers` fence
 * trigger and the rollback-floor guard are #1633's and are CONSUMED here: this
 * repository reads the phase from that singleton and copies its phase-aware
 * release pair into the floor, but never re-declares any of them.
 */
@Injectable()
export class SpeakerMigrationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /**
   * The closure transaction is `SERIALIZABLE` because it must PROVE a set
   * property — exact source↔queue coverage — and then act on that proof. Under
   * a weaker level a source row inserted concurrently would be invisible to the
   * proof and committed after it, producing exactly the "closed set that is not
   * closed" state design §2.3 stage 2 forbids.
   */
  serializableTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn, {
      isolationLevel: "serializable",
    });
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

  /** The #1633 singleton, read without a lock — for phase-aware READ branches. */
  async state(): Promise<SpeakerMigrationCutover> {
    const [row] = await this.db.select().from(speakerMigrationCutover);
    if (!row) {
      // Fail closed, exactly as the fence trigger does: an unknowable phase must
      // never read as "open".
      throw new Error("speaker_migration_cutover singleton is missing");
    }
    return row;
  }

  /** The same singleton under `FOR UPDATE` — the fence trigger takes this lock too. */
  async lockState(tx: Tx): Promise<SpeakerMigrationCutover> {
    const [row] = await tx.select().from(speakerMigrationCutover).for("update");
    if (!row) throw new Error("speaker_migration_cutover singleton is missing");
    return row;
  }

  /** Every retained source row, in a stable order. No eligibility filter: a
   * content-removed row is a review disposition, never a reason to drop a row
   * from provenance (design §2.3). */
  async allSourceIds(tx: Tx): Promise<string[]> {
    const rows = await tx
      .select({ id: eventSpeakers.id })
      .from(eventSpeakers)
      .orderBy(asc(eventSpeakers.id));
    return rows.map((r) => r.id);
  }

  /**
   * Insert one review per reviewed row, taking `original_classification` from
   * the artifact and every provenance column from the source row itself. The
   * fingerprint comes from the SAME SQL function the enqueue trigger uses, so
   * an imported row and a later inserted row are fingerprinted identically.
   */
  async insertReviews(
    tx: Tx,
    rows: readonly SpeakerMigrationReviewedRow[],
  ): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
      const result = await tx.execute(sql`
        INSERT INTO speaker_migration_reviews (
          source_speaker_id, event_id, source_position, source_name,
          source_regalia, content_fingerprint, original_classification,
          disposition
        )
        SELECT s.id, s.event_id, s.position, s.name, s.regalia,
               speaker_migration_content_fingerprint(s.name, s.regalia),
               ${row.classification}::speaker_migration_classification,
               'unresolved'
        FROM event_speakers s
        WHERE s.id = ${row.sourceId}
      `);
      inserted += Number((result as { rowCount?: number }).rowCount ?? 0);
    }
    return inserted;
  }

  /**
   * Stamp `source_import_completed_at` on the singleton — the moment the review
   * queue OPENS. Runs inside the import transaction, under the same singleton
   * lock the fence takes, so no legacy INSERT can slip between the reviewed
   * rows landing and the enqueue trigger arming.
   */
  async markSourceImported(tx: Tx, id: string): Promise<void> {
    await tx
      .update(speakerMigrationCutover)
      .set({ sourceImportCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(speakerMigrationCutover.id, id));
  }

  async countReviews(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(speakerMigrationReviews);
    return Number(row?.value ?? 0);
  }

  async recordImportAudit(
    tx: Tx,
    actorId: string,
    counts: ImportCounts,
  ): Promise<void> {
    await tx.insert(auditLedger).values({
      eventId: randomUUID(),
      eventType: "SpeakerMigrationQueueImported",
      subjectId: actorId,
      metadata: { ...counts, importedBy: actorId },
    });
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

  /**
   * Create the Expert the operator explicitly authored. The slug is derived from
   * the SOURCE ROW ID, never from the typed name: a name-derived slug would be
   * the one place in this feature where two speakers with the same spelling
   * collide, i.e. an identity inference by the back door.
   */
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

  /**
   * The ONLY refusal the spec names is the retained duplicate pair
   * `(event_id, expert_id)` — an Expert already linked to ANOTHER event stays
   * eligible, so no expert-level eligibility check belongs here. The position
   * clash is a separate, ordinary `SPEAKER_POSITION_OCCUPIED` invariant of
   * `event_experts` itself.
   */
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
    const duplicatePair = await tx
      .select({ id: eventExperts.id })
      .from(eventExperts)
      .where(
        and(
          eq(eventExperts.eventId, input.eventId),
          eq(eventExperts.expertId, input.expertId),
        ),
      )
      .limit(1);
    if (duplicatePair.length > 0) {
      throw new TaxonomyError(
        "RELATIONSHIP_CONFLICT",
        "this event already has a retained link to the selected expert",
      );
    }
    const positionTaken = await tx
      .select({ id: eventExperts.id })
      .from(eventExperts)
      .where(
        and(
          eq(eventExperts.eventId, input.eventId),
          eq(eventExperts.position, input.position),
          eq(eventExperts.status, "active"),
        ),
      )
      .limit(1);
    if (positionTaken.length > 0) {
      throw new TaxonomyError(
        "SPEAKER_POSITION_OCCUPIED",
        "the requested event position is already occupied",
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
    if (!row) {
      throw new Error("speaker migration event_expert insert returned no row");
    }
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

  /** Phase-aware READ branch: `true` once the legacy source set is closed. */
  async isSourceClosed(): Promise<boolean> {
    const [row] = await this.db
      .select({ phase: speakerMigrationCutover.phase })
      .from(speakerMigrationCutover);
    if (!row) throw new Error("speaker_migration_cutover singleton is missing");
    return row.phase === "source_closed";
  }

  async recordPhaseAwareRelease(
    tx: Tx,
    input: { releaseSha: string; releaseOrdinal: number; actorId: string },
  ): Promise<SpeakerMigrationCutover> {
    const current = await this.lockState(tx);
    if (
      current.phaseAwareReleaseSha !== null &&
      (current.phaseAwareReleaseSha !== input.releaseSha ||
        current.phaseAwareReleaseOrdinal !== input.releaseOrdinal)
    ) {
      throw new TaxonomyError(
        "RELATIONSHIP_CONFLICT",
        "a different phase-aware release pair is already recorded",
      );
    }
    if (current.phaseAwareReleaseSha === input.releaseSha) return current;
    const [row] = await tx
      .update(speakerMigrationCutover)
      .set({
        phaseAwareReleaseSha: input.releaseSha,
        phaseAwareReleaseOrdinal: input.releaseOrdinal,
      })
      .where(eq(speakerMigrationCutover.id, current.id))
      .returning();
    if (!row) throw new Error("phase-aware release update returned no row");
    return row;
  }

  async countUnresolved(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(speakerMigrationReviews)
      .where(eq(speakerMigrationReviews.disposition, "unresolved"));
    return Number(row?.value ?? 0);
  }

  async countByDisposition(
    tx: Tx,
    dispositions: ("existing_expert" | "created_expert" | "content_removed")[],
  ): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(speakerMigrationReviews)
      .where(inArray(speakerMigrationReviews.disposition, dispositions));
    return Number(row?.value ?? 0);
  }

  /** Advance the phase and install the floor in ONE update — the
   * `closed_requires_floor` CHECK makes any other order unrepresentable. */
  async advanceToSourceClosed(
    tx: Tx,
    input: {
      id: string;
      sha: string;
      ordinal: number;
      phaseAdvancedAt: Date;
      actorId: string;
      resolvedSources: number;
      contentRemoved: number;
    },
  ): Promise<void> {
    const [row] = await tx
      .update(speakerMigrationCutover)
      .set({
        phase: "source_closed",
        minimumCompatibleReleaseSha: input.sha,
        minimumCompatibleReleaseOrdinal: input.ordinal,
        phaseAdvancedAt: input.phaseAdvancedAt,
      })
      .where(
        and(
          eq(speakerMigrationCutover.id, input.id),
          eq(speakerMigrationCutover.phase, "review_open"),
        ),
      )
      .returning({ id: speakerMigrationCutover.id });
    if (!row) {
      throw new TaxonomyError(
        "RELATIONSHIP_CONFLICT",
        "the speaker migration phase changed while closure was running",
      );
    }
    await tx.insert(auditLedger).values({
      eventId: randomUUID(),
      eventType: "SpeakerMigrationSourceClosed",
      subjectId: input.actorId,
      metadata: {
        minimumCompatibleReleaseSha: input.sha,
        minimumCompatibleReleaseOrdinal: input.ordinal,
        resolvedSources: input.resolvedSources,
        contentRemoved: input.contentRemoved,
        phaseAdvancedAt: input.phaseAdvancedAt.toISOString(),
        closedBy: input.actorId,
      },
    });
  }

  async classificationCounts(
    tx: Tx,
  ): Promise<Record<SpeakerMigrationClassification, number>> {
    const rows = await tx
      .select({
        classification: speakerMigrationReviews.originalClassification,
        value: count(),
      })
      .from(speakerMigrationReviews)
      .groupBy(speakerMigrationReviews.originalClassification);
    const counts = { unmatched: 0, ambiguous: 0, duplicate: 0 };
    for (const row of rows) counts[row.classification] = Number(row.value);
    return counts;
  }
}
