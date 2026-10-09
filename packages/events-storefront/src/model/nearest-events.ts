import type { BlockRead, EventsFeedCard, EventsFeedPage } from "./feed";

/** How many nearest events the home block shows (the canvas draws three). */
export const NEAREST_EVENTS_CAP = 3;

/**
 * The home nearest-events block's render (017 EARS-9, design §6 «Nearest
 * events» row) — exactly one per read:
 *
 * - `error` — the read failed: the cause in Russian and «Обновить».
 * - `empty` — nothing upcoming matches. A targeted read states it «по вашей
 *   специальности»; the adjacent-areas link renders only when the targeting
 *   reaches adjacent directions (design §5: chosen on `adjacentDirections`,
 *   never on `directions` — a link to an empty adjacent set is a dead control).
 * - `cards` — the nearest events, nearest first, capped.
 *
 * `targeted` and `generalFallback` follow the read's `mode`, never the size of
 * a set: `general` is the «Другое» fallback and carries its LD-5 statement;
 * `all` (no specialty chosen) is the plain general selection.
 */
export type NearestEventsState =
  | { readonly kind: "error" }
  | {
      readonly kind: "empty";
      readonly targeted: boolean;
      readonly adjacentLink: boolean;
      readonly generalFallback: boolean;
    }
  | {
      readonly kind: "cards";
      readonly cards: readonly EventsFeedCard[];
      readonly targeted: boolean;
      readonly generalFallback: boolean;
    };

export function nearestEventsState(
  read: BlockRead<EventsFeedPage>,
): NearestEventsState {
  if (!read.ok) return { kind: "error" };
  const { cards, targeting } = read.value;
  const targeted = targeting?.mode === "targeted";
  const generalFallback = targeting?.mode === "general";
  if (cards.length === 0) {
    return {
      kind: "empty",
      targeted,
      adjacentLink: targeted && targeting.adjacentDirectionIds.length > 0,
      generalFallback,
    };
  }
  return {
    kind: "cards",
    cards: cards.slice(0, NEAREST_EVENTS_CAP),
    targeted,
    generalFallback,
  };
}
