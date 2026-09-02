import { z } from "zod";

// 020 EARS-1 / LD-2 / LD-5 — the participation vocabulary of the ONE shared
// event-page core. Framework-agnostic contracts (ADR-0002 §3, ADR-0006 §6.2):
// `apps/api` resolves them, both storefront hosts render them, and neither host
// computes eligibility of its own.

/**
 * The event's **participation format** (020-design §4) — the axis that decides
 * whether a doctor attends over the wire, in a room with chairs, or either.
 *
 * This is deliberately NOT 019's {@link DoctorEventFormat} catalogue vocabulary
 * (`webinar` · `online-meeting` · `offline-meetup` · `congress` · `podcast`),
 * which answers «what KIND of event is this» for the feed's facets. The two are
 * orthogonal: a `congress` may be hybrid and an `online-meeting` is always
 * online. Collapsing them would make «are there seats to run out of» a property
 * of an editorial label, which is exactly how a hybrid congress ends up
 * unable to express that its offline half is full (LD-5).
 */
export const EVENT_PARTICIPATION_FORMATS = [
  "online",
  "offline",
  "hybrid",
] as const;
export const EventParticipationFormatSchema = z.enum(
  EVENT_PARTICIPATION_FORMATS,
);
export type EventParticipationFormat = z.infer<
  typeof EventParticipationFormatSchema
>;

/**
 * The closed set of participation actions (LD-2). Exactly one of these is
 * resolved for one viewer on one event at one moment — «exactly one CTA» is
 * checkable precisely because the union is closed and server-resolved:
 *
 * - `register` — upcoming, seats available (or none to run out of), and the
 *   viewer is a guest or a signed-in doctor without a registration;
 * - `registered` — upcoming and the viewer already holds a registration;
 * - `enter-room` — the event is live and the viewer holds a registration;
 * - `switch-to-online` — a HYBRID event whose offline seats are exhausted; the
 *   doctor is offered the online half in plain words (F-020-3 Б, LD-5);
 * - `sold-out` — a pure OFFLINE event whose seats are exhausted; stated
 *   honestly with no participation target at all (EARS-9). No waiting list
 *   exists in the model, so none can be half-built in the UI;
 * - `unavailable` — participation is not offered in this lifecycle state
 *   (`ended` / `hidden`), or the live room is not reachable for this viewer.
 */
export const PARTICIPATION_CTA_ACTIONS = [
  "register",
  "registered",
  "enter-room",
  "switch-to-online",
  "sold-out",
  "unavailable",
] as const;
export const ParticipationCtaActionSchema = z.enum(PARTICIPATION_CTA_ACTIONS);
export type ParticipationCtaAction = z.infer<
  typeof ParticipationCtaActionSchema
>;

/**
 * `ParticipationCta` — the ONE server-resolved policy object the event page
 * renders (LD-2). The client renders what it is given and branches on nothing:
 * any host-side branch on lifecycle, registration, format or seats is the defect
 * this contract exists to make impossible.
 *
 * - `label` is the RU copy DEFAULT carried by the server, so both storefronts
 *   say the same thing about the same event without agreeing out of band. A
 *   host may later override the label through its own envelope; it may never
 *   override the `action`.
 * - `href` is the target the action leads to, or `null` when the action has no
 *   target by design (`registered` renders the state, `sold-out` and
 *   `unavailable` deliberately dead-end in words rather than in a disabled
 *   control — EARS-4: where participation is impossible the CTA is ABSENT, not
 *   disabled). It is resolved relative to the host that asked, which is why the
 *   route is per-host even though the policy is one.
 * - `reason` states WHY in plain words when the action is not the plain
 *   `register` (the switch, the sold-out, the unavailable) and is `null` when
 *   the action speaks for itself. It is never an error code and never a
 *   template the client has to complete.
 */
export const ParticipationCtaSchema = z
  .object({
    action: ParticipationCtaActionSchema,
    label: z.string(),
    href: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .strict();
export type ParticipationCta = z.infer<typeof ParticipationCtaSchema>;
