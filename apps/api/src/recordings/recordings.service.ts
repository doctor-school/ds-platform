import { Inject, Injectable } from "@nestjs/common";
import type { EventRecording } from "@ds/db";
import {
  type AttachRecordingRequest,
  type RecordingAdminDetail,
  type RecordingAdminList,
  type RecordingCommand,
  type RecordingStatus,
  RECORDING_TRANSITIONS,
  taxonomyETag,
  type UpdateRecordingRequest,
  validRecordingCommands,
} from "@ds/schemas";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "../taxonomy/idempotency.service.js";
import { markReplayable, TaxonomyError } from "../taxonomy/taxonomy.errors.js";
import { RecordingsRepository } from "./recordings.repository.js";

// 014 EARS-1 / EARS-2 (#1339) — the recording commands (014-design §3). The whole
// state machine of this feature lives here, and it is deliberately small:
//
//   attach  → one `draft` row, if the (event, kind) slot is free
//   publish → `draft → published`, ONLY while the event is exactly `ended`
//   unpublish / retire / restore → the remaining three edges of §3
//
// Two rules are worth stating out loud because they are what the spec is about:
//
// 1. The EVENT's own lifecycle state is never written here. Publishing a
//    recording is not an event transition; it reads `events.state` and never
//    touches it. Grep this file for `events` — the only write target is
//    `event_recordings`.
// 2. There is no delete. `retire` sets `deleted_at`, frees the `(event_id, kind)`
//    slot and leaves the row addressable forever; `restore` is its inverse. No
//    method here, and no route on the controller, can remove a row.

/** A command result plus the ETag the client must echo on its next write. */
export interface RecordingCommandResult {
  detail: RecordingAdminDetail;
  etag: string;
}

export interface AttachRecordingInput {
  eventId: string;
  payload: AttachRecordingRequest;
  lease: IdempotencyLease;
}

