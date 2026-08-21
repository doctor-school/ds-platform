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
// The whole point of this handler is that the seam between the first-class
// `experts` roster and feature 007's free-text `event_speakers` list is
// OPERATOR-DECLARED. There is no name comparison anywhere in this file, and
// there is no code path that could add one: the only way a link acquires a
// legacy match is an explicit `legacySpeakerId` the operator supplied, proven to
// belong to this event by the composite foreign key AND re-proven here under the
// lock (012-design §2.3, §4 LD-2).
//
// Every command follows the same §2.3 order, and the order is the correctness
// argument rather than a style choice:
//
//   1. lock the affected expert rows, ascending by stable id;
//   2. lock the parent event;
//   3. re-read expert lifecycle, `event_experts` and `event_speakers`;
//   4. recompute the WOULD-BE visible projection and refuse a collision with
//      409 `SPEAKER_POSITION_OCCUPIED`;
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
 * One row of the would-be visible speaker projection (012-design §4 LD-2). Only
 * `position` participates in the collision rule; `source` and `id` exist so a
 * refusal can be reasoned about in a test without re-deriving it.
 */
interface VisibleRow {
  source: "expert" | "legacy";
  id: string;
  position: number;
}

/**
 * The slot-relevant shape of one expert link — the candidate state of the event's
 * links AFTER the command under evaluation, before it is written.
 */
interface LinkSlot {
  id: string;
  expertId: string;
  position: number;
  legacySpeakerId: string | null;
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
        legacySpeakerId: row.legacySpeakerId,
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
    const legacySpeakerId = input.payload.legacySpeakerId ?? null;

    const row = await this.repo.transaction(async (tx) => {
      // §2.3 step 1–2: experts (ascending id), then the parent event.
      const [expert] = await this.repo.lockExperts(tx, [expertId]);
      if (!expert) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      assertLinkable(expert);
      if (!(await this.repo.lockEvent(tx, eventId))) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }

      // §2.3 step 3: re-read both child tables under the locks.
      const links = await this.repo.linksOfEvent(tx, eventId);
      const speakers = await this.repo.speakersOfEvent(tx, eventId);

      // The logical pair spans retained rows: an existing retired link is
      // RESTORED, never duplicated by a second create.
      if (await this.repo.pairTaken(tx, eventId, expertId)) {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          "this expert is already linked to this event; restore that link instead of creating a second one",
        );
      }
      this.assertLegacyMatch(legacySpeakerId, speakers, links, null);

      const eligibility = await this.eligibility(tx, links, expert);
      const nextLinks: LinkSlot[] = [
        ...links,
        {
          id: PENDING_ROW_ID,
          expertId,
          position,
          legacySpeakerId,
          status: "active",
        },
      ];
      assertNoLinkSlotCollision(nextLinks);
      assertNoSlotCollision(projection(nextLinks, speakers, eligibility));

