import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Event, NewEvent } from "@ds/db";
import {
  canTransition,
  type ConfigureStreamRequest,
  type CreateEventRequest,
  type EventAdminDetail,
  type EventAdminListItem,
  type EventAdminListQuery,
  type EventLifecycleState,
  type EventOrigin,
  isPubliclyReachable,
  type LegacyBroadcastCreateBody,
  type MonthBroadcastEntry,
  type MonthBroadcastState,
  type MonthlyEventCount,
  type PastBroadcastCard,
  type PublicEventListingPage,
  type PublicEventListingQuery,
  mskLocalToInstant,
  mskMonthRange,
  mskYearRange,
  type HostFreeEventPageView,
  type PublicEventPageSpeaker,
  type PublicEventState,
  type UpcomingBroadcastCard,
  type UpcomingBroadcastState,
  type UpdateEventRequest,
  validTransitions,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import { RecordingsProjectionService } from "../recordings/recordings.projection.js";
import { SpeakerProjectionService } from "../taxonomy/speaker-projection.service.js";
import {
  type EventAggregate,
  type EventListingCursor,
  EventsRepository,
  type Tx,
} from "./events.repository.js";
import { EVENT_CURSOR_SHAPE } from "../taxonomy/public-event-cursor.js";

/**
 * The upcoming-listing air window (004 EARS-7). An event is "currently airing or
 * still to come" when `starts_at ≥ now − AIR_WINDOW_MS` — the grace behind the
 * event's start that keeps a `live` broadcast (whose start instant is already in
 * the past) on the listing until it is transitioned to `ended` by feature 007.
 * A fixed constant, not the per-event duration: the design filters on
 * `starts_at ≥ now() − airWindow` (design §4), and the lifecycle state (not the
 * clock) is what removes an event when it ends. Six hours generously bounds the
 * longest realistic broadcast so a genuinely current live event never falls off
 * before 007 ends it, while a long-past not-yet-ended event still ages out.
 */
export const AIR_WINDOW_MS = 6 * 60 * 60 * 1000;

export class InvalidEventListingCursorError extends Error {
  constructor() {
    super("this cursor was not issued by this API; start from the first page");
    this.name = "InvalidEventListingCursorError";
  }
}

/**
 * The public listing cursor is the SHARED `(starts_at, id)` event tuple
 * (`public-event-cursor.ts`) — the same opaque base64url envelope the 012
 * relationship traversals issue, so one grammar covers every event-ordered
 * public read. `startsAt` is the microsecond-exact text Postgres itself
 * rendered, never a JavaScript `Date`: a millisecond-truncated cutoff is
 * strictly LESS than the instant it came from, so the row that issued the
 * cursor matches `starts_at > cutoff` again and the zero-auth page loop never
 * terminates (#1888).
 */
function encodeEventListingCursor(cursor: EventListingCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Shape-validate a caller-supplied cursor before its values become SQL
 * operands. `EVENT_CURSOR_SHAPE` is the SSOT grammar; a cursor that fails it was
 * not issued here, and {@link InvalidEventListingCursorError} keeps the existing
 * 400 contract of `GET /v1/public/events` (014 EARS-11) unchanged.
 */
function decodeEventListingCursor(cursor?: string): EventListingCursor | null {
  if (cursor === undefined) return null;
  try {
    return EVENT_CURSOR_SHAPE.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new InvalidEventListingCursorError();
  }
}

/** A program PDF extracted from the multipart request. */
export interface UploadedPdf {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * Canonical `audit_ledger` event id for the `draft → published` transition
 * (EARS-4; ADR-0003 §6). The `event.<transition>` namespace mirrors the auth
 * ledger's `auth.<class>.<event>` taxonomy (ADR-0001 §7.3) for the webinar
 * aggregate; the sibling transitions (open/close/hide — EARS-5/6) add
 * `event.went_live` / `event.ended` / `event.hidden` alongside it.
 */
export const EVENT_PUBLISHED_AUDIT_TYPE = "event.published";

/**
 * Canonical `audit_ledger` event id for the `published → live` transition — the
 * director opening the room (EARS-5; ADR-0003 §6). Same `event.<transition>`
 * namespace as {@link EVENT_PUBLISHED_AUDIT_TYPE}; consumed by 006 (the room
 * starts admitting registered doctors + presence capture) and 004 (the "live
 * now" signal).
 */
export const EVENT_WENT_LIVE_AUDIT_TYPE = "event.went_live";

/**
 * Canonical `audit_ledger` event id for the `live → ended` transition — the
 * director closing the room (EARS-5; ADR-0003 §6). Same `event.<transition>`
 * namespace; consumed by 006 (admission + heartbeat/chat acceptance stop, the
 * presence window is bounded) and 004 (the ended state).
 */
export const EVENT_ENDED_AUDIT_TYPE = "event.ended";

/**
 * Canonical `audit_ledger` event id for the `ended → hidden` transition — the
 * operator's manual post-broadcast hide (EARS-6, LD-2; ADR-0003 §6). Same
 * `event.<transition>` namespace as the sibling transitions; consumed by 004
 * (the event leaves the upcoming listing and its public page degrades to the
 * hidden notice). There is no scheduler — the row is written only by an
 * explicit operator command.
 */
export const EVENT_HIDDEN_AUDIT_TYPE = "event.hidden";

/**
 * 014 EARS-25 (#1741) — canonical `audit_ledger` event id for the legacy
 * machine's `hidden → in_archive` transition (`ArchiveLegacyBroadcast`,
 * 014-design §3.1; ADR-0003 §6). A DISTINCT type from the 007 transitions: it
 * records an operator PUBLISHING an эфир the platform never hosted into the
 * archive, which is not any of «we published it», «we aired it» or «we closed
 * the room». Collapsing it into `event.published` would make the ledger unable
 * to answer «did we host this broadcast?».
 */
export const EVENT_ARCHIVED_LEGACY_AUDIT_TYPE = "event.archived_legacy";

/**
 * 014 EARS-25 (#1741) — canonical `audit_ledger` event id for the legacy
 * machine's `in_archive → hidden` transition (`HideLegacyBroadcast`). DISTINCT
 * from {@link EVENT_HIDDEN_AUDIT_TYPE}, which records 007's terminal
 * `ended → hidden` move: this one is REVERSIBLE (the эфир can be archived
 * again), so a ledger that used one id for both could not tell a terminal hide
 * from a temporary one.
 */
export const EVENT_HIDDEN_LEGACY_AUDIT_TYPE = "event.hidden_legacy";

/**
 * The EARS-7 guard's refusal: the requested move is not one of the five legal
 * forward transitions from the event's current state. HTTP-agnostic — the
 * controller maps it to a 4xx state conflict — so the guard stays a pure domain
 * rule, testable without a transport. `from`/`to` are the offending pair.
 */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: EventLifecycleState,
    readonly to: EventLifecycleState,
    message = `illegal lifecycle transition ${from} → ${to}`,
  ) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

/**
 * 014 EARS-27 (#1741) — the WRONG-MACHINE refusal: the command itself does not
 * exist on the machine this event runs on, which is a different fact from «that
 * edge is not legal from here». Both answer the wire as 409
 * `INVALID_TRANSITION` (it stays an `InvalidTransitionError` subclass so the
 * controller's `instanceof` mapping is untouched and no client sees a new code),
 * but the message and the log line now name the mismatch instead of reading
 * «illegal lifecycle transition hidden → hidden» for a command that has no
 * target on this machine at all.
 *
 * `to` is the REAL requested target wherever the caller knows it — every named
 * command knows its own, and the generic `POST :id/transition` knows the body's.
 * It falls back to the current state only where there is genuinely nothing
 * better to report.
 */
export class WrongMachineCommandError extends InvalidTransitionError {
  constructor(
    /** The machine the refused command belongs to. */
    readonly machine: EventOrigin,
    origin: EventOrigin,
    from: EventLifecycleState,
    to?: EventLifecycleState,
  ) {
    super(
      from,
      to ?? from,
      `${machine}-machine command on a ${origin} event in state ${from}`,
    );
    this.name = "WrongMachineCommandError";
  }
}

/**
 * #1593 — the optimistic-concurrency refusal: the caller's `If-Match` named a
 * version the aggregate has already moved past, so the command it was about to
 * apply was decided against a stale read. HTTP-agnostic like every other refusal
 * in this module — the controller maps it to a 412 `PRECONDITION_FAILED` — so
 * the rule stays a pure domain rule, testable without a transport. Nothing is
 * mutated and no audit row is written: a lost update is refused, never merged.
 */
export class EventVersionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `the event changed since it was read (expected version ${expected}, found ${actual})`,
    );
    this.name = "EventVersionConflictError";
  }
}

