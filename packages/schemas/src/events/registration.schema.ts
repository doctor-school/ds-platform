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