export interface UpdateRecordingInput {
  eventId: string;
  recordingId: string;
  payload: UpdateRecordingRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface RecordingTransitionInput {
  eventId: string;
  recordingId: string;
  command: RecordingCommand;
  expectedVersion: number;
  lease: IdempotencyLease;
}

@Injectable()
export class RecordingsService {
  // Every dependency carries an EXPLICIT @Inject token, including the class ones:
  // the root-level `endpoint-authz` gate boots this module graph under `tsx`,
  // whose esbuild transform emits no `design:paramtypes`, so a type-inferred
  // injection resolves to `undefined` there while working fine under `nest build`
  // (see `apps/api/src/taxonomy/README.md`).
  constructor(
    @Inject(RecordingsRepository) private readonly repo: RecordingsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `GET /v1/admin/events/:id/recordings` — every retained row of the event. */
  async list(eventId: string): Promise<RecordingAdminList> {
    const event = await this.repo.findEvent(eventId);
    if (!event) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    const rows = await this.repo.listByEvent(eventId);
    return {
      data: rows.map((row) => toDetail(row, event.state === "ended")),
      total: rows.length,
      eventState: event.state,
      recordingExpectedBy: event.recordingExpectedBy,
    };
  }

  /** `POST /v1/admin/events/:id/recordings` — attach one `draft` recording. */
  attach(input: AttachRecordingInput): Promise<RecordingCommandResult> {
    return this.fenced(input.lease, () => this.attachCommand(input));
  }

  /** `PATCH …/:rid` — correct the source, poster or duration of the SAME row. */
  update(input: UpdateRecordingInput): Promise<RecordingCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST …/:rid/{publish,unpublish,retire,restore}` — one §3 edge. */
  transition(input: RecordingTransitionInput): Promise<RecordingCommandResult> {
    return this.fenced(input.lease, () => this.transitionCommand(input));
  }

  /**
   * Tag any DETERMINISTIC refusal with the idempotency record this request
   * already reserved, so the problem filter fenced-stores the outcome and an
   * exact retry replays the refusal instead of being told «still in progress»
   * (012-design §6 bullet 3, reused verbatim). A code outside the deterministic
   * set passes through untagged and stays takeover-eligible.
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

  private async attachCommand(
    input: AttachRecordingInput,
  ): Promise<RecordingCommandResult> {
    const event = await this.repo.findEvent(input.eventId);
    if (!event) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    // Pre-flight the occupied-slot refusal OUTSIDE the transaction so the
    // operator gets a message NAMING the row rather than an opaque unique
    // violation; the partial unique index remains the final race guard.
    const occupying = await this.repo.activeOfKindAnywhere(
      input.eventId,
      input.payload.kind,
    );
    if (occupying) throw kindOccupied(occupying);

    const row = await this.repo.transaction(async (tx) => {
      // Re-check under the event row lock: everything above was optimistic.
      const lockedEvent = await this.repo.lockEvent(tx, input.eventId);
      if (!lockedEvent) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const raced = await this.repo.activeOfKind(
        tx,
        input.eventId,
        input.payload.kind,
      );
      if (raced) throw kindOccupied(raced);

      const created = await this.repo.insert(tx, {
        eventId: input.eventId,
        kind: input.payload.kind,
        provider: input.payload.provider,
        embedRef: input.payload.embedRef,
        posterRef: input.payload.posterRef ?? null,
        durationSec: input.payload.durationSec ?? null,
      });
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(created, lockedEvent.state === "ended"),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/events/${input.eventId}/recordings/${created.id}`,
      });
      return { created, eventEnded: lockedEvent.state === "ended" };
    });

    return {
      detail: toDetail(row.created, row.eventEnded),
      etag: taxonomyETag(row.created.version),
    };
  }

  private async updateCommand(
    input: UpdateRecordingInput,
  ): Promise<RecordingCommandResult> {
    const current = await this.loadOwned(input.eventId, input.recordingId);
    if (current.version !== input.expectedVersion) throw stalePrecondition();

    const row = await this.repo.transaction(async (tx) => {
      const lockedEvent = await this.repo.lockEvent(tx, input.eventId);
      if (!lockedEvent) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const locked = await this.repo.lockById(tx, input.recordingId);
      if (!locked || locked.eventId !== input.eventId) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }
      if (locked.version !== input.expectedVersion) throw stalePrecondition();
      // Editing the source of a RETIRED row is not a correction, it is a
      // resurrection through the back door: `restore` is the one way back, and
      // it re-checks the kind slot. Refused as the transition it pretends not
      // to be.
      if (locked.status === "retired") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          "a retired recording is edited only after it is restored",
        );
      }

      const updated = await this.repo.updateVersioned(
        tx,
        input.recordingId,
        input.expectedVersion,
        {
          ...(input.payload.provider !== undefined
            ? { provider: input.payload.provider }
            : {}),
          ...(input.payload.embedRef !== undefined
            ? { embedRef: input.payload.embedRef }
            : {}),
          ...(input.payload.posterRef !== undefined
            ? { posterRef: input.payload.posterRef ?? null }
            : {}),
          ...(input.payload.durationSec !== undefined
            ? { durationSec: input.payload.durationSec ?? null }
            : {}),
        },
      );
      if (!updated) throw stalePrecondition();
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(updated, lockedEvent.state === "ended"),
        etag: taxonomyETag(updated.version),
      });
      return { updated, eventEnded: lockedEvent.state === "ended" };
    });

    return {
      detail: toDetail(row.updated, row.eventEnded),
      etag: taxonomyETag(row.updated.version),
    };
  }

  private async transitionCommand(
    input: RecordingTransitionInput,
  ): Promise<RecordingCommandResult> {
    const current = await this.loadOwned(input.eventId, input.recordingId);
    if (current.version !== input.expectedVersion) throw stalePrecondition();

    const row = await this.repo.transaction(async (tx) => {
      // The event lock is taken FIRST and always, in the same order everywhere
      // in this file — two commands racing on one event can then only queue,
      // never deadlock against each other.
      const lockedEvent = await this.repo.lockEvent(tx, input.eventId);
      if (!lockedEvent) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const locked = await this.repo.lockById(tx, input.recordingId);
      if (!locked || locked.eventId !== input.eventId) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }
      if (locked.version !== input.expectedVersion) throw stalePrecondition();

      const edge = RECORDING_TRANSITIONS[input.command];
      if (!edge.from.includes(locked.status as RecordingStatus)) {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          `a ${locked.status} recording cannot be ${pastTense(input.command)}`,
        );
      }

      // §3: publication requires the event to be EXACTLY `ended`. `draft`,
      // `published`, `live` and `hidden` are each refused — `hidden` too,
      // because feature 004 routes a cancelled or never-aired event there and
      // handing it a player would advertise a broadcast that never happened.
      if (input.command === "publish" && lockedEvent.state !== "ended") {
        throw new TaxonomyError(
          "EVENT_NOT_FINISHED",
          `publishing a recording requires the event to be ended; it is ${lockedEvent.state}`,
        );
      }
      // Restoring competes for the kind slot like a fresh attach does.
      if (input.command === "restore") {
        const occupying = await this.repo.activeOfKind(
          tx,
          input.eventId,
          locked.kind,
        );
        if (occupying) throw kindOccupied(occupying);
      }

      const patch = {
        status: edge.to,
        // Set ONCE on the first publish and never cleared: unpublish, retire and
        // restore all leave it alone, and the DB trigger refuses any attempt to
        // move it. A second publish therefore keeps the original instant.
        ...(edge.to === "published" && locked.firstPublishedAt === null
          ? { firstPublishedAt: new Date() }
          : {}),
        // `retired ⇔ deleted_at IS NOT NULL` is a DB CHECK; the two are written
        // together here so the row can never be half-retired.
        ...(edge.to === "retired"
          ? { deletedAt: new Date() }
          : locked.deletedAt !== null
            ? { deletedAt: null }
            : {}),
      };
      const updated = await this.repo.updateVersioned(
        tx,
        input.recordingId,
        input.expectedVersion,
        patch,
      );
      if (!updated) throw stalePrecondition();
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(updated, lockedEvent.state === "ended"),
        etag: taxonomyETag(updated.version),
      });
      return { updated, eventEnded: lockedEvent.state === "ended" };
    });

    return {
      detail: toDetail(row.updated, row.eventEnded),
      etag: taxonomyETag(row.updated.version),
    };
  }

  /**
   * The row, proven to belong to the addressed event. A recording of ANOTHER
   * event is `RESOURCE_NOT_FOUND` and not a 403: the path names a resource that
   * does not exist under it, and saying otherwise would confirm the id.
   */
  private async loadOwned(
    eventId: string,
    recordingId: string,
  ): Promise<EventRecording> {
    const row = await this.repo.findById(recordingId);
    if (!row || row.eventId !== eventId) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    return row;
  }
}