/**
 * The lifecycle states in which the stream config may be authored or corrected
 * (design §2 — the config is *authorable* in `draft` and *still correctable* in
 * `published`, i.e. the pre-air window). Once the room is live the broadcast is
 * on air and the config is locked; `ended`/`hidden` are terminal. Kept as a
 * closed set so the window can never silently widen.
 */
export const STREAM_CONFIGURABLE_STATES: readonly EventLifecycleState[] = [
  "draft",
  "published",
];

/**
 * The EARS-3 refusal: `ConfigureStream` was called on an event outside the
 * configurable window ({@link STREAM_CONFIGURABLE_STATES}). HTTP-agnostic — the
 * controller maps it to a 409 state conflict — so the rule stays a pure domain
 * rule. `state` is the offending current state; no config is recorded.
 */
export class StreamNotConfigurableError extends Error {
  constructor(readonly state: EventLifecycleState) {
    super(`stream config is not editable while the event is ${state}`);
    this.name = "StreamNotConfigurableError";
  }
}

/**
 * The lifecycle states in which an event's authored fields may be edited (EARS-2,
 * requirements Scope). Editing is a **pre-hide** action — `draft` / `published`
 * / `live` / `ended` are all editable (the operator corrects a detail without any
 * state reversal — there is no unpublish, EARS-7). A `hidden` event has left
 * every public surface and is terminal, so it is not editable. Kept as the
 * complement of the single terminal state so the window can never silently widen.
 */
export const EVENT_EDITABLE_STATES: readonly EventLifecycleState[] = [
  "draft",
  "published",
  "live",
  "ended",
];

/**
 * The EARS-2 refusal: `UpdateEvent` was called on a `hidden` event, outside
 * the pre-hide edit window ({@link EVENT_EDITABLE_STATES}). HTTP-agnostic —
 * the controller maps it to a 409 state conflict — so the rule stays a pure
 * domain rule. `state` is the offending current state; the aggregate is untouched
 * and no program PDF is replaced.
 */
export class EventNotEditableError extends Error {
  constructor(readonly state: EventLifecycleState) {
    super(`event is not editable while ${state}`);
    this.name = "EventNotEditableError";
  }
}

/**
 * 014 EARS-25 (#1741) — the `ArchiveLegacyBroadcast` refusal: the эфир carries
 * no PUBLISHED, non-retired recording, so there is nothing to publish into the
 * archive. HTTP-agnostic — the controller maps it to a 409 `EVENT_NOT_FINISHED`,
 * the same code 014 §3 already uses for «this event is not in a state where a
 * recording may be published», read from the other direction. Nothing is
 * mutated and no audit row is written.
 */
export class EventNotFinishedError extends Error {
  constructor(readonly eventId: string) {
    super(`event ${eventId} has no published recording to archive`);
    this.name = "EventNotFinishedError";
  }
}

/**
 * A writer a transition command enlists in its OWN transaction — 014 EARS-18's
 * fenced `Idempotency-Key` completion (012-design §6). Structurally typed on the
 * drizzle transaction handle so this module keeps no dependency on 012's
 * `IdempotencyService`: the controller owns the protocol, the service only
 * guarantees the write lands atomically with the state change and the audit row.
 * Throwing aborts the transition — that is what makes a fenced-out owner
 * incapable of double-applying the command.
 */
export type TransitionFence = (
  tx: Tx,
  detail: EventAdminDetail,
) => Promise<void>;

/**
 * 014 EARS-27 (#1741) — the mutual-exclusion refusal every BROADCAST-machine
 * entry point runs: a 007 command aimed at a `legacy` эфир is answered 409
 * `INVALID_TRANSITION` with the state untouched and no audit row.
 *
 * The origin-keyed map carries most of the exclusion in its SHAPE — `draft →
 * published`, `published → live`, `live → ended` exist on no legacy machine, so
 * `PublishEvent` / `OpenRoom` / `CloseRoom` fall out of {@link canTransition} on
 * their own. It does NOT carry all of it, and the two places it does not are
 * where this guard earns its keep:
 *
 *  - `HideEvent` targets `hidden`, and `in_archive → hidden` IS a legal LEGACY
 *    edge. Without the guard, 007's TERMINAL hide would apply to an archived
 *    эфир and stamp {@link EVENT_HIDDEN_AUDIT_TYPE} on a reversible move;
 *  - `ConfigureStream` is not a transition at all, so no map can refuse it — a
 *    `legacy` эфир never acquires a stream config (014-design §3.1);
 *  - the generic `POST :id/transition` writes state with no precondition and no
 *    audit row, so both legacy edges are sealed off from it here.
 *
 * Applying it at every broadcast entry point rather than only where the map
 * leaks is deliberate: exclusion that has to be re-derived per command is
 * exclusion a future command forgets.
 */
function assertBroadcastCommandOrigin(
  event: Event,
  _from?: EventLifecycleState,
  to?: EventLifecycleState,
): void {
  if (event.origin !== "platform") {
    throw new WrongMachineCommandError(
      "platform",
      event.origin,
      event.state as EventLifecycleState,
      to,
    );
  }
}

