import { z } from "zod";
import { RecordingProjectionSchema } from "../recordings/recordings.schema.js";
import {
  PublicEventPageSpeakerSchema,
  PublicEventStateSchema,
  PublicPartnerSchema,
} from "./events.schema.js";

/**
 * The public event-page projection lives in its own module for the same reason
 * `public-listing.schema.ts` does: it composes an EVENT contract with the
 * RECORDINGS contract, and `recordings.schema.ts` already imports the event
 * primitives (`StreamProviderSchema`, `EmbedRefSchema`,
 * `RecordingExpectedBySchema`). Declaring the composition inside
 * `events.schema.ts` would close that import into a cycle whose module-eval
 * order leaves a zod schema undefined at definition time — a runtime failure,
 * not a lint finding. Downstream composition modules are this package's
 * standing answer to that, so the projection sits one level below both halves.
 */

/**
 * `PublicEventPage` — the publish-safe projection returned by
 * `GET /v1/public/events/:idOrSlug` (004 design §3, EARS-1). It is an
 * ALLOW-LIST, not a redactor: only the fields named here are ever exposed, so a
 * new internal column stays invisible to the public API until it is explicitly
 * added to this projection (the structural guard behind EARS-10 — the recon §6
 * `getEmailsForOrder` roster can never touch a public surface). It carries NO
 * operator/commercial field (the raw partner ref, the program storage key, the
 * row timestamps, the admin `validTransitions`) and NO registrant PII.
 *
 * `startsAt` is the canonical UTC instant (ISO-8601); every surface renders it
 * in `Europe/Moscow` labeled МСК (EARS-12). `programPdfUrl` is OMITTED (not
 * null) when the event has no program PDF — the page renders the program section
 * without a download affordance rather than a broken link (EARS-2).
 */
export const PublicEventPageSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int(),
  description: z.string(),
  // 012 EARS-8: the merged legacy+expert union, produced by the ONE canonical
  // resolver that also feeds `/events/:key/speakers` and the upcoming card.
  speakers: z.array(PublicEventPageSpeakerSchema),
  specialties: z.array(z.string()),
  partners: z.array(PublicPartnerSchema),
  programPdfUrl: z.string().optional(),
  state: PublicEventStateSchema,
  /**
   * 014 EARS-4 (#1341) — the SOURCE-FREE recording projection of 014-design §4,
   * carried by this one public read for every publicly reachable state. It is
   * deliberately the shared `RecordingProjection` rather than a page-local
   * shape: the archive listing badge, «Мои события» and this page all read the
   * one resolver, so «what does this event offer» has exactly one answer.
   *
   * It carries NO `provider` and NO `embedRef`. The playable source lives behind
   * the authenticated playback contract (014-design §5, #1343), which is what
   * makes the login gate a response-body fact rather than a rendering rule —
   * adding a source field here would put a playable reference into a guest's
   * HTML payload, the exact defect EARS-5 names.
   *
   * Never nullable and never omitted: `preparing` is the honest answer for an
   * event with no published non-retired row (an upcoming event included), and a
   * missing field would leave every consumer unable to tell «no recording» from
   * «this read does not know».
   */
  recording: RecordingProjectionSchema,
});
export type PublicEventPage = z.infer<typeof PublicEventPageSchema>;
