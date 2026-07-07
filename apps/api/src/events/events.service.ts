import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Event } from "@ds/db";
import {
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