/**
 * 014 EARS-27 (#1741) — the mirror guard: a LEGACY command
 * (`ArchiveLegacyBroadcast` / `HideLegacyBroadcast`) on a `platform` event is
 * refused with 409 `INVALID_TRANSITION`, the state untouched.
 *
 * The origin-keyed map carries most of the exclusion on its own, but not all of
 * it: `HideLegacyBroadcast` targets `hidden`, and `ended → hidden` IS a legal
 * edge on the platform machine (007's terminal `HideEvent`). Without this guard
 * the legacy command would apply to a platform `ended` event and stamp the
 * ledger with {@link EVENT_HIDDEN_LEGACY_AUDIT_TYPE} — a reversible-hide id on a
 * terminal hide, which is exactly the ambiguity the two ids exist to prevent.
 * Two commands may share a target only while each one is pinned to its own
 * machine.
 */
function assertLegacyCommandOrigin(
  event: Event,
  _from?: EventLifecycleState,
  to?: EventLifecycleState,
): void {
  if (event.origin !== "legacy") {
    throw new WrongMachineCommandError(
      "legacy",
      event.origin,
      event.state as EventLifecycleState,
      to,
    );
  }
}

/**
 * #1593 — refuse a command whose `If-Match` names a version the aggregate has
 * already moved past. Run LAST among the guards, after the closed-set check, the
 * command-specific precondition and the 014 EARS-18 preconditions: a request
 * that is illegal *whatever* version it was read at is answered with the reason
 * it is illegal (409 `INVALID_TRANSITION` / `EVENT_NOT_PAST`), not with «reload
 * and retry» — retrying it would only produce the same domain refusal. The
 * mirror image (a legal command against a stale read) is the 412 this raises.
 *
 * It is a PRE-CHECK, not the concurrency control: the repository's CAS clause is
 * what actually closes the read-to-write window. This exists so the common case
 * refuses before any transaction opens, with the same error either path raises.
 */
function assertVersion(
  event: Event,
  expectedVersion: number | undefined,
): void {
  if (expectedVersion === undefined) return;
  if (event.version !== expectedVersion) {
    throw new EventVersionConflictError(expectedVersion, event.version);
  }
}

/**
 * The transitions the admin surface may offer for a loaded event: the closed-set
 * derivation for the event's OWN machine ({@link validTransitions} keyed by
 * `origin`) MINUS the `hidden → in_archive` edge when its 014 EARS-25
 * precondition does not hold.
 *
 * 014-design §3.1 requires «Архивировать» to appear only when the command would
 * succeed, and it names `EventAdminDetail.validTransitions` as the derivation —
 * so the refinement belongs on the read model, not as a second precondition copy
 * in the admin app (which cannot see the event's recordings at all).
 *
 * `hasPublishedRecording` is passed IN rather than resolved here because the
 * fact costs a query: the caller batches it for a list page and skips it
 * entirely for any event the edge is not reachable from.
 */
function offeredTransitions(
  event: Event,
  hasPublishedRecording: boolean,
): EventLifecycleState[] {
  const state = event.state as EventLifecycleState;
  return validTransitions(state, event.origin).filter(
    (to) => to !== "in_archive" || hasPublishedRecording,
  );
}

/**
 * 014 EARS-23 (#1741) — may this event's authored fields be edited right now?
 *
 * Origin-aware because `hidden` means different things on the two machines. On
 * `platform` it is TERMINAL — the event has left every public surface for good —
 * so 007 EARS-2's pre-hide window ({@link EVENT_EDITABLE_STATES}) excludes it.
 * On `legacy` it is an ordinary working state: an эфир sits there between
 * creation and «Архивировать», and again after «Скрыть», and correcting its
 * title or speakers in that window is exactly what the operator needs to do
 * before publishing it to the archive. Both legacy states are therefore
 * editable, which is also what makes «origin is rejected by every update path»
 * a testable claim rather than an untestable one behind a 409.
 */
function isEditable(event: Event): boolean {
  const state = event.state as EventLifecycleState;
  return event.origin === "legacy"
    ? state === "hidden" || state === "in_archive"
    : EVENT_EDITABLE_STATES.includes(state);
}

/** Slugify a (possibly non-ASCII) title into a URL-safe, collision-resistant handle. */
function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = randomBytes(4).toString("hex");
  return `${ascii || "event"}-${suffix}`;
}

/** Sanitize an uploaded filename into a safe object-key segment. */
function safeName(filename: string): string {
  return (
    filename
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "program.pdf"
  );
}

