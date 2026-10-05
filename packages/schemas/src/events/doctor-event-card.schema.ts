import { z } from "zod";

import { EventKindRefSchema } from "./events.schema.js";
import { EventParticipationFormatSchema } from "./participation.schema.js";

/**
 * 019 EARS-2 — the shared event-card read model and its format vocabulary.
 *
 * The card's `format` is the closed delivery-mode axis `online | offline |
 * hybrid` and its `kind` is the event's one entry of 012's open event-kind
 * dictionary (019 «Amendment — 2026-10-01», #2509): the five-value catalogue
 * format retired, and a congress is a KIND (Конгресс), not a format.
 *
 * It is DELIBERATELY not the 012 `PublicEventSummarySchema` of
 * `taxonomy.schema.ts`: that one is the `.strict()` item DTO of
 * `GET /v1/public/projects/:key/events` and its strictness is a disclosure
 * boundary. Widening it would push 019's city/seats fields into an unrelated
 * taxonomy traversal, so 019's card payload is its own named model.
 *
 * Disclosure invariant (EARS-2, Invariants): NO field states who finances an
 * event and NO field carries a rouble price — the schema is `.strict()`, so a
 * sponsor/financier/price field added upstream is REJECTED here rather than
 * silently forwarded to the card.
 */
export const DoctorEventFormatSchema = EventParticipationFormatSchema;
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
 * offline-carrying event (`offline` or `hybrid`).
 */
export const DoctorEventCardSchema = z
  .object({
    id: z.string(),
    /**
     * The event's public slug — the SAME identifier `href` is minted from, but
     * carried as its own field so a host never has to parse an identifier back
     * out of a URL. 019 EARS-12 needs it: the guest CTA mints a
     * `?resume=<slug>` return target, and a slug re-derived by string-slicing
     * `href` would be a second, unvalidated identifier path.
     */
    slug: z.string(),
    href: z.string(),
    startsAt: z.string(),
    endsAt: z.string().nullable(),
    format: DoctorEventFormatSchema,
    /** The event's kind from the 012 dictionary; its `slug` is the `?kind=` facet value. */
    kind: EventKindRefSchema,
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
