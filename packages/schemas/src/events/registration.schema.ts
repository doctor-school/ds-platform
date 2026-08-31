import { z } from "zod";
import { RecordingProjectionSchema } from "../recordings/recordings.schema.js";
import { EventLifecycleStateSchema } from "./events.schema.js";

// 005 — Event-registration contracts (API SSOT, ADR-0002 §3, ADR-0006 §6.2).
// Framework-agnostic; `apps/api` wraps these at the I/O boundary and the portal
// consumes the same types via the generated SDK. This file covers the EARS-1
// write + immediate-read surface: the `RegisterForEvent` command response and
// the per-user `EventRegistrationState` read (both `doctor_guest`-authenticated,
// EARS-10). The `MyEvents` read + the `registered` card projections are sibling
// handlers (EARS-6).

/**
 * The lifecycle states in which registration is **offered** (design §5). An
 * authenticated doctor may register while the event is `published` (upcoming) or
 * `live` — register-during-live is a normal path leading straight toward the
 * room. Registration is withheld for `ended`/`archived` and impossible for
 * `draft` (not publicly reachable). Kept here as the SSOT the gate reads so the
 * offered-affordance set can never silently widen. The exhaustive gating
 * semantics (the ended/archived refusal + affordance-absent verification) are
 * the sibling EARS-9 handler; EARS-1 accepts exactly this set.
 */
export const REGISTRABLE_EVENT_STATES = ["published", "live"] as const;
export const RegistrableEventStateSchema = z.enum(REGISTRABLE_EVENT_STATES);
export type RegistrableEventState = z.infer<typeof RegistrableEventStateSchema>;

/** `true` iff an event in `state` may be registered for (published/live only). */
export function isRegistrable(
  state: z.infer<typeof EventLifecycleStateSchema>,
): boolean {
  return (REGISTRABLE_EVENT_STATES as readonly string[]).includes(state);
}

/**
 * `EventRegistrationState` — the per-authenticated-caller, per-event read model
 * (design §4, §5). Returned by both `GET /v1/events/:idOrSlug/registration`
 * (the state read) and `POST /v1/events/:idOrSlug/registration` (the command's
 * response), so the event page can render the registered state from either. It
 * carries only the caller's own `{ registered, registeredAt? }` fact — never
 * another doctor's state and never any roster/PII (EARS-10). `registeredAt` is
 * the canonical UTC instant (ISO-8601), OMITTED when `registered` is false.
 */
export const EventRegistrationStateSchema = z.object({
  registered: z.boolean(),
  registeredAt: z.iso.datetime({ offset: true }).optional(),
});
export type EventRegistrationState = z.infer<
  typeof EventRegistrationStateSchema
>;

/**
 * The two tabs of «Мои события» (014 EARS-9, 014-design §8.3) — and the only two.
 * `upcoming` is the doctor's still-to-come registrations; `recordings` is their
 * finished ones, the «Записи» side. The owner's canvas decision of 2026-08-17 is
 * exactly this pair with `upcoming` selected by default: the canvas's third
 * «Сертификаты» tab is a review miss and is neither built nor stubbed, so it has
 * no member here — the closed set IS the contract, and a third tab cannot appear
 * on the surface without first appearing in this union.
 */
export const MY_EVENTS_TABS = ["upcoming", "recordings"] as const;
export const MyEventsTabSchema = z.enum(MY_EVENTS_TABS);
export type MyEventsTab = z.infer<typeof MyEventsTabSchema>;

/**
 * The `?tab=` query of `GET /v1/me/events` (014 EARS-9). Absent means
 * `upcoming` — the default tab is a server-side fact, so a bare `/v1/me/events`
 * (the shape 005 shipped, and the one `fetchRegisteredSlugs` still issues) keeps
 * returning the Предстоящие side rather than 400ing on a missing param.
 */
export const MyEventsQuerySchema = z.object({
  tab: MyEventsTabSchema.default("upcoming"),
});
export type MyEventsQuery = z.infer<typeof MyEventsQuerySchema>;

/**
 * The lifecycle states a «Мои события» row can carry (014 EARS-9). The union of
 * the two tabs' membership rules: `published`/`live` on the Предстоящие side and
 * `ended` on the Записи side. `archived` is deliberately ABSENT — feature 004's
 * visibility policy hides an archived event from every listing surface, so it
 * belongs to NEITHER tab, and leaving it out of the field type means the SQL
 * filter and the contract cannot drift apart. `draft` is unreachable: it is never
 * publicly registrable in the first place.
 */
export const MY_EVENT_STATES = ["published", "live", "ended"] as const;
export const MyEventStateSchema = z.enum(MY_EVENT_STATES);
export type MyEventState = z.infer<typeof MyEventStateSchema>;

