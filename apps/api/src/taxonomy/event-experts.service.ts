import { Inject, Injectable } from "@nestjs/common";
import type { EventExpert } from "@ds/db";
import {
  type AdminEventExpertListQuery,
  type CreateEventExpertRequest,
  type EventExpertAdminDetail,
  type EventExpertAdminList,
  taxonomyETag,
  type UpdateEventExpertRequest,
} from "@ds/schemas";
import {
  EventExpertsRepository,
  type ExpertLifecycle,
  type LegacySpeakerRow,
  type TaxonomyTx,
} from "./event-experts.repository.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-7 (#1289) — the explicit expert↔event link commands.
//
// Since the 012 EARS-24 cutover (#1607) `event_experts` is the ONLY speaker
// source of an event: there is no free-text list to reconcile against and no
// name comparison anywhere in this file.
//
// Every command follows the same §2.3 order, and the order is the correctness
// argument rather than a style choice:
//
//   1. lock the affected expert rows, ascending by stable id;
//   2. lock the parent event;
//   3. re-read `event_experts` under those locks;
//   4. recompute the WOULD-BE slot occupancy and refuse a collision with 409
//      `SPEAKER_POSITION_OCCUPIED`;
//   5. write, bump `version`, complete the fenced idempotency record.
//
// Steps 3–4 are what makes an optimistic pre-flight read unnecessary and, more
// importantly, insufficient: an expert publish transaction takes the SAME lock
// order, so whichever of the two commits first is seen by the other.

export interface CreateEventExpertInput {
  payload: CreateEventExpertRequest;
  lease: IdempotencyLease;
}

export interface UpdateEventExpertInput {
  id: string;
  payload: UpdateEventExpertRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface TransitionEventExpertInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface EventExpertCommandResult {
  detail: EventExpertAdminDetail;
  etag: string;
}

/**
 * The slot-relevant shape of one expert link — the candidate state of the event's
 * links AFTER the command under evaluation, before it is written.
 */
interface LinkSlot {
  id: string;
  expertId: string;
  position: number;
  status: "active" | "retired";
}

@Injectable()
export class EventExpertsService {
  // Explicit @Inject tokens on every dependency — the root-level
  // `endpoint-authz` gate boots this module graph under `tsx`, whose esbuild
  // transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working fine under `nest build`.
  constructor(
    @Inject(EventExpertsRepository) private readonly repo: EventExpertsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `POST /v1/admin/event-experts` — link one expert to one event. */
  create(input: CreateEventExpertInput): Promise<EventExpertCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/event-experts/:id` — edit the SAME row. */
  update(input: UpdateEventExpertInput): Promise<EventExpertCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST /v1/admin/event-experts/:id/retire` — `active → retired`. */
  retire(input: TransitionEventExpertInput): Promise<EventExpertCommandResult> {
    return this.fenced(input.lease, () => this.transitionCommand(input, "retire"));
  }

  /** `POST /v1/admin/event-experts/:id/restore` — `retired → active`. */
  restore(input: TransitionEventExpertInput): Promise<EventExpertCommandResult> {
    return this.fenced(input.lease, () =>
      this.transitionCommand(input, "restore"),
    );
  }

  /** `GET /v1/admin/event-experts/:id` — detail by stable id, retired included. */
  async detail(id: string): Promise<EventExpertCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `GET /v1/admin/event-experts` — the filtered join list (§5.1). */
  async list(query: AdminEventExpertListQuery): Promise<EventExpertAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        expertId: row.expertId,
        role: row.role,
        position: row.position,
        status: row.status,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Run a command that already reserved an idempotency record and tag any
   * DETERMINISTIC refusal with that record, so the problem filter fenced-stores
   * the outcome and an exact retry replays it (§6 bullet 3 / EARS-17).
   */
  private async fenced<T>(
    lease: IdempotencyLease,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw markReplayable(err, lease);
    }
  }

