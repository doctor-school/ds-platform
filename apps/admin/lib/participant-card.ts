import {
  CONGRESS_PERSONAL_DATA_PURPOSE,
  type CongressParticipantCard,
} from "@ds/schemas";
import { formatMskDateTime } from "./msk";

/**
 * 044 EARS-36 — the pure half of the participant card panel
 * (`components/participant-card-panel.tsx`), opened from a roster row. The
 * panel is a read card: what it shows, which record ↑/↓ lands on, the link the
 * address carries and how a refused read is told apart are decided here, so the
 * Node-only unit tier can pin them.
 */

/** The text facts of the card, in the order the panel lists them. */
export const PARTICIPANT_CARD_FIELDS = [
  "fullName",
  "specialtyName",
  "workplace",
  "city",
  "region",
  "phone",
  "email",
  "registeredAt",
] as const;
export type ParticipantCardField = (typeof PARTICIPANT_CARD_FIELDS)[number];

/**
 * The card's text facts as display strings. The phone is the one the
 * participant typed (EARS-29), never a normalised form; a field the
 * registration does not carry (EARS-16) renders EMPTY — never a placeholder the
 * registrar could mistake for data.
 */
export function participantCardFields(
  card: CongressParticipantCard,
): Record<ParticipantCardField, string> {
  return {
    fullName: card.fullName,
    specialtyName: card.specialtyName ?? "",
    workplace: card.workplace ?? "",
    city: card.city ?? "",
    region: card.region ?? "",
    phone: card.phone ?? "",
    email: card.email ?? "",
    registeredAt: formatMskDateTime(card.registeredAt),
  };
}

/** The message key naming a consent purpose; `null` for a purpose with no name. */
export function consentPurposeKey(
  purpose: string,
): "congressPersonalData" | null {
  return purpose === CONGRESS_PERSONAL_DATA_PURPOSE
    ? "congressPersonalData"
    : null;
}

/**
 * The record ↑ (`prev`) or ↓ (`next`) lands on among the rows of the current
 * roster page; `null` at either end, and for a card opened by link whose row
 * the page does not show.
 */
export function participantCardNeighbour(
  rowIds: readonly string[],
  current: string,
  direction: "prev" | "next",
): string | null {
  const index = rowIds.indexOf(current);
  if (index === -1) return null;
  return rowIds[direction === "prev" ? index - 1 : index + 1] ?? null;
}

/** The address search parameter carrying the open card. */
export const PARTICIPANT_CARD_PARAM = "registration";

/**
 * The roster address with the open card in `?registration=` (or without it,
 * for `null`), every other parameter — the desk's `q` — kept as it was.
 */
export function participantCardHref(
  pathname: string,
  search: string,
  registrationId: string | null,
): string {
  const params = new URLSearchParams(search);
  if (registrationId) params.set(PARTICIPANT_CARD_PARAM, registrationId);
  else params.delete(PARTICIPANT_CARD_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Why the card could not be read, from the GET's HTTP status (EARS-36/38):
 * `forbidden` — the grant or session is gone (401/403); the page re-reads its
 * list, whose own refusal then replaces the roster, exactly as a refused mark;
 * `notFound` — the id names no registration of THIS event (404: another
 * event's record reads nothing); `failed` — anything else.
 */
export type ParticipantCardFailure = "forbidden" | "notFound" | "failed";

export function participantCardFailure(
  status: number | undefined,
): ParticipantCardFailure {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "notFound";
  return "failed";
}

/**
 * `router.replace` answers asynchronously, so a held ↓ fires again before the
 * address shows the card the previous press asked for. The page keeps the
 * requests it has sent (`pending`, oldest first) and walks on from the NEWEST
 * one; with nothing pending, the address is the card (a direct link, the
 * desk's «Открыть запись»).
 */
export function pendingCardAnchor(
  pending: readonly (string | null)[],
  address: string | null,
): string | null {
  return pending.length > 0 ? pending[pending.length - 1]! : address;
}

/**
 * The address changed. When it answers one of the requests, that request and
 * every older one are settled (the newest occurrence — the router may commit
 * only the last of a burst); when it answers none of them, something else
 * navigated (a link) and the address wins: the queue is dropped.
 */
export function settlePendingCards(
  pending: readonly (string | null)[],
  address: string | null,
): (string | null)[] {
  const answered = pending.lastIndexOf(address);
  return answered === -1 ? [] : pending.slice(answered + 1);
}

/**
 * A card request joins the queue — unless it names the card already open: the
 * address will not change for it, so it would never be answered and would
 * outrank the next address. Asking for the open card again drops the queue.
 */
export function queueCardRequest(
  pending: readonly (string | null)[],
  open: string | null,
  requested: string | null,
): (string | null)[] {
  return requested === open ? [] : [...pending, requested];
}
