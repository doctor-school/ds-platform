import type { PointsRecordFact } from "@ds/schemas";

/**
 * The fact event id of a sign-up (025 EARS-14): one per registration, so a
 * replayed sign-up answers `duplicate`.
 */
export function registrationCreatedFactEventId(registrationId: string): string {
  return `registration.created:${registrationId}`;
}

/**
 * 025 EARS-14…17, 21 — the `registration.created` fact a sign-up reports
 * inside the transaction that inserts the registration row (EARS-33: a
 * producer reports facts only; the seeded `spend.reserve` holds the item's
 * price when the price list prices it). One builder for every authenticated
 * sign-up door (today the 005 one-tap registration) and the e2e harness, so
 * the event id and the attributes cannot drift between them. The public 044
 * congress intake is out of the spend path and never reports it (044 EARS-41).
 */
export function registrationCreatedFact(input: {
  registrationId: string;
  personId: string;
  itemRef: string;
  occurredAt: Date;
}): PointsRecordFact {
  return {
    type: "registration.created",
    eventId: registrationCreatedFactEventId(input.registrationId),
    personId: input.personId,
    ref: input.itemRef,
    occurredAt: input.occurredAt,
    attributes: { registrationId: input.registrationId },
  };
}
