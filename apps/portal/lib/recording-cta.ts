import type { RecordingState } from "@ds/schemas";

/**
 * The single rule deciding whether a PAST event card may advertise «Смотреть
 * запись» (014 EARS-9).
 *
 * Both past feeds project the same card: the public listing
 * (`components/discovery-listing.tsx`) and the doctor's «Записи» tab
 * (`lib/my-events.ts`). The badge and the CTA are two halves of one statement,
 * so the rule that reconciles them lives here once — a copy in each feed is the
 * fork ADR-0013 A1 forbids, and it is exactly how a «ЗАПИСЬ ГОТОВИТСЯ» card
 * came to carry a «Смотреть запись» button under its own badge.
 *
 * `preparing` is the state that means *nothing is published yet* — the
 * projection sets `sourceRef: null` exactly then (014-design §4). An `ended`
 * event with no resolved recording at all is likewise not playable. Either way
 * the row is still LISTED and still badged; only the CTA is withheld, because
 * the destination has no cut to play. The card renders its CTA on
 * `ctaHref && ctaLabel`, so withholding the label is what removes the button —
 * the href stays and the card remains a link to its event page.
 */
export function isRecordingPlayable(
  recording: { readonly state: RecordingState } | null | undefined,
): boolean {
  return Boolean(recording && recording.state !== "preparing");
}
