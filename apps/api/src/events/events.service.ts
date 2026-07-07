import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Event } from "@ds/db";
import {
  canTransition,
  type CreateEventRequest,
  type EventAdminDetail,
  type EventAdminListItem,
  type EventLifecycleState,
  mskLocalToInstant,
  validTransitions,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import {
  type EventWithSpeakers,
  EventsRepository,
} from "./events.repository.js";

/** A program PDF extracted from the multipart request. */
export interface UploadedPdf {
  filename: string;
  contentType: string;
  body: Buffer;
}

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

    let programPdfRef: string | null = null;
    if (pdf) {
      const key = `events/programs/${slug}/${Date.now()}-${safeName(pdf.filename)}`;
      const stored = await this.storage.put({
        key,
        body: pdf.body,
        contentType: pdf.contentType,
      });
      programPdfRef = stored.key;
    }

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

  private toDetail(a: EventWithSpeakers): EventAdminDetail {
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
      programPdfUrl: e.programPdfRef ? this.storage.urlFor(e.programPdfRef) : null,
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
