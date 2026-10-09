import { describe, expect, it } from "vitest";

import type { BlockRead, EventsFeedCard, EventsFeedPage } from "./feed";
import { NEAREST_EVENTS_CAP, nearestEventsState } from "./nearest-events";

const card = (id: string): EventsFeedCard => ({
  id,
  slug: id,
  startsAt: "2026-09-02T09:00:00.000Z",
  format: "online",
  kindTitle: "Вебинар",
  title: `Событие ${id}`,
  school: "Doctor.School",
  speakers: [],
  state: "upcoming",
  signUpCount: 0,
  recording: null,
});

function read(
  cards: EventsFeedCard[],
  targeting?: EventsFeedPage["targeting"],
): BlockRead<EventsFeedPage> {
  return {
    ok: true,
    value: {
      today: "2026-09-01",
      cards,
      horizon: { from: "2026-09-01", to: "2026-09-15", nextTo: null, nextFrom: null },
      remaining: 0,
      nextBatch: 0,
      facetOptions: {},
      matching: cards.length,
      ...(targeting ? { targeting } : {}),
    },
  };
}

describe("nearestEventsState", () => {
  it("017 EARS-9: a failed read resolves to the error render, never an empty one", () => {
    expect(nearestEventsState({ ok: false })).toEqual({ kind: "error" });
  });

  it("017 EARS-9: before a specialty is chosen the nearest events render general, capped, nearest first", () => {
    const cards = ["a", "b", "c", "d"].map(card);
    const state = nearestEventsState(
      read(cards, { mode: "all", adjacentDirectionIds: [] }),
    );
    expect(state).toEqual({
      kind: "cards",
      cards: cards.slice(0, NEAREST_EVENTS_CAP),
      targeted: false,
      generalFallback: false,
    });
    expect(NEAREST_EVENTS_CAP).toBe(3);
  });

  it("017 EARS-9: after a specialty is chosen the block renders targeted", () => {
    const state = nearestEventsState(
      read([card("a")], { mode: "targeted", adjacentDirectionIds: ["adj"] }),
    );
    expect(state).toMatchObject({ kind: "cards", targeted: true, generalFallback: false });
  });

  it("017 EARS-9: a «Другое» choice renders the general selection and says so (LD-5)", () => {
    const state = nearestEventsState(
      read([card("a")], { mode: "general", adjacentDirectionIds: [] }),
    );
    expect(state).toMatchObject({ kind: "cards", targeted: false, generalFallback: true });
  });

  it("017 EARS-9: a targeted empty read points at adjacent areas only when adjacentDirections is non-empty", () => {
    expect(
      nearestEventsState(read([], { mode: "targeted", adjacentDirectionIds: ["adj"] })),
    ).toEqual({ kind: "empty", targeted: true, adjacentLink: true, generalFallback: false });
    expect(
      nearestEventsState(read([], { mode: "targeted", adjacentDirectionIds: [] })),
    ).toEqual({ kind: "empty", targeted: true, adjacentLink: false, generalFallback: false });
  });

  it("017 EARS-9: an untargeted empty read states the emptiness with no adjacent link", () => {
    expect(nearestEventsState(read([]))).toEqual({
      kind: "empty",
      targeted: false,
      adjacentLink: false,
      generalFallback: false,
    });
  });
});
