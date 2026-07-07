import { z } from "zod";

// 007 — Event-admin aggregate contracts (API SSOT, ADR-0002 §3, ADR-0006 §6.2).
// Framework-agnostic; `apps/api` wraps these with `createZodDto` at the I/O
// boundary and the Refine admin app (apps/admin) + the 004/005/006 consumers
// share the same types. This file covers the EARS-1 create surface (the write
// model 004/005/006 read projections of) plus the shared lifecycle vocabulary.

/**
 * The single event-lifecycle state machine (007 requirements EARS-7, design §2).
 * One closed enum replacing the legacy boolean scatter — the source of truth
 * every 004/005/006 surface reads. The forward transition set is the SSOT
 * {@link LIFECYCLE_TRANSITIONS}; EARS-1 authors only the `draft` entry state,
 * the transition commands + server-side guard are sibling handlers (EARS-4…7).
 */
export const EVENT_LIFECYCLE_STATES = [
  "draft",
  "published",
  "live",
  "ended",
  "archived",
] as const;
export const EventLifecycleStateSchema = z.enum(EVENT_LIFECYCLE_STATES);
export type EventLifecycleState = z.infer<typeof EventLifecycleStateSchema>;

/**
 * The closed forward transition set (design §2). The ONLY legal moves are the
 * four forward transitions; every other move is refused server-side (EARS-7).
 * Kept here as the shared SSOT so the admin UI derives its offered actions
 * (`EventAdminDetail.validTransitions`) and the EARS-7 guard enforces refusal
 * from the same map — there is no second source to drift.
 */
export const LIFECYCLE_TRANSITIONS: Record<
  EventLifecycleState,
  readonly EventLifecycleState[]
> = {
  draft: ["published"],
  published: ["live"],
  live: ["ended"],
  ended: ["archived"],
  archived: [],
};

/** The transitions valid from `state` (the admin surface offers only these). */
export function validTransitions(
  state: EventLifecycleState,
): EventLifecycleState[] {
  return [...LIFECYCLE_TRANSITIONS[state]];
}

/**
 * Canonical Moscow-time handling (EARS-1, EARS-10, design §3). The operator
 * enters a date + time understood as **МСК**; the system stores ONE canonical
 * UTC instant. Moscow is permanently UTC+3 (Russia abolished seasonal DST in
 * 2014), so the offset is a fixed constant — no tz database lookup is needed to
 * fold a МСК wall-clock into an instant.
 */
export const MSK_UTC_OFFSET = "+03:00";

/** A naive МСК wall-clock datetime — `YYYY-MM-DDTHH:mm`, no offset (the operator's local entry). */
export const MSK_LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Fold a naive МСК wall-clock string into the canonical UTC instant. Pure + the
 * single SSOT for the МСК→instant conversion, so the API write path and any
 * consumer agree byte-for-byte. Throws on a malformed input (callers validate
 * with {@link MSK_LOCAL_DATETIME} first).
 */
export function mskLocalToInstant(local: string): Date {
  if (!MSK_LOCAL_DATETIME.test(local)) {
    throw new RangeError(`not a МСК wall-clock datetime: ${local}`);
  }
  const instant = new Date(`${local}:00${MSK_UTC_OFFSET}`);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`invalid МСК datetime: ${local}`);
  }
  return instant;
}

/**
 * A speaker entry — an ordered free-text `{ name, regalia }` pair (LD-1). Wave 1
 * validates text only; real-record references are wave 2 (bundled with the
 * speaker directory). The array order IS the presentation order (position).
 */
export const SpeakerEntrySchema = z.object({
  name: z.string().trim().min(1).max(200),
  regalia: z.string().trim().max(500).default(""),
});
export type SpeakerEntry = z.infer<typeof SpeakerEntrySchema>;

/**
 * `CreateEvent` request (EARS-1). The program PDF binary is NOT in this JSON —
 * it rides the same multipart request as the `programPdf` file part and is
 * uploaded to object storage; the stored reference lands on the aggregate. A
 * new event is always created in `draft` (the state is server-assigned, never
 * client-supplied).
 */
export const CreateEventRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  /** School / series kicker. */
  school: z.string().trim().min(1).max(200),
  /** Date + time entered as МСК wall-clock (`YYYY-MM-DDTHH:mm`); stored as one canonical instant. */
  startsAtMsk: z.string().regex(MSK_LOCAL_DATETIME, {
    message: "expected a МСК wall-clock datetime (YYYY-MM-DDTHH:mm)",
  }),
  durationMin: z.coerce.number().int().positive().max(24 * 60),
  description: z.string().trim().max(20_000).default(""),
  /** Ordered free-text speakers (LD-1). */
  speakers: z.array(SpeakerEntrySchema).max(50).default([]),
  /** Target specialty codes. */
  specialties: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  /** Sponsor / partner reference (free text in wave 1). */
  partnerRef: z.string().trim().max(300).nullish(),
});
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;

/**
 * The full editable aggregate for one event (`EventAdminDetail` read model,
 * design §Read models). `platform_admin`-authenticated; never public. Datetimes
 * are ISO-8601 UTC strings (the canonical instant); the admin surface renders
 * them back in МСК (EARS-10). `programPdfUrl` is a resolvable object-storage URL
 * for the current file; `null` when no PDF is attached.
 */
export const EventAdminDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int(),
  description: z.string(),
  speakers: z.array(SpeakerEntrySchema),
  specialties: z.array(z.string()),
  partnerRef: z.string().nullable(),
  programPdfRef: z.string().nullable(),
  programPdfUrl: z.string().nullable(),
  state: EventLifecycleStateSchema,
  validTransitions: z.array(EventLifecycleStateSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type EventAdminDetail = z.infer<typeof EventAdminDetailSchema>;

/** One row of the operator's `EventAdminList` (all states). `platform_admin`-only. */
export const EventAdminListItemSchema = EventAdminDetailSchema.pick({
  id: true,
  slug: true,
  title: true,
  school: true,
  startsAt: true,
  durationMin: true,
  state: true,
  validTransitions: true,
});
export type EventAdminListItem = z.infer<typeof EventAdminListItemSchema>;

export const EventAdminListSchema = z.object({
  data: z.array(EventAdminListItemSchema),
  total: z.number().int().nonnegative(),
});
export type EventAdminList = z.infer<typeof EventAdminListSchema>;
