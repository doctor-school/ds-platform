import { z } from "zod";

/**
 * 019 EARS-2 — the shared event-card read model and its format vocabulary.
 *
 * This module is the SoT of the five-format vocabulary the doctor feed, the
 * facet panel (#1522) and the URL/query codec (#1523) all read. The vocabulary
 * lives HERE and only here: per the approved canvas the shared `WebinarCard` in
 * `@ds/design-system` renders the format as pure catalog copy (the time-plate
 * kicker) and holds no format union of its own, so the presentation primitive
 * stays free of any dependency on this read contract while the contract stays
 * the single source of the vocabulary (AGENTS.md §6).
 *
 * It is DELIBERATELY not the 012 `PublicEventSummarySchema` of
 * `taxonomy.schema.ts`: that one is the `.strict()` item DTO of
 * `GET /v1/public/projects/:key/events` and its strictness is a disclosure
 * boundary. Widening it would push 019's format/city/seats fields into an
 * unrelated taxonomy traversal, so 019's card payload is its own named model.
 *
 * Disclosure invariant (EARS-2, Invariants): NO field states who finances an
 * event and NO field carries a rouble price — the schema is `.strict()`, so a
 * sponsor/financier/price field added upstream is REJECTED here rather than
 * silently forwarded to the card.
 */
export const DoctorEventFormatSchema = z.enum([
  "webinar",
  "online-meeting",
  "offline-meetup",
  "congress",
  "podcast",
]);
export type DoctorEventFormat = z.infer<typeof DoctorEventFormatSchema>;

/** The seven canvas card states collapse onto the five payload states (019 §5). */
export const DoctorEventCardStateSchema = z.enum([
  "normal",
  "registered",
  "soldOut",
  "live",
  "recorded",
]);
export type DoctorEventCardState = z.infer<typeof DoctorEventCardStateSchema>;

/**
 * The exact `PublicEventSummary` read model of 019's Event Model section — the
 * card payload. `pulCost` is attention points, never roubles, and `pulCost === 0`
 * renders «бесплатно для врача». `city`/`seatsLeft` are present exactly for an
 * offline-carrying event (`offline-meetup`, or a hybrid `congress`).
 */
export const DoctorEventCardSchema = z
  .object({
    id: z.string(),
    href: z.string(),
    startsAt: z.string(),
    endsAt: z.string().nullable(),
    format: DoctorEventFormatSchema,
    /**
     * The managed direction the event is filed under, as its ID — the SAME
     * vocabulary the `kind` FACET takes, so a card value round-trips into
     * `?kind=` instead of crashing the read (019-design section 7). Empty
     * string exactly when no published direction is filed.
     */
    kind: z.string(),
    /** The direction's authored title — the display projection of `kind`. */
    kindTitle: z.string(),
    title: z.string(),
    speaker: z.string(),
    source: z.string(),
    /** НМО is a chip and a facet only — never a heading or the primary filter. */
    nmo: z.boolean(),
    /** Cost in Pul attention points; `0` is the free-for-the-doctor reading. */
    pulCost: z.number().int().nonnegative(),
    /** Colleagues signed up — rendered in EVERY card state. */
    signUpCount: z.number().int().nonnegative(),
    city: z.string().optional(),
    seatsLeft: z.number().int().nonnegative().optional(),
    state: DoctorEventCardStateSchema,
  })
  .strict();
export type DoctorEventCard = z.infer<typeof DoctorEventCardSchema>;