/** 409 naming the row that holds the slot (EARS-1) — id and status, no source. */
function kindOccupied(row: EventRecording): TaxonomyError {
  return new TaxonomyError(
    "RECORDING_KIND_OCCUPIED",
    `recording ${row.id} (${row.status}) already holds the ${row.kind} slot of this event; retire it first`,
  );
}

function stalePrecondition(): TaxonomyError {
  return new TaxonomyError(
    "PRECONDITION_FAILED",
    "the recording changed since it was read; reload and retry",
  );
}

function pastTense(command: RecordingCommand): string {
  return command === "publish"
    ? "published"
    : command === "unpublish"
      ? "unpublished"
      : command === "retire"
        ? "retired"
        : "restored";
}

/**
 * The admin projection of one row. `validCommands` is derived from the §3 table
 * plus the event's own state, so the panel renders exactly the buttons the server
 * will honour — a Publish button that always 409s is a worse surface than no
 * button, and this is the one place that decision is made.
 */
function toDetail(
  row: EventRecording,
  eventEnded: boolean,
): RecordingAdminDetail {
  const commands = validRecordingCommands(row.status as RecordingStatus).filter(
    (command) => command !== "publish" || eventEnded,
  );
  return {
    id: row.id,
    eventId: row.eventId,
    kind: row.kind,
    provider: row.provider,
    embedRef: row.embedRef,
    posterRef: row.posterRef,
    durationSec: row.durationSec,
    status: row.status,
    firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
    validCommands: commands,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
