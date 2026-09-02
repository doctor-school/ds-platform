import { Inject, Injectable } from "@nestjs/common";
import {
  type EventPlayback,
  isPubliclyReachable,
  type PlayableRecording,
  type RecordingKind,
} from "@ds/schemas";
import type { PlayableRow } from "./recordings.repository.js";
import { RecordingsRepository } from "./recordings.repository.js";
import { foldRecordingProjection } from "./recordings.projection.js";

// 014 EARS-5 (#1343) — the source-bearing half of the login gate (014-design §5).
//
// The gate is a READ SPLIT, not a rendering rule. The public read (#1341) is the
// guest's whole answer and carries no source at all; THIS service answers the
// authenticated `GET /v1/events/:idOrSlug/recordings` and is the only place in
// feature 014 where a `provider` / `embedRef` pair leaves the server to a
// non-admin caller.
//
// What it deliberately does NOT check: registration, attendance, or any
// 014-specific role. «Any account may watch any published recording» is the
// scenario, so the authenticated session IS the whole authorization story here —
// adding a roster lookup would quietly turn a free-to-watch archive into a
// members-only one.

/** The event is not publicly reachable (or does not exist) — a flat 404. */
export class PlaybackEventNotFoundError extends Error {
  constructor() {
    super("event not found");
    this.name = "PlaybackEventNotFoundError";
  }
}

/** The empty answer: a legitimate 200, never an error (014-design §5). */
const NOTHING_TO_PLAY: EventPlayback = { primary: null, secondary: null };

@Injectable()
export class RecordingsPlaybackService {
  // Explicit @Inject: the root `endpoint-authz` gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (apps/api/src/taxonomy/README.md).
  constructor(
    @Inject(RecordingsRepository)
    private readonly repository: RecordingsRepository,
  ) {}

  /**
   * The playable cuts of one event, for an authenticated caller.
   *
   * Three answers and no fourth:
   *
   * 1. The event is not publicly reachable (`draft`, or no such key) ⇒ 404.
   *    Authenticating must not turn this route into the oracle that confirms a
   *    hidden announcement exists — the public read refuses that key too
   *    (004 EARS-6), and the two refusals have to agree.
   * 2. The event is reachable but is not `ended`, or nothing is published ⇒
   *    200 with two nulls. `preparing` is an honest state the plaque renders,
   *    and 404-ing it would make an empty archive look like a broken link.
   *    A `hidden` event lands here too: 004 keeps its «скрыт» notice and
   *    EARS-4.5 pins that render as source-free, so a recording attached before
   *    the event was hidden stays unplayable rather than resurrecting a
   *    post-live page the visitor was never meant to see.
   * 3. Otherwise the resolver-selected primary, plus the raw secondary if one
   *    is published.
   */
  async playback(idOrSlug: string): Promise<EventPlayback> {
    const event = await this.repository.findEventByIdOrSlug(idOrSlug);
    if (!event || !isPubliclyReachable(event.state)) {
      throw new PlaybackEventNotFoundError();
    }
    if (event.state !== "ended") return NOTHING_TO_PLAY;

    const rows = await this.repository.playableRowsByEvent(event.id);
    // THE display rule is not re-decided here. `foldRecordingProjection` is the
    // EARS-3 resolver (#1340) and it already answers «which cut is primary»;
    // this method only turns its two kind answers back into the rows they came
    // from. A local `rows.find(edited) ?? rows.find(raw)` would read the same
    // today and be the second implementation the projection module exists to
    // prevent — the moment the rule gains a case, this would silently keep the
    // old one.
    const projection = foldRecordingProjection(rows, null);
    return {
      primary: pick(rows, projection.primaryKind),
      secondary: pick(rows, projection.secondaryKind),
    };
  }
}

/** The published row of `kind`, as the wire contract — or `null` when unset. */
function pick(
  rows: readonly PlayableRow[],
  kind: RecordingKind | null,
): PlayableRecording | null {
  if (kind === null) return null;
  const row = rows.find((candidate) => candidate.kind === kind);
  if (!row) return null;
  return {
    kind: row.kind,
    provider: row.provider,
    embedRef: row.embedRef,
    posterRef: row.posterRef,
    durationSec: row.durationSec,
  };
}
