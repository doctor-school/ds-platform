import { z } from "zod";
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
 * `MyEventItem` — one row of the authenticated doctor's «мои события»
 * **Предстоящие** list (design §4/§5, EARS-6). The thin per-event projection the
 * `MyEvents` read model returns for each of the caller's registered **upcoming**
 * events: `{ eventId, slug, title, school, startsAt, state }` — exactly the
 * choose-set the «мои события» card needs to render a day-grouped row that links
 * back to `/webinars/:slug`, and NOTHING more (no roster, no registrant PII, no
 * other doctor's data — EARS-10). It is a THINNER allow-list than the 004
 * `UpcomingBroadcastCard`: no specialties/speakers, because the surface renders
 * from the registration list, not the public listing projection.
 *
 * `startsAt` is the canonical UTC instant (ISO-8601); the «мои события» surface
 * renders it in `Europe/Moscow` labeled МСК (EARS-11), never the viewer's local
 * timezone. `state` is constrained to {@link RegistrableEventStateSchema}
 * (`published`/`live`) — an `ended`/`archived` registration never appears on this
 * list (EARS-6), so the closed two-value set the query filters on IS the field
 * type, and the two can never drift.
 */
export const MyEventItemSchema = z.object({
  eventId: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  state: RegistrableEventStateSchema,
});
export type MyEventItem = z.infer<typeof MyEventItemSchema>;

/**
 * `MyEvents` — the authenticated doctor's registered **upcoming** events
 * (`published`/`live`, future or currently airing), ordered **nearest `startsAt`
 * first** (`starts_at ASC`), returned by `GET /v1/me/events` (design §5, EARS-6).
 * A bare array; an empty result is a valid `[]` (the «мои события» surface renders
 * the canvas empty-state, EARS-6/EARS-12). It carries only the caller's own
 * registrations — never another doctor's (EARS-10).
 */
export const MyEventsSchema = z.array(MyEventItemSchema);
export type MyEvents = z.infer<typeof MyEventsSchema>;