/**
 * `MyEventItem` — one row of the authenticated doctor's «Мои события» list
 * (005 design §4/§5 EARS-6; 014 EARS-9, 014-design §8.3). The thin per-event
 * projection the `MyEvents` read model returns for each of the caller's
 * registrations: `{ eventId, slug, title, school, startsAt, state, recording }` —
 * exactly the choose-set the shared `EventList` row needs to render a grouped card
 * that links back to `/webinars/:slug`, and NOTHING more (no roster, no registrant
 * PII, no other doctor's data — EARS-10). It is a THINNER allow-list than the 004
 * `UpcomingBroadcastCard`: no specialties/speakers, because the surface renders
 * from the registration list, not the public listing projection.
 *
 * `startsAt` is the canonical UTC instant (ISO-8601); the «Мои события» surface
 * renders it in `Europe/Moscow` labeled МСК (EARS-11), never the viewer's local
 * timezone.
 *
 * `recording` is the SAME source-free {@link RecordingProjectionSchema} the public
 * archive page and the `/webinars` past tab consume (014 EARS-3, #1340) — one
 * canonical resolver, so the badge a doctor sees on their own row can never
 * disagree with the badge on the public card. It is `null` on an `upcoming` row
 * (a not-yet-finished event has no recording state to speak of) and always PRESENT
 * on a `recordings` row: an `ended` event with nothing published resolves to
 * `preparing`, which is why every finished registration appears on the Записи tab
 * whether or not a recording exists (EARS-9).
 */
export const MyEventItemSchema = z.object({
  eventId: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  state: MyEventStateSchema,
  recording: RecordingProjectionSchema.nullable(),
});
export type MyEventItem = z.infer<typeof MyEventItemSchema>;

/** Row counts for BOTH tabs, so the tab bar labels its own inactive side. */
export const MyEventsCountsSchema = z.object({
  upcoming: z.number().int().nonnegative(),
  recordings: z.number().int().nonnegative(),
});
export type MyEventsCounts = z.infer<typeof MyEventsCountsSchema>;

/**
 * `MyEvents` — one tab of the authenticated doctor's «Мои события», returned by
 * `GET /v1/me/events?tab=upcoming|recordings` (005 design §5 EARS-6; 014 EARS-9,
 * 014-design §8.3). It carries only the caller's own registrations — never another
 * doctor's (EARS-10).
 *
 * `data` is the tab's FULL registration history — no window, no cap: «Записи» must
 * show an event the doctor attended two years ago, and truncating it would quietly
 * lose the doctor's own history. Order is most-relevant-first on each side, which
 * is `starts_at ASC` (nearest first) for `upcoming` — the imminent эфир is what the
 * doctor came for, the shipped EARS-6 behaviour — and `starts_at DESC` (newest
 * first) for `recordings`.
 *
 * `counts` covers BOTH tabs regardless of which one `data` holds, because the tab
 * bar renders «Предстоящие · N | Записи · N» in one paint; an empty `data` is a
 * valid result and renders the canvas empty-state (EARS-6/EARS-12).
 */
export const MyEventsSchema = z.object({
  tab: MyEventsTabSchema,
  data: z.array(MyEventItemSchema),
  counts: MyEventsCountsSchema,
});
export type MyEvents = z.infer<typeof MyEventsSchema>;

/**
 * `EventRosterEntry` — one row of the {@link EventRosterSchema}: a single current
 * registration for an event, carrying **no more than the `(doctor, event,
 * registeredAt)` fact** (design §2, EARS-8). `doctor` is the domain `user_id`
 * (the 003 UserMirror key), `event` the `event_id`, `registeredAt` the canonical
 * UTC instant (ISO-8601). It is deliberately the THINNEST possible shape — no
 * email, name, or any denormalized registrant PII. The sponsor roster and room
 * admission (006) join to the `users` mirror (003) at read time for whatever
 * identity they need; 005 never copies PII onto this record and never exposes it
 * on a public 004 surface (EARS-8, EARS-10; recon §6).
 */
export const EventRosterEntrySchema = z.object({
  userId: z.uuid(),
  eventId: z.uuid(),
  registeredAt: z.iso.datetime({ offset: true }),
});
export type EventRosterEntry = z.infer<typeof EventRosterEntrySchema>;

/**
 * `EventRoster` — the set of **current** registrations for one event (design §2,
 * §4; EARS-8). Owned by 005; it is the durable basis **consumed** by feature 006
 * (room admission) and the wave-2 sponsor report — the roster admits/attributes
 * exactly the recorded registrations. Because wave 1 has **no** cancelled state
 * and no soft-delete (owner decision), the roster is simply "every registration
 * row for the event" — no filter, and every entry is current (Invariants). It is
 * an **internal** read model with **no public endpoint**: it is never exposed on
 * a 004 public surface and never leaks a registrant (design §4; EARS-8, EARS-10).
 * Ordered nearest-registered first (`registered_at ASC`); an event with no
 * registrations is a valid empty `[]`.
 */
export const EventRosterSchema = z.array(EventRosterEntrySchema);
export type EventRoster = z.infer<typeof EventRosterSchema>;