  private async createCommand(
    input: CreateEventExpertInput,
  ): Promise<EventExpertCommandResult> {
    const { eventId, expertId, role, position } = input.payload;

    const row = await this.repo.transaction(async (tx) => {
      // §2.3 step 1–2: experts (ascending id), then the parent event.
      const [expert] = await this.repo.lockExperts(tx, [expertId]);
      if (!expert) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      assertLinkable(expert);
      if (!(await this.repo.lockEvent(tx, eventId))) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }

      // §2.3 step 3: re-read the link table under the locks.
      const links = await this.repo.linksOfEvent(tx, eventId);

      // The logical pair spans retained rows: an existing retired link is
      // RESTORED, never duplicated by a second create.
      if (await this.repo.pairTaken(tx, eventId, expertId)) {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          "this expert is already linked to this event; restore that link instead of creating a second one",
        );
      }
      const nextLinks: LinkSlot[] = [
        ...links,
        {
          id: PENDING_ROW_ID,
          expertId,
          position,
          status: "active",
        },
      ];
      assertNoLinkSlotCollision(nextLinks);

      const created = await this.repo.insert(tx, {
        eventId,
        expertId,
        role,
        position,
      });
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(created),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/event-experts/${created.id}`,
      });
      return created;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  private async updateCommand(
    input: UpdateEventExpertInput,
  ): Promise<EventExpertCommandResult> {
    // Read the row OUTSIDE the transaction only to learn which expert and event
    // to lock — every value it carries is re-read under those locks below.
    const seed = await this.repo.findById(input.id);
    if (!seed) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const [expert] = await this.repo.lockExperts(tx, [seed.expertId]);
      if (!expert) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (!(await this.repo.lockEvent(tx, seed.eventId))) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }
      const current = await this.repo.lockById(tx, input.id);
      if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (current.expertId !== seed.expertId || current.eventId !== seed.eventId) {
        // Endpoints are immutable, so this can only mean the seed read raced a
        // row that no longer exists as read. Refuse rather than mutate under a
        // lock set chosen for a different row.
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }
      if (current.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the link changed since it was read; reload and retry",
        );
      }

      const links = await this.repo.linksOfEvent(tx, current.eventId);

      const nextPosition = input.payload.position ?? current.position;
      const nextLinks: LinkSlot[] = links.map((link) =>
        link.id === current.id
          ? {
              id: link.id,
              expertId: link.expertId,
              position: nextPosition,
              status: link.status,
            }
          : link,
      );
      assertNoLinkSlotCollision(nextLinks);

      const updated = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        {
          ...(input.payload.role !== undefined ? { role: input.payload.role } : {}),
          ...(input.payload.position !== undefined
            ? { position: input.payload.position }
            : {}),
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the link changed since it was read; reload and retry",
        );
      }
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(updated),
        etag: taxonomyETag(updated.version),
      });
      return updated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /**
   * Retire and restore share one body because they share the whole protocol:
   * the same lock order, the same re-read, the same slot revalidation. A RESTORE
   * makes the link active again, so it must prove the slot it reclaims is free.
   *
   * This is a plain join transition: no `LifecycleImpact` preview and no
   * `Lifecycle-Impact-Token` (EARS-13/14's preview mechanism is #1288's, and no
   * taxonomy resource exposes it yet).
   */
  private async transitionCommand(
    input: TransitionEventExpertInput,
    transition: "retire" | "restore",
  ): Promise<EventExpertCommandResult> {
    const seed = await this.repo.findById(input.id);
    if (!seed) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const [expert] = await this.repo.lockExperts(tx, [seed.expertId]);
      if (!expert) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (!(await this.repo.lockEvent(tx, seed.eventId))) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }
      const current = await this.repo.lockById(tx, input.id);
      if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (current.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the link changed since it was read; reload and retry",
        );
      }

      const nextStatus = transition === "retire" ? "retired" : "active";
      if (current.status === nextStatus) {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          `the link is already ${nextStatus}`,
        );
      }
      if (transition === "restore") {
        // §3 overlay: re-listing a person who asked to be taken off the site is
        // a fresh authoring act, not an undo.
        assertLinkable(expert);
      }

      const links = await this.repo.linksOfEvent(tx, current.eventId);
      const nextLinks: LinkSlot[] = links.map((link) =>
        link.id === current.id ? { ...link, status: nextStatus } : link,
      );
      assertNoLinkSlotCollision(nextLinks);

      const updated = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        {
          status: nextStatus,
          deletedAt: transition === "retire" ? new Date() : null,
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the link changed since it was read; reload and retry",
        );
      }
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(updated),
        etag: taxonomyETag(updated.version),
      });
      return updated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

}

/**
 * The id standing in for the row a create has not inserted yet. It never reaches
 * the database — it exists so the would-be projection can be computed from the
 * same function the other commands use, rather than from a near-copy.
 */
const PENDING_ROW_ID = "__pending__";

/**
 * Refuse to link or restore against a person who asked to be taken off the site
 * (§2.4 / §3): the row is retained, so `content_removed_at` is the only marker
 * distinguishing "removed on request" from an ordinary retire.
 */
function assertLinkable(expert: ExpertLifecycle): void {
  if (expert.contentRemovedAt !== null) {
    throw new TaxonomyError(
      "CONTENT_REMOVED",
      "this record was removed at the person's request; re-listing them is a fresh authoring act",
    );
  }
}

/**
 * The §4 slot rule, mirroring the partial unique index
 * `event_experts_event_position_active_uniq` exactly.
 *
 * The rule is eligibility-BLIND, exactly as the index is: EVERY active row holds
 * its `(event_id, position)` slot no matter whether its expert is published yet.
 * Checking only the publicly visible subset would let a second link claim a slot
 * an invisible-but-active link already owned, and the insert would die on the
 * index instead of answering 409 — the exact defect the browser flow hit, since
 * experts authored in the admin start out unpublished.
 */
function assertNoLinkSlotCollision(links: readonly LinkSlot[]): void {
  const seen = new Set<number>();
  for (const link of links) {
    if (link.status !== "active") continue;
    if (seen.has(link.position)) {
      throw new TaxonomyError(
        "SPEAKER_POSITION_OCCUPIED",
        "another expert link already holds this position on the event",
      );
    }
    seen.add(link.position);
  }
}

/** The admin projection of one link. */
function toDetail(row: EventExpert): EventExpertAdminDetail {
  return {
    id: row.id,
    eventId: row.eventId,
    expertId: row.expertId,
    role: row.role,
    position: row.position,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
