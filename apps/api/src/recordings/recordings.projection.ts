import { Inject, Injectable } from "@nestjs/common";
import type { RecordingKind, RecordingProjection } from "@ds/schemas";
import type { ProjectionRow } from "./recordings.repository.js";
import { RecordingsRepository } from "./recordings.repository.js";

// 014 EARS-3 (#1340) — THE derived edited-over-raw projection (014-design §4).
//
// This file is the single place the display rule lives. All four consumers —
// the public event page (#1341), the playback route (#1344), «Мои события»
// (#1346) and the archive badge (#1347) — read it from here; a second
// implementation of "which cut wins" anywhere in the codebase is the defect this
// Issue exists to prevent.
//
// Two properties are deliberate and are asserted by the suite:
//
// 1. NOTHING IS STORED. There is no `is_primary`, `is_featured` or ordering
//    column on `event_recordings`, and none may be added. Publishing the edited
//    cut two weeks after the raw one promotes it on the next read with no
//    operator action at all, and unpublishing it demotes it just as silently.
//    An ordering flag would make that a manual step somebody eventually forgets.
// 2. THE BATCH FORM IS ONE STATEMENT. `resolveRecordingProjections` fans an id
//    array into a
//    single LEFT JOIN and returns a map, so a listing page resolves every card's
//    badge without a per-card read — the N+1 shape LD-8 refuses.

/**
 * The `preparing` answer for an event that has no published recording. Built per
 * call rather than shared: the caller owns the object it is handed.
 */
function preparing(expectedBy: string | null): RecordingProjection {
  return {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy,
  };
}

/**
 * The §4 decision tree over ONE event's published non-retired rows. Pure and
 * exported so the rule can be exercised without a database: the interesting part
 * of EARS-3 is the fold, not the SQL.
 *
 * `edited` present ⇒ `montage`, primary `edited`, secondary `raw` if the raw cut
 * is also published. `raw` alone ⇒ `raw-only`. Neither ⇒ `preparing`, carrying
 * the event's promised day.
 *
 * `posterUrl` is the PRIMARY cut's poster and nothing else: the poster stands in
 * for the player that is about to load, so borrowing the other cut's still would
 * show the visitor a frame from a video they are not being given.
 */
export function foldRecordingProjection(
  rows: readonly { kind: RecordingKind; posterRef: string | null }[],
  expectedBy: string | null,
): RecordingProjection {
  const edited = rows.find((r) => r.kind === "edited");
  const raw = rows.find((r) => r.kind === "raw");

  if (edited) {
    return {
      state: "montage",
      primaryKind: "edited",
      secondaryKind: raw ? "raw" : null,
      posterUrl: edited.posterRef,
      // The promise has been kept — repeating a «готовится к» date beside a
      // working player would contradict the page it sits on.
      expectedBy: null,
    };
  }
  if (raw) {
    return {
      state: "raw-only",
      primaryKind: "raw",
      secondaryKind: null,
      posterUrl: raw.posterRef,
      expectedBy: null,
    };
  }
  return preparing(expectedBy);
}

/** Fold the flat LEFT JOIN result into one projection per requested event. */
export function foldProjectionRows(
  eventIds: readonly string[],
  rows: readonly ProjectionRow[],
): Map<string, RecordingProjection> {
  const grouped = new Map<
    string,
    {
      expectedBy: string | null;
      kinds: { kind: RecordingKind; posterRef: string | null }[];
    }
  >();
  for (const row of rows) {
    let bucket = grouped.get(row.eventId);
    if (!bucket) {
      bucket = { expectedBy: row.recordingExpectedBy, kinds: [] };
      grouped.set(row.eventId, bucket);
    }
    if (row.kind !== null) {
      bucket.kinds.push({ kind: row.kind, posterRef: row.posterRef });
    }
  }

  const out = new Map<string, RecordingProjection>();
  for (const id of eventIds) {
    const bucket = grouped.get(id);
    // An id that matched no row is an event that does not exist (or is not
    // visible to this read). It still gets an entry: a consumer resolving a page
    // of cards must never have to distinguish «missing key» from «no recording»,
    // and `preparing` with no date is the honest answer either way.
    out.set(
      id,
      bucket
        ? foldRecordingProjection(bucket.kinds, bucket.expectedBy)
        : preparing(null),
    );
  }
  return out;
}

@Injectable()
export class RecordingsProjectionService {
  // Explicit `@Inject`: the `endpoint-authz` gate boots this graph under `tsx`,
  // which emits no `design:paramtypes` — the module README's rule 6.
  constructor(
    @Inject(RecordingsRepository)
    private readonly repository: RecordingsRepository,
  ) {}

  /** The single-event form. One event, one statement. */
  async resolveRecordingProjection(
    eventId: string,
  ): Promise<RecordingProjection> {
    const map = await this.resolveRecordingProjections([eventId]);
    return map.get(eventId) ?? preparing(null);
  }

  /**
   * The batch form: N events, still ONE statement, keyed by event id. Every
   * requested id is present in the returned map.
   */
  async resolveRecordingProjections(
    eventIds: readonly string[],
  ): Promise<Map<string, RecordingProjection>> {
    const unique = [...new Set(eventIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.repository.projectionRowsByEvents(unique);
    return foldProjectionRows(unique, rows);
  }
}