/**
 * 007 authoring service — the write model (design §3). EARS-1 lands the create
 * path (event → `draft`, program PDF → object storage) plus the two admin reads
 * (`EventAdminList` / `EventAdminDetail`). The transition commands + the
 * server-side guard are sibling handlers (EARS-4…7); the lifecycle vocabulary +
 * the closed transition map are the shared SSOT in `@ds/schemas`.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    // Explicit token, not type-inferred: the root-level `endpoint-authz` gate
    // boots this graph under `tsx`, whose esbuild transform emits no
    // `design:paramtypes`. Nest then derives the dependency array from the
    // `@Inject` indices alone, so an undecorated parameter that happens to sit
    // BELOW the highest decorated index resolves to `undefined` and aborts the
    // boot. Same rule the taxonomy module already follows for every dependency.
    @Inject(EventsRepository) private readonly repo: EventsRepository,
    // 012 EARS-8 (#1290) — the ONE canonical merged speaker resolver. Both
    // public projections below read speakers through it; this service no longer
    // assembles a public speaker list of its own, which is precisely what keeps
    // the page, the standalone endpoint and the card from disagreeing.
    @Inject(SpeakerProjectionService)
    private readonly speakerProjection: SpeakerProjectionService,
    @Inject(RecordingsProjectionService)
    private readonly recordingsProjection: RecordingsProjectionService,
  ) {}

  /**
   * EARS-1 — create an event in `draft` with the full field set. The МСК
   * wall-clock is folded into ONE canonical UTC instant; the program PDF (when
   * present) is uploaded to object storage and only its reference lands on the
   * aggregate. Speakers are NOT part of this payload: since 012 EARS-24 the
   * only speaker source is the `event_experts` link table, curated through the
   * event-experts admin panel.
   */
  async create(
    input: CreateEventRequest,
    pdf?: UploadedPdf,
  ): Promise<EventAdminDetail> {
    const slug = slugify(input.title);

    const programPdfRef = pdf ? await this.storeProgramPdf(slug, pdf) : null;

    const aggregate = await this.repo.insert(
      {
        slug,
        title: input.title,
        school: input.school,
        startsAt: mskLocalToInstant(input.startsAtMsk),
        durationMin: input.durationMin,
        description: input.description,
        specialties: input.specialties,
        partnerRef: input.partnerRef ?? null,
        programPdfRef,
        state: "draft",
      },
    );

    return this.toDetail(aggregate);
  }

  /**
   * Upload a program PDF to object storage under a fresh, event-scoped key and
   * return the stored reference. A **new** key per upload (title slug + a
   * monotonic timestamp) means a replacement (EARS-2) never overwrites the
   * superseded object in place — the aggregate points at the new key only once
   * the swap commits, so a crash mid-replace can never corrupt the served file;
   * the superseded object is then GC'd post-commit ({@link update}, #627).
   */
  private async storeProgramPdf(
    slug: string,
    pdf: UploadedPdf,
  ): Promise<string> {
    const key = `events/programs/${slug}/${Date.now()}-${safeName(pdf.filename)}`;
    const stored = await this.storage.put({
      key,
      body: pdf.body,
      contentType: pdf.contentType,
    });
    return stored.key;
  }

  /**
   * EARS-2 — `UpdateEvent`: edit an event's authored fields at any **pre-hide**
   * state and, when a replacement `programPdf` rides the request, supersede the
   * stored object reference so the 004 public page serves the **current** file and
   * the superseded file is no longer served. The operator never has to unpublish
   * to correct a detail — an edit is not a state reversal (the lifecycle `state`
   * is untouched here; it moves only through the guarded transition commands,
   * EARS-7). An edit to a `hidden` event is refused with
   * {@link EventNotEditableError} ({@link EVENT_EDITABLE_STATES}) — the aggregate
   * is untouched and no PDF is replaced. Only the fields present in `input` are
   * overwritten (an omitted key leaves that field; `partnerRef: null` explicitly
   * clears it). The МСК re-entry is re-folded into one canonical instant, the
   * single SSOT conversion ({@link mskLocalToInstant}).
   *
   * **GC-on-supersede (#627).** Once the reference swap is durably committed,
   * the superseded object key is deleted from object storage — never before the
   * commit (a crash between delete and commit must not lose a still-referenced
   * object). The delete is **best-effort**: a storage failure is warn-logged
   * with the orphan key and the edit still succeeds (a rare orphan from a
   * failed delete is acceptable by documented policy — design §3).
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async update(
    id: string,
    input: UpdateEventRequest,
    pdf?: UploadedPdf,
  ): Promise<EventAdminDetail | null> {
    const current = await this.repo.findById(id);
    if (!current) return null;

    // 014 EARS-23 — `origin` is absent from `UpdateEventRequestSchema` and from
    // the patch key set below, so no update path can reach the column: an
    // `origin` key on the body is dropped at the I/O boundary and never becomes
    // a patch field. The discriminator is set once at creation, full stop.
    const state = current.event.state as EventLifecycleState;
    if (!isEditable(current.event)) {
      throw new EventNotEditableError(state);
    }

    const patch: Partial<
      Pick<
        NewEvent,
        | "title"
        | "school"
        | "startsAt"
        | "durationMin"
        | "description"
        | "specialties"
        | "partnerRef"
        | "programPdfRef"
        | "recordingExpectedBy"
      >
    > = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.school !== undefined) patch.school = input.school;
    if (input.startsAtMsk !== undefined)
      patch.startsAt = mskLocalToInstant(input.startsAtMsk);
    if (input.durationMin !== undefined) patch.durationMin = input.durationMin;
    if (input.description !== undefined) patch.description = input.description;
    if (input.specialties !== undefined) patch.specialties = input.specialties;
    // `null` clears the reference, a string sets it, `undefined` leaves it.
    if (input.partnerRef !== undefined) patch.partnerRef = input.partnerRef;
    // 014 EARS-1 (#1339) — the operator's recording-readiness date. `null` clears
    // the promise, a `YYYY-MM-DD` string sets it, `undefined` leaves it. Stored as
    // a `date`, so the value round-trips as the day the operator typed.
    if (input.recordingExpectedBy !== undefined)
      patch.recordingExpectedBy = input.recordingExpectedBy;
    // A replacement PDF supersedes the stored reference (EARS-2).
    if (pdf)
      patch.programPdfRef = await this.storeProgramPdf(current.event.slug, pdf);

    const updated = await this.repo.updateEvent(id, patch);
    // The row existed a moment ago; a concurrent delete is the only null path.
    if (!updated) return null;

    // GC-on-supersede (#627): the swap is durably committed above, so the
    // superseded object is now unreferenced — delete it so the bucket's steady
    // state stays exactly the referenced set. Best-effort: a failed delete
    // leaves a warn-logged orphan, never a failed edit.
    const superseded = current.event.programPdfRef;
    if (
      pdf &&
      superseded &&
      patch.programPdfRef !== undefined &&
      superseded !== patch.programPdfRef
    ) {
      try {
        await this.storage.delete(superseded);
      } catch (err) {
        this.logger.warn(
          `superseded program-PDF delete failed — orphan object left in storage: key=${superseded} eventId=${id} error=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return this.toDetail(updated);
  }

  /** `EventAdminList` — all events regardless of state (`platform_admin`-only). */
  async list(query: EventAdminListQuery): Promise<{
    data: EventAdminListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { rows, total } = await this.repo.listAdminPage(query);
    // 014 EARS-25 (#1741) — the archive edge is offered only when the эфир has
    // something to archive, so a page resolves recordings for the rows that can
    // reach that edge at all (`legacy` + `hidden`) in ONE batched read, never
    // per row and never for the rows the answer cannot change.
    const archivable = rows.filter(
      (row) => row.origin === "legacy" && row.state === "hidden",
    );
    const projections =
      archivable.length > 0
        ? await this.recordingsProjection.resolveRecordingProjections(
            archivable.map((row) => row.id),
          )
        : undefined;
    return {
      data: rows.map((row) =>
        this.toListItem(
          row,
          projections?.get(row.id)?.state !== undefined &&
            projections.get(row.id)!.state !== "preparing",
        ),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** `EventAdminDetail` — the full editable aggregate (or null when not found). */
  async detail(id: string): Promise<EventAdminDetail | null> {
    const found = await this.repo.findById(id);
    return found ? this.toDetail(found) : null;
  }

  /**
   * EARS-3 — `ConfigureStream`: record the event's stream config from an
   * **explicit** provider in the closed enum `rutube | youtube` plus an embed
   * reference (the provider-scoped stream id, never a URL to be sniffed — the
   * enum is validated at the I/O boundary by `ConfigureStreamRequestSchema`, so
   * an unknown provider is a 400 and never reaches here, and no config is
   * recorded for it). The write is an idempotent upsert (one config per event),
   * so correcting a wrong reference while `published` replaces the single row
   * with **no state reversal** (US-3). Configuring is refused
   * ({@link StreamNotConfigurableError}) outside the pre-air window (design §2,
   * {@link STREAM_CONFIGURABLE_STATES}); the 006 room later instantiates the
   * player from exactly this persisted config, switching on `provider` — never
   * inferring it from the URL string.
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async configureStream(
    id: string,
    input: ConfigureStreamRequest,
  ): Promise<EventAdminDetail | null> {
    const current = await this.repo.findById(id);
    if (!current) return null;

    // 014 EARS-27 — a `legacy` эфир never acquires a stream config. Checked
    // BEFORE the window check so the refusal names the real reason (the command
    // does not exist on this machine), not «not configurable while hidden».
    assertBroadcastCommandOrigin(current.event);
    const state = current.event.state as EventLifecycleState;
    if (!STREAM_CONFIGURABLE_STATES.includes(state)) {
      throw new StreamNotConfigurableError(state);
    }

    const updated = await this.repo.upsertStreamConfig(id, input);
    // The row existed a moment ago; a concurrent delete is the only null path.
    return updated ? this.toDetail(updated) : null;
  }

  /**
   * EARS-7 — the single closed-set lifecycle guard. Move the event `to` a new
   * state iff `current → to` is one of the four legal forward transitions
   * ({@link canTransition}); every invalid jump (skip-forward, backward, reopen
   * `hidden`, the `published → draft` unpublish the PRD names none, or a
   * self-transition) is refused with {@link InvalidTransitionError} — the state
   * is never mutated. Enforcement is server-side, from the same closed map the
   * read-side `validTransitions` derives, so the admin UI and the API cannot
   * disagree about what is legal.
   *
   * This is the bare guarded transition every command runs through; the named
   * transition commands (publish / open / close / hide — EARS-4/5/6) layer
   * their product side-effects and the terminal `audit_ledger` row on top of it.
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async transition(
    id: string,
    to: EventLifecycleState,
    expectedVersion?: number,
  ): Promise<EventAdminDetail | null> {
    const current = await this.repo.findById(id);
    if (!current) return null;

    const from = current.event.state as EventLifecycleState;
    // 014 EARS-25/27 (#1741) — a `legacy` эфир has exactly TWO commands and both
    // are NAMED routes: `ArchiveLegacyBroadcast` carries the published-recording
    // precondition (409 `EVENT_NOT_FINISHED`) and `event.archived_legacy`,
    // `HideLegacyBroadcast` carries `event.hidden_legacy`. This generic endpoint
    // writes state through the bare `updateState` — no precondition, no audit
    // row — so letting it reach either legacy edge would be precisely the
    // «set-any-state escape hatch» 014-design §3.1 rules out: an эфир archived
    // with no recording to show and no feature-010 row to read it back from.
    // Refused 409 `INVALID_TRANSITION` before the version check and any write,
    // and the refusal carries the REAL requested `to` from the body — this is
    // the one entry point whose target the caller chose (#1815 review NIT A).
    assertBroadcastCommandOrigin(current.event, from, to);
    // Still keyed by the event's OWN machine, so a platform event cannot be
    // jumped onto the legacy machine's states either.
    if (!canTransition(from, to, current.event.origin)) {
      throw new InvalidTransitionError(from, to);
    }
    assertVersion(current.event, expectedVersion);

    const updated = await this.repo.updateState(id, to, expectedVersion);
    return this.resolveWriteOutcome(id, updated, expectedVersion);
  }

  /**
   * Disambiguate a repository write that touched no row. The CAS clause and the
   * existence clause both live in one `WHERE`, so zero rows means EITHER the
   * aggregate is gone (404) OR it moved under the caller (412) — a distinction
   * the repository deliberately does not make (it has no notion of either HTTP
   * answer). Re-reading here is what keeps «not found» from being reported for a
   * row that is merely at a newer version.
   */
  private async resolveWriteOutcome(
    id: string,
    updated: EventAggregate | null,
    expectedVersion: number | undefined,
  ): Promise<EventAdminDetail | null> {
    if (updated) return this.toDetail(updated);
    if (expectedVersion === undefined) return null;
    const still = await this.repo.findById(id);
    if (!still) return null;
    throw new EventVersionConflictError(expectedVersion, still.event.version);
  }

  /**
   * EARS-4 — `PublishEvent`: the `draft → published` transition, the single
   * visibility signal that makes the event publicly reachable on the 004 event
   * page + upcoming listing and opens 005 registration gating (one state write,
   * no boolean flag — EARS-9). Runs through the same EARS-7 closed-set guard as
   * every other transition ({@link canTransition}): publish is **refused unless
   * the event is in `draft`** — any non-draft origin raises
   * {@link InvalidTransitionError} and the state is left untouched. On success
   * the state change and exactly one terminal `audit_ledger` row are written
   * atomically ({@link EventsRepository.updateStateWithAudit}), keyed to the
   * acting `platform_admin` (`actorSub`).
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async publish(
    id: string,
    actorSub: string | null,
    expectedVersion?: number,
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "published",
      EVENT_PUBLISHED_AUDIT_TYPE,
      actorSub,
      assertBroadcastCommandOrigin,
      undefined,
      expectedVersion,
    );
  }

  /**
   * EARS-5 — `OpenRoom`: the `published → live` transition, the director's
   * air-day action that opens the 006 room (admission of registered doctors +
   * presence capture start) and flips 004's "live now" signal off the same
   * `EventLifecycleState` (no second flag — EARS-9). Runs through the same EARS-7
   * closed-set guard as every transition ({@link canTransition}): open is
   * **refused unless the event is in `published`** — any other origin raises
   * {@link InvalidTransitionError} and the state is left untouched. On success
   * the state change and exactly one terminal `audit_ledger` row are written
   * atomically ({@link EventsRepository.updateStateWithAudit}), keyed to the
   * acting `platform_admin` (`actorSub`). 006's own admission/heartbeat/chat
   * logic consumes this `live` window — it is not this handler's concern.
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async openRoom(
    id: string,
    actorSub: string | null,
    expectedVersion?: number,
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "live",
      EVENT_WENT_LIVE_AUDIT_TYPE,
      actorSub,
      assertBroadcastCommandOrigin,
      undefined,
      expectedVersion,
    );
  }

  /**
   * EARS-5 — `CloseRoom`: the `live → ended` transition, the director's action
   * that closes the 006 room (admission + heartbeat/chat acceptance stop) and
   * **bounds the presence window** (006 EARS-7), and flips 004 to the ended
   * state off the same `EventLifecycleState`. Runs through the same EARS-7
   * closed-set guard: close is **refused unless the event is in `live`** — any
   * other origin raises {@link InvalidTransitionError} with the state untouched.
   * On success the state change and exactly one terminal `audit_ledger` row are
   * written atomically, keyed to the acting `platform_admin`.
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async closeRoom(
    id: string,
    actorSub: string | null,
    expectedVersion?: number,
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "ended",
      EVENT_ENDED_AUDIT_TYPE,
      actorSub,
      // 014 EARS-23/27 (#1741) — no command-specific STATE precondition any more.
      // `live → ended` is once again the ONLY edge into `ended` on the platform
      // machine (the 014 EARS-18 `published → ended` fork is gone), so the
      // closed-set check in {@link namedTransition} refuses every other origin
      // state on its own. What remains is the machine guard every broadcast
      // command carries: `CloseRoom` belongs to 007 and never applies to a
      // `legacy` эфир.
      assertBroadcastCommandOrigin,
      undefined,
      expectedVersion,
    );
  }

  /**
   * EARS-6 — `HideEvent`: the `ended → hidden` transition, the operator's
   * **manual** post-broadcast action (LD-2 — no scheduler, no time-based
   * automation in wave 1 fires it). After it, the event **leaves all public
   * surfaces**: 004's upcoming listing drops it by state and its public event
   * page degrades to the hidden-notice body (004 EARS-5) — both consuming the
   * single `EventLifecycleState` this writes, never a second flag (EARS-9). Runs
   * through the same EARS-7 closed-set guard as every transition
   * ({@link canTransition}): hide is **refused unless the event is in
   * `ended`** — any other origin raises {@link InvalidTransitionError} with the
   * state left untouched and no audit row. On success the state change and
   * exactly one terminal `audit_ledger` row are written atomically
   * ({@link EventsRepository.updateStateWithAudit}), keyed to the acting
   * `platform_admin` (`actorSub`). `hidden` is terminal (no reopen — EARS-7).
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async hide(
    id: string,
    actorSub: string | null,
    expectedVersion?: number,
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "hidden",
      EVENT_HIDDEN_AUDIT_TYPE,
      actorSub,
      // 014 EARS-27 (#1741) — the closed set does NOT carry this one on its own:
      // `in_archive → hidden` is a legal LEGACY edge, so a legacy эфир sitting in
      // `in_archive` would answer 007's terminal `HideEvent` with 200 and stamp
      // {@link EVENT_HIDDEN_AUDIT_TYPE} on a REVERSIBLE hide — the exact ledger
      // ambiguity the two ids exist to prevent, running mirror to the hole
      // {@link assertLegacyCommandOrigin} closes.
      assertBroadcastCommandOrigin,
      undefined,
      expectedVersion,
    );
  }

  /**
   * 014 EARS-25 (#1741) — `ArchiveLegacyBroadcast` («Архивировать»): the legacy
   * machine's `hidden → in_archive` transition. From that instant the эфир is
   * listed in the public archive exactly like an `ended` platform broadcast with
   * a published recording (EARS-26) — the same card, the same «Прошедшие» tab,
   * the same post-live page.
   *
   * Two guards on top of the closed-set check, in this order:
   *
   * 1. the origin-keyed map itself. `hidden → in_archive` exists ONLY under
   *    `legacy`, so the same call on a `platform` event is refused with 409
   *    `INVALID_TRANSITION` and no mutation (EARS-27) — no guard of its own;
   * 2. the эфир must already carry a PUBLISHED, non-retired recording — the
   *    thing it exists to carry. Refused with 409 `EVENT_NOT_FINISHED`
   *    otherwise, the same code 014 §3 already uses for «this event is not in a
   *    state where a recording may be published», read from the other direction.
   *
   * @param fence the 012-design §6 idempotency completion, enlisted in the same
   * transaction as the state change and the audit row.
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async archiveLegacy(
    id: string,
    actorSub: string | null,
    fence?: TransitionFence,
    expectedVersion?: number,
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "in_archive",
      EVENT_ARCHIVED_LEGACY_AUDIT_TYPE,
      actorSub,
      assertLegacyCommandOrigin,
      fence,
      expectedVersion,
      // Resolved INSIDE the command rather than handed in by the caller: the
      // read model's `validTransitions` is a hint the operator's screen may have
      // been holding for a while, and the archive gate has to be decided against
      // the state of the recordings NOW, not against what the panel rendered.
      async (event) => {
        const projection =
          await this.recordingsProjection.resolveRecordingProjection(event.id);
        if (projection.state === "preparing") {
          throw new EventNotFinishedError(event.id);
        }
      },
    );
  }

  /**
   * 014 EARS-25 (#1741) — `HideLegacyBroadcast` («Скрыть»): the legacy machine's
   * `in_archive → hidden` transition. The эфир leaves every listing, tab and
   * count, and its direct link renders feature 004's notice — the same meaning
   * `hidden` carries on the broadcast machine.
   *
   * Unlike 007's terminal `ended → hidden`, this move is REVERSIBLE: the эфир
   * can be archived again, which is why it writes its own
   * {@link EVENT_HIDDEN_LEGACY_AUDIT_TYPE} row rather than reusing
   * {@link EVENT_HIDDEN_AUDIT_TYPE} — a ledger that used one id for both could
   * not tell a terminal hide from a temporary one. It has no precondition beyond
   * the origin-keyed closed set: `in_archive → hidden` exists only under
   * `legacy`, so the same call on a `platform` event is refused 409
   * `INVALID_TRANSITION` with no mutation.
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async hideLegacy(
    id: string,
    actorSub: string | null,
    fence?: TransitionFence,
    expectedVersion?: number,
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "hidden",
      EVENT_HIDDEN_LEGACY_AUDIT_TYPE,
      actorSub,
      assertLegacyCommandOrigin,
      fence,
      expectedVersion,
    );
  }

  /**
   * 014 EARS-24 (#1741) — `CreateLegacyBroadcast`: the «Архивный эфир» creation
   * entry. One `legacy` event authored from a title, a held-at instant, a
   * duration and a recording, BORN `hidden` — it appears on no public
   * surface until an explicit `ArchiveLegacyBroadcast`.
   *
   * `origin` and `state` are server-assigned, never read off the body (the
   * `.strict()` schema refuses either key at the I/O boundary). The эфир
   * acquires NO room record, NO stream config and NO presence window — not
   * because this method omits them, but because nothing on the legacy machine
   * can ever create them: `ConfigureStream` is refused by
   * {@link assertBroadcastCommandOrigin} and `live` is unreachable in
   * `LIFECYCLE_TRANSITIONS.legacy`.
   *
   * The event and its recording land in ONE transaction. A two-call shape —
   * create, then attach — could leave an эфир with no recording, which is an
   * эфир that can never be archived and therefore an untracked seam (AGENTS.md
   * §6, F-22); the repository is what makes «an archival эфир always has
   * something to archive» a database fact rather than a client convention.
   *
   * The automated import of #1742 lands its events through THIS path (EARS-24),
   * which is why the input is one validated body rather than an argument list
   * shaped for the admin form.
   */
  async createLegacyBroadcast(
    input: LegacyBroadcastCreateBody,
  ): Promise<EventAdminDetail> {
    const slug = slugify(input.title);
    const aggregate = await this.repo.insertLegacyBroadcast(
      {
        slug,
        title: input.title,
        school: input.school,
        startsAt: mskLocalToInstant(input.heldAtMsk),
        durationMin: input.durationMin,
        description: input.description,
        specialties: input.specialties,
        partnerRef: null,
        programPdfRef: null,
        origin: "legacy",
        state: "hidden",
      },
      {
        kind: input.recording.kind,
        provider: input.recording.provider,
        embedRef: input.recording.embedRef,
        posterRef: input.recording.posterRef ?? null,
        durationSec: input.recording.durationSec ?? null,
      },
    );
    return this.toDetail(aggregate);
  }

  /**
   * The shared body of every named, audited transition command (publish / open /
   * close / hide / archive-legacy / hide-legacy — EARS-4/5/6 + 014 EARS-25): load the
   * aggregate, run the EARS-7 closed-set guard
   * ({@link canTransition}) — refusing an invalid jump with
   * {@link InvalidTransitionError}, state untouched — then write the state change
   * and exactly one terminal `audit_ledger` row atomically. Keeps the named
   * commands a single source of truth for the guard + audit obligation.
   *
   * @param extraGuard a command-specific precondition run after the closed-set
   * guard and before any write; it throws to refuse, leaving the state untouched.
   * @param fence an optional writer enlisted in the transition's own transaction
   * (012-design §6 idempotency completion) — see {@link TransitionFence}.
   * @param expectedVersion #1593 — the `If-Match` validator. Checked LAST among
   * the guards ({@link assertVersion}) and re-asserted as a CAS clause on the
   * write, so a stale caller is refused with a 412 and never applies a command
   * decided against a read the aggregate has moved past.
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  private async namedTransition(
    id: string,
    to: EventLifecycleState,
    auditType: string,
    actorSub: string | null,
    extraGuard?: (
      event: Event,
      from: EventLifecycleState,
      to: EventLifecycleState,
    ) => void,
    fence?: TransitionFence,
    expectedVersion?: number,
    asyncGuard?: (event: Event, from: EventLifecycleState) => Promise<void>,
  ): Promise<EventAdminDetail | null> {
    const current = await this.repo.findById(id);
    if (!current) return null;

    const from = current.event.state as EventLifecycleState;
    // 014 EARS-27: the map is keyed by ORIGIN, so a broadcast command on a
    // `legacy` event and a legacy command on a `platform` event are both absent
    // edges — refused here, before anything else is read or written.
    if (!canTransition(from, to, current.event.origin)) {
      throw new InvalidTransitionError(from, to);
    }
    // The command's OWN target is handed to the guard, so a wrong-machine
    // refusal reports the move that was actually asked for rather than a
    // self-transition placeholder (#1815 review NIT A).
    extraGuard?.(current.event, from, to);
    await asyncGuard?.(current.event, from);
    assertVersion(current.event, expectedVersion);

    const updated = await this.repo.updateStateWithAudit(
      id,
      to,
      { eventType: auditType, subjectId: actorSub, from },
      // The fence is handed the SAME projection this method returns, so the
      // completion the record stores and the body the caller receives cannot
      // differ (012-design §6).
      fence && (async (tx, row) => fence(tx, await this.toDetail(row))),
      expectedVersion,
    );
    return this.resolveWriteOutcome(id, updated, expectedVersion);
  }

  /**
   * 004 EARS-1 + EARS-6 — the public event-page projection resolved by slug or
   * id, under the non-public visibility policy (004 design §2). The reachability
   * gate is the {@link isPubliclyReachable} SSOT predicate (derived from the
   * publicly-renderable allow-list, not a `draft` denylist): a state outside that
   * allow-list has no public projection (returns null → the controller answers
   * 404, indistinguishable from an unknown id — a hidden `draft` leaks no oracle,
   * EARS-6). `published` / `live` / `ended` / `hidden` all return the
   * publish-safe {@link HostFreeEventPageView} (a hidden event resolves to a 200 body
   * labeled `hidden`, never a 404 — EARS-5). The projection is an ALLOW-LIST:
   * only publish-safe fields are read onto the body (EARS-10).
   */
  /**
   * 020 EARS-2 (#1765) — the result is the HOST-FREE half of the read: every
   * field that is a fact of the EVENT. The `links` half is resolved by the
   * calling host route through `around-event.resolver.ts`, because «is there a
   * school page to link to» is a fact of the storefront serving the request,
   * not of the event — and this service knows no host.
   */
  async publicEventPage(
    idOrSlug: string,
  ): Promise<HostFreeEventPageView | null> {
    const found = await this.repo.findByIdOrSlug(idOrSlug);
    if (!found) return null;
    const state = found.event.state as EventLifecycleState;
    if (!isPubliclyReachable(state)) return null;
    return this.toPublicPage(found, state);
  }

  /**
   * 004 EARS-7 — the upcoming-broadcasts listing. Returns the thin
   * {@link UpcomingBroadcastCard} projection for every `published`/`live` event
   * at or after the air-window cutoff (`now − {@link AIR_WINDOW_MS}`), ordered
   * nearest air date first. An empty result is a valid `[]` (the portal renders
   * the empty-state, EARS-11). `now` is injectable for deterministic tests.
   */
  async listUpcoming(now: Date = new Date()): Promise<UpcomingBroadcastCard[]> {
    const cutoff = new Date(now.getTime() - AIR_WINDOW_MS);
    const rows = await this.repo.listUpcoming(cutoff);
    // 012 EARS-8: ONE batched resolver call for the whole page — never one per
    // card. The card's `{ name }` array is a MAPPING of the merged result, not a
    // second merge (012-design §5.2).
    const speakers = await this.speakerProjection.resolveMany(
      rows.map((r) => r.event.id),
    );
    return rows.map((r) =>
      this.toUpcomingCard(r, speakers.get(r.event.id) ?? []),
    );
  }

  /** 014 EARS-11 cursor-paged public list used by the controlled `/webinars` tabs. */
  async listPublicEvents(
    query: PublicEventListingQuery,
    now: Date = new Date(),
  ): Promise<PublicEventListingPage> {
    const cutoff = new Date(now.getTime() - AIR_WINDOW_MS);
    const after = decodeEventListingCursor(query.cursor);
    const counts = await this.repo.publicListingCounts(cutoff);
    const rows =
      query.timeframe === "past"
        ? await this.repo.listPast(query.limit + 1, after)
        : await this.repo.listUpcoming(cutoff, query.limit + 1, after);
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const next = hasMore ? pageRows.at(-1) : undefined;
    const speakers = await this.speakerProjection.resolveMany(
      pageRows.map((row) => row.event.id),
    );

    if (query.timeframe === "past") {
      const recordings =
        await this.recordingsProjection.resolveRecordingProjections(
          pageRows.map((row) => row.event.id),
        );
      const data: PastBroadcastCard[] = pageRows.map((row) => ({
        ...this.toUpcomingCard(row, speakers.get(row.event.id) ?? []),
        state: "ended",
        recording: recordings.get(row.event.id)!,
      }));
      return {
        data,
        counts,
        pagination: {
          hasMore,
          nextCursor: next
            ? encodeEventListingCursor({
                startsAt: next.startsAtCursor,
                id: next.event.id,
              })
            : null,
        },
      };
    }

    return {
      data: pageRows.map((row) =>
        this.toUpcomingCard(row, speakers.get(row.event.id) ?? []),
      ),
      counts,
      pagination: {
        hasMore,
        nextCursor: next
          ? encodeEventListingCursor({
              startsAt: next.startsAtCursor,
              id: next.event.id,
            })
          : null,
      },
    };
  }

  /**
   * 004 EARS-15 — the month-range read. Returns the thin
   * {@link MonthBroadcastEntry} projection for every publish-visible
   * (`published`/`live`/`ended`) event whose start instant falls in the requested
   * МСК month, ordered nearest air date first — the month's already-past `ended`
   * events INCLUDED by design (§3). The МСК month boundaries are the single SSOT
   * {@link mskMonthRange} half-open `[start, end)` range; the caller (controller)
   * has already validated the `YYYY-MM` shape (a malformed month is a 400 before
   * this runs). An empty month is a valid `[]`.
   */
  async listMonthBroadcasts(month: string): Promise<MonthBroadcastEntry[]> {
    const { start, end } = mskMonthRange(month);
    const rows = await this.repo.listMonthBroadcasts(start, end);
    return rows.map((e) => this.toMonthEntry(e));
  }

  /**
   * 004 EARS-16 — the month-picker counts. Returns exactly 12 rows
   * `{ month, count }` for the requested year, counting only publish-visible
   * (`published`/`live`/`ended`) events grouped by МСК calendar month. The repo
   * returns only the months that have events; the zero months are filled here so
   * the picker always receives a dense 12-row response. The caller (controller)
   * has already validated the `YYYY` shape (a malformed year is a 400).
   */
  async monthlyEventCounts(year: string): Promise<MonthlyEventCount[]> {
    const { start, end } = mskYearRange(year);
    const counts = await this.repo.monthlyCounts(start, end);
    return Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      count: counts.get(i + 1) ?? 0,
    }));
  }

  private toMonthEntry(e: Event): MonthBroadcastEntry {
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      // The repo filters to published/live/ended, so the residual is the month
      // entry subset (draft/hidden have no month projection — EARS-15).
      state: e.state as MonthBroadcastState,
    };
  }

  private toUpcomingCard(
    a: EventAggregate,
    merged: PublicEventPageSpeaker[],
  ): UpcomingBroadcastCard {
    const e = a.event;
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      specialties: e.specialties,
      // Card speakers are name-only — no `regalia`/credentials cross onto the
      // listing (thinner than the event page, EARS-10). The ORDER and the
      // membership are the merged resolver's (012 EARS-8); only the projection
      // is thinner.
      speakers: merged.map((s) => ({ name: s.name })),
      // The repo filters to published/live, so the residual is the card subset.
      state: e.state as UpcomingBroadcastState,
    };
  }

  private async toPublicPage(
    a: EventAggregate,
    state: EventLifecycleState,
  ): Promise<HostFreeEventPageView> {
    const e = a.event;
    const page: HostFreeEventPageView = {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      durationMin: e.durationMin,
      description: e.description,
      // 012 EARS-8: the merged legacy+expert union from the ONE canonical
      // resolver — byte-identical to `GET /v1/public/events/:key/speakers`.
      speakers: await this.speakerProjection.resolve(e.id),
      specialties: e.specialties,
      // `partner_ref` is free text in wave 1; publicly it is a display label
      // only (no commercial terms). Absent ref ⇒ empty list, never a null entry.
      partners: e.partnerRef ? [{ label: e.partnerRef }] : [],
      // `draft` is excluded above, so the residual states are the public subset.
      state: state as PublicEventState,
      // 014 EARS-4: the recording answer comes from the ONE canonical resolver
      // that `listPublicEvents` already reads, never a page-local rule — so the
      // card and the page can never disagree about what is published. The
      // projection is SOURCE-FREE by construction (no provider, no embed ref):
      // the login gate of 014-design §5 is enforced in the payload itself, not
      // in a rendering decision. Always present — `preparing` is the honest
      // answer when nothing is published, never an omitted field.
      recording: await this.recordingsProjection.resolveRecordingProjection(
        e.id,
      ),
      // 020 EARS-1 (#1764): the attendance mode and the remaining offline seats
      // are facts of the EVENT, so they are read here once and are identical on
      // both storefront hosts — `seatsLeft: null` means «no seat limit», which
      // is a different answer from `0` («мест нет»).
      format: e.participationFormat,
      seatsLeft: e.seatsLeft,
    };
    // Omit (not null) the field when the event carries no program PDF (EARS-2).
    // Signed at read time — the bucket is private, an unsigned URL is dead (#842).
    if (e.programPdfRef) {
      page.programPdfUrl = await this.storage.urlFor(e.programPdfRef);
    }
    return page;
  }

  private async toDetail(a: EventAggregate): Promise<EventAdminDetail> {
    const e = a.event;
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      durationMin: e.durationMin,
      description: e.description,
      specialties: e.specialties,
      partnerRef: e.partnerRef,
      programPdfRef: e.programPdfRef,
      programPdfUrl: e.programPdfRef
        ? await this.storage.urlFor(e.programPdfRef)
        : null,
      streamConfig: a.streamConfig,
      state: e.state as EventLifecycleState,
      origin: e.origin,
      validTransitions: offeredTransitions(
        e,
        await this.hasPublishedRecording(e),
      ),
      recordingExpectedBy: e.recordingExpectedBy,
      // #1593 — the validator the `ETag` carries, on the body too so a client
      // holding a parsed detail can re-derive it without retaining a header.
      version: e.version,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toListItem(
    e: Event,
    hasPublishedRecording: boolean,
  ): EventAdminListItem {
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      durationMin: e.durationMin,
      state: e.state as EventLifecycleState,
      origin: e.origin,
      validTransitions: offeredTransitions(e, hasPublishedRecording),
    };
  }

  /**
   * 014 EARS-25 (#1741) — does this event carry a published, non-retired
   * recording right now? Only ever asked of a `legacy` эфир sitting in `hidden`,
   * because that is the ONLY state the `hidden → in_archive` edge is reachable
   * from (see {@link offeredTransitions}) — every other event answers `false`
   * without a query. `preparing` is the projection's «nothing published» answer.
   */
  private async hasPublishedRecording(e: Event): Promise<boolean> {
    if (e.origin !== "legacy" || e.state !== "hidden") return false;
    const projection =
      await this.recordingsProjection.resolveRecordingProjection(e.id);
    return projection.state !== "preparing";
  }
}