      const created = await this.repo.insert(tx, {
        eventId,
        expertId,
        role,
        position,
        legacySpeakerId,
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
      const speakers = await this.repo.speakersOfEvent(tx, current.eventId);

      const nextPosition = input.payload.position ?? current.position;
      const nextLegacyId =
        input.payload.legacySpeakerId === undefined
          ? current.legacySpeakerId
          : input.payload.legacySpeakerId;
      if (nextLegacyId !== current.legacySpeakerId) {
        this.assertLegacyMatch(nextLegacyId, speakers, links, current.id);
      }

      const eligibility = await this.eligibility(tx, links, expert);
      const nextLinks: LinkSlot[] = links.map((link) =>
        link.id === current.id
          ? {
              id: link.id,
              expertId: link.expertId,
              position: nextPosition,
              legacySpeakerId: nextLegacyId,
              status: link.status,
            }
          : link,
      );
      assertNoLinkSlotCollision(nextLinks);
      assertNoSlotCollision(projection(nextLinks, speakers, eligibility));

      const updated = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        {
          ...(input.payload.role !== undefined ? { role: input.payload.role } : {}),
          ...(input.payload.position !== undefined
            ? { position: input.payload.position }
            : {}),
          ...(input.payload.legacySpeakerId !== undefined
            ? { legacySpeakerId: input.payload.legacySpeakerId }
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
   * the same lock order, the same re-read, the same projection revalidation.
   *
   * Revalidating on RETIRE is not defensive padding. Retiring a matched link
   * un-suppresses its legacy row, which becomes visible again at ITS own
   * position — a slot another active link may already hold. Retiring a link can
   * therefore create a collision, and refusing it here is what keeps the public
   * projection single-valued.
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
      const speakers = await this.repo.speakersOfEvent(tx, current.eventId);
      const eligibility = await this.eligibility(tx, links, expert);
      const nextLinks: LinkSlot[] = links.map((link) =>
        link.id === current.id ? { ...link, status: nextStatus } : link,
      );
      assertNoLinkSlotCollision(nextLinks);
      assertNoSlotCollision(projection(nextLinks, speakers, eligibility));

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

  /**
   * Prove an explicitly supplied legacy id is a match this API may store
   * (EARS-7). Two independent refusals, both 409 `LEGACY_SPEAKER_CONFLICT`:
   *
   * - the speaker must be a retained row of THIS event. The composite FK already
   *   guarantees it, but a DB constraint violation surfaces as a 500-shaped
   *   fault, and "you named a speaker of another event" deserves a stable
   *   `errorCode` a client can act on;
   * - it must not already be matched by another retained link — retired links
   *   included, because a retired link is restored rather than re-created and
   *   restoring it must not find its legacy row taken.
   */
  private assertLegacyMatch(
    legacySpeakerId: string | null,
    speakers: LegacySpeakerRow[],
    links: Array<Pick<EventExpert, "id" | "legacySpeakerId">>,
    exceptLinkId: string | null,
  ): void {
    if (legacySpeakerId === null) return;
    const speaker = speakers.find((s) => s.id === legacySpeakerId);
    if (!speaker) {
      throw new TaxonomyError(
        "LEGACY_SPEAKER_CONFLICT",
        "the named legacy speaker does not belong to this event",
      );
    }
    const taken = links.some(
      (link) =>
        link.legacySpeakerId === legacySpeakerId && link.id !== exceptLinkId,
    );
    if (taken) {
      throw new TaxonomyError(
        "LEGACY_SPEAKER_CONFLICT",
        "another expert link already matches this legacy speaker",
      );
    }
  }

  /**
   * Which experts of this event are currently ELIGIBLE to appear — published and
   * non-retired (§4 LD-2). The locked expert's own freshly-read state wins over
   * the batch read: it is the row this command holds.
   */
  private async eligibility(
    tx: TaxonomyTx,
    links: Array<Pick<EventExpert, "expertId">>,
    locked: ExpertLifecycle,
  ): Promise<Map<string, boolean>> {
    const rows = await this.repo.expertLifecycles(
      tx,
      links.map((link) => link.expertId),
    );
    const map = new Map<string, boolean>();
    for (const row of rows) map.set(row.id, isEligible(row));
    map.set(locked.id, isEligible(locked));
    return map;
  }
}

/**
 * The id standing in for the row a create has not inserted yet. It never reaches
 * the database — it exists so the would-be projection can be computed from the
 * same function the other commands use, rather than from a near-copy.
 */
const PENDING_ROW_ID = "__pending__";

/** Published and non-retired — the only state in which an expert link is shown. */
function isEligible(expert: ExpertLifecycle): boolean {
  return expert.status === "published" && expert.deletedAt === null;
}

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
 * The would-be visible speaker projection of one event (012-design §4 LD-2).
 *
 * An active link whose expert is eligible occupies its own `position` AND
 * suppresses its explicitly matched legacy row. Everything else — a link to a
 * draft/retired expert, a retired link — is invisible and suppresses nothing, so
 * the legacy fallback stays. A draft or retired expert can never hide a legacy
 * speaker: that is what keeps the public page from silently losing a name.
 */
function projection(
  links: readonly LinkSlot[],
  speakers: LegacySpeakerRow[],
  eligibility: Map<string, boolean>,
): VisibleRow[] {
  const visibleLinks = links.filter(
    (link) => link.status === "active" && eligibility.get(link.expertId) === true,
  );
  const suppressed = new Set(
    visibleLinks
      .map((link) => link.legacySpeakerId)
      .filter((id): id is string => id !== null),
  );
  return [
    ...visibleLinks.map<VisibleRow>((link) => ({
      source: "expert",
      id: link.id,
      position: link.position,
    })),
    ...speakers
      .filter(
        (speaker) =>
          speaker.recordStatus === "active" && !suppressed.has(speaker.id),
      )
      .map<VisibleRow>((speaker) => ({
        source: "legacy",
        id: speaker.id,
        position: speaker.position,
      })),
  ];
}

/**
 * One deterministic slot per visible row (012-design §4). The within-table
 * partial unique indexes are the DB backstop; a CROSS-table collision between an
 * expert link and an unsuppressed legacy row is not expressible as an index, so
 * it is refused here.
 */
/**
 * The SAME-table half of the §4 slot rule, mirroring the partial unique index
 * `event_experts_event_position_active_uniq` exactly.
 *
 * `projection()` hides an active link whose expert is not eligible (draft or
 * soft-deleted) — such a link shows nothing on the site, so it cannot collide
 * with anything VISIBLE. The index is eligibility-blind, though: EVERY active row
 * holds its `(event_id, position)` slot no matter who it points at. Checking only
 * the visible projection therefore let a second link claim a slot an
 * invisible-but-active link already owned, and the insert died on the index
 * instead of answering 409 — the exact defect the browser flow hit, since experts
 * authored in the admin start out unpublished.
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

function assertNoSlotCollision(rows: VisibleRow[]): void {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.position)) {
      throw new TaxonomyError(
        "SPEAKER_POSITION_OCCUPIED",
        "another visible speaker already holds this position on the event",
      );
    }
    seen.add(row.position);
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
    legacySpeakerId: row.legacySpeakerId,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
