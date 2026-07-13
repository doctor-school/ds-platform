import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Event, NewEvent } from "@ds/db";
import {
  canTransition,
  type ConfigureStreamRequest,
  type CreateEventRequest,
  type EventAdminDetail,
  type EventAdminListItem,
  type EventLifecycleState,
  isPubliclyReachable,
  mskLocalToInstant,
  type PublicEventPage,
  type PublicEventState,
  type UpcomingBroadcastCard,
  type UpcomingBroadcastState,
  type UpdateEventRequest,
  validTransitions,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import {
  type EventWithSpeakers,
  EventsRepository,
} from "./events.repository.js";

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
 * aggregate; the sibling transitions (open/close/archive — EARS-5/6) add
 * `event.went_live` / `event.ended` / `event.archived` alongside it.
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
 * Canonical `audit_ledger` event id for the `ended → archived` transition — the
 * operator's manual post-broadcast archive (EARS-6, LD-2; ADR-0003 §6). Same
 * `event.<transition>` namespace as the sibling transitions; consumed by 004
 * (the event leaves the upcoming listing and its public page degrades to the
 * archived notice). There is no scheduler — the row is written only by an
 * explicit operator command.
 */
export const EVENT_ARCHIVED_AUDIT_TYPE = "event.archived";

/**
 * The EARS-7 guard's refusal: the requested move is not one of the four legal
 * forward transitions from the event's current state. HTTP-agnostic — the
 * controller maps it to a 4xx state conflict — so the guard stays a pure domain
 * rule, testable without a transport. `from`/`to` are the offending pair.
 */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: EventLifecycleState,
    readonly to: EventLifecycleState,
  ) {
    super(`illegal lifecycle transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * The lifecycle states in which the stream config may be authored or corrected
 * (design §2 — the config is *authorable* in `draft` and *still correctable* in
 * `published`, i.e. the pre-air window). Once the room is live the broadcast is
 * on air and the config is locked; `ended`/`archived` are terminal. Kept as a
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
 * requirements Scope). Editing is a **pre-archive** action — `draft` / `published`
 * / `live` / `ended` are all editable (the operator corrects a detail without any
 * state reversal — there is no unpublish, EARS-7). An `archived` event has left
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
 * The EARS-2 refusal: `UpdateEvent` was called on an `archived` event, outside
 * the pre-archive edit window ({@link EVENT_EDITABLE_STATES}). HTTP-agnostic —
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
    private readonly repo: EventsRepository,
  ) {}

  /**
   * EARS-1 — create an event in `draft` with the full field set. The МСК
   * wall-clock is folded into ONE canonical UTC instant; the program PDF (when
   * present) is uploaded to object storage and only its reference lands on the
   * aggregate. Speakers persist as an ordered free-text list (LD-1).
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
      input.speakers.map((s, position) => ({
        position,
        name: s.name,
        regalia: s.regalia,
      })),
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
   * EARS-2 — `UpdateEvent`: edit an event's authored fields at any **pre-archive**
   * state and, when a replacement `programPdf` rides the request, supersede the
   * stored object reference so the 004 public page serves the **current** file and
   * the superseded file is no longer served. The operator never has to unpublish
   * to correct a detail — an edit is not a state reversal (the lifecycle `state`
   * is untouched here; it moves only through the guarded transition commands,
   * EARS-7). An edit to an `archived` event is refused with
   * {@link EventNotEditableError} ({@link EVENT_EDITABLE_STATES}) — the aggregate
   * is untouched and no PDF is replaced. Only the fields present in `input` are
   * overwritten (an omitted key leaves that field; `partnerRef: null` explicitly
   * clears it); a present `speakers` list replaces the stored ordered list
   * wholesale. The МСК re-entry is re-folded into one canonical instant, the
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

    const state = current.event.state as EventLifecycleState;
    if (!EVENT_EDITABLE_STATES.includes(state)) {
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
    // A replacement PDF supersedes the stored reference (EARS-2).
    if (pdf)
      patch.programPdfRef = await this.storeProgramPdf(current.event.slug, pdf);

    const speakers = input.speakers?.map((s, position) => ({
      position,
      name: s.name,
      regalia: s.regalia,
    }));

    const updated = await this.repo.updateEvent(id, patch, speakers);
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
  async list(): Promise<{ data: EventAdminListItem[]; total: number }> {
    const rows = await this.repo.listAll();
    return { data: rows.map((r) => this.toListItem(r)), total: rows.length };
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
   * `archived`, the `published → draft` unpublish the PRD names none, or a
   * self-transition) is refused with {@link InvalidTransitionError} — the state
   * is never mutated. Enforcement is server-side, from the same closed map the
   * read-side `validTransitions` derives, so the admin UI and the API cannot
   * disagree about what is legal.
   *
   * This is the bare guarded transition every command runs through; the named
   * transition commands (publish / open / close / archive — EARS-4/5/6) layer
   * their product side-effects and the terminal `audit_ledger` row on top of it.
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async transition(
    id: string,
    to: EventLifecycleState,
  ): Promise<EventAdminDetail | null> {
    const current = await this.repo.findById(id);
    if (!current) return null;

    const from = current.event.state as EventLifecycleState;
    if (!canTransition(from, to)) {
      throw new InvalidTransitionError(from, to);
    }

    const updated = await this.repo.updateState(id, to);
    // The row existed a moment ago; a concurrent delete is the only null path.
    return updated ? this.toDetail(updated) : null;
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
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "published",
      EVENT_PUBLISHED_AUDIT_TYPE,
      actorSub,
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
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "live",
      EVENT_WENT_LIVE_AUDIT_TYPE,
      actorSub,
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
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(id, "ended", EVENT_ENDED_AUDIT_TYPE, actorSub);
  }

  /**
   * EARS-6 — `ArchiveEvent`: the `ended → archived` transition, the operator's
   * **manual** post-broadcast action (LD-2 — no scheduler, no time-based
   * automation in wave 1 fires it). After it, the event **leaves all public
   * surfaces**: 004's upcoming listing drops it by state and its public event
   * page degrades to the archived-notice body (004 EARS-5) — both consuming the
   * single `EventLifecycleState` this writes, never a second flag (EARS-9). Runs
   * through the same EARS-7 closed-set guard as every transition
   * ({@link canTransition}): archive is **refused unless the event is in
   * `ended`** — any other origin raises {@link InvalidTransitionError} with the
   * state left untouched and no audit row. On success the state change and
   * exactly one terminal `audit_ledger` row are written atomically
   * ({@link EventsRepository.updateStateWithAudit}), keyed to the acting
   * `platform_admin` (`actorSub`). `archived` is terminal (no reopen — EARS-7).
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  async archive(
    id: string,
    actorSub: string | null,
  ): Promise<EventAdminDetail | null> {
    return this.namedTransition(
      id,
      "archived",
      EVENT_ARCHIVED_AUDIT_TYPE,
      actorSub,
    );
  }

  /**
   * The shared body of every named, audited transition command (publish / open /
   * close / archive — EARS-4/5/6): load the aggregate, run the EARS-7 closed-set
   * guard
   * ({@link canTransition}) — refusing an invalid jump with
   * {@link InvalidTransitionError}, state untouched — then write the state change
   * and exactly one terminal `audit_ledger` row atomically. Keeps the four named
   * commands a single source of truth for the guard + audit obligation.
   *
   * @returns the updated `EventAdminDetail`, or `null` when the id does not exist.
   */
  private async namedTransition(
    id: string,
    to: EventLifecycleState,
    auditType: string,
    actorSub: string | null,
  ): Promise<EventAdminDetail | null> {
    const current = await this.repo.findById(id);
    if (!current) return null;

    const from = current.event.state as EventLifecycleState;
    if (!canTransition(from, to)) {
      throw new InvalidTransitionError(from, to);
    }

    const updated = await this.repo.updateStateWithAudit(id, to, {
      eventType: auditType,
      subjectId: actorSub,
      from,
    });
    // The row existed a moment ago; a concurrent delete is the only null path.
    return updated ? this.toDetail(updated) : null;
  }

  /**
   * 004 EARS-1 + EARS-6 — the public event-page projection resolved by slug or
   * id, under the non-public visibility policy (004 design §2). The reachability
   * gate is the {@link isPubliclyReachable} SSOT predicate (derived from the
   * publicly-renderable allow-list, not a `draft` denylist): a state outside that
   * allow-list has no public projection (returns null → the controller answers
   * 404, indistinguishable from an unknown id — a hidden `draft` leaks no oracle,
   * EARS-6). `published` / `live` / `ended` / `archived` all return the
   * publish-safe {@link PublicEventPage} (an archived event resolves to a 200 body
   * labeled `archived`, never a 404 — EARS-5). The projection is an ALLOW-LIST:
   * only publish-safe fields are read onto the body (EARS-10).
   */
  async publicEventPage(idOrSlug: string): Promise<PublicEventPage | null> {
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
    return rows.map((r) => this.toUpcomingCard(r));
  }

  private toUpcomingCard(a: EventWithSpeakers): UpcomingBroadcastCard {
    const e = a.event;
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      specialties: e.specialties,
      // Card speakers are name-only — no `regalia`/credentials cross onto the
      // listing (thinner than the event page, EARS-10).
      speakers: a.speakers
        .slice()
        .sort((x, y) => x.position - y.position)
        .map((s) => ({ name: s.name })),
      // The repo filters to published/live, so the residual is the card subset.
      state: e.state as UpcomingBroadcastState,
    };
  }

  private async toPublicPage(
    a: EventWithSpeakers,
    state: EventLifecycleState,
  ): Promise<PublicEventPage> {
    const e = a.event;
    const page: PublicEventPage = {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      durationMin: e.durationMin,
      description: e.description,
      speakers: a.speakers
        .slice()
        .sort((x, y) => x.position - y.position)
        .map((s) => ({ name: s.name, credentials: s.regalia })),
      specialties: e.specialties,
      // `partner_ref` is free text in wave 1; publicly it is a display label
      // only (no commercial terms). Absent ref ⇒ empty list, never a null entry.
      partners: e.partnerRef ? [{ label: e.partnerRef }] : [],
      // `draft` is excluded above, so the residual states are the public subset.
      state: state as PublicEventState,
    };
    // Omit (not null) the field when the event carries no program PDF (EARS-2).
    // Signed at read time — the bucket is private, an unsigned URL is dead (#842).
    if (e.programPdfRef) {
      page.programPdfUrl = await this.storage.urlFor(e.programPdfRef);
    }
    return page;
  }

  private async toDetail(a: EventWithSpeakers): Promise<EventAdminDetail> {
    const e = a.event;
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      durationMin: e.durationMin,
      description: e.description,
      speakers: a.speakers
        .slice()
        .sort((x, y) => x.position - y.position)
        .map((s) => ({ name: s.name, regalia: s.regalia })),
      specialties: e.specialties,
      partnerRef: e.partnerRef,
      programPdfRef: e.programPdfRef,
      programPdfUrl: e.programPdfRef
        ? await this.storage.urlFor(e.programPdfRef)
        : null,
      streamConfig: a.streamConfig,
      state: e.state as EventLifecycleState,
      validTransitions: validTransitions(e.state as EventLifecycleState),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toListItem(e: Event): EventAdminListItem {
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      school: e.school,
      startsAt: e.startsAt.toISOString(),
      durationMin: e.durationMin,
      state: e.state as EventLifecycleState,
      validTransitions: validTransitions(e.state as EventLifecycleState),
    };
  }
}
