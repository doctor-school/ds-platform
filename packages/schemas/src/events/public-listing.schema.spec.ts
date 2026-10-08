import { describe, expect, it } from "vitest";
import { UpcomingBroadcastCardSchema } from "./events.schema.js";
import {
  PastBroadcastCardSchema,
  PublicEventListingPageSchema,
  PublicEventListingQuerySchema,
} from "./public-listing.schema.js";

/**
 * Wave-2 entry gate §4.2 (PR 2.4) — the Academy listing read contract: the
 * horizon of the one codec (D2), the card's kind + format (D3) and the
 * colleagues' sign-up count (A2), all additive.
 */
describe("public event listing contract (wave-2 gate §4.2)", () => {
  const card = (over: Record<string, unknown> = {}) => ({
    id: "11111111-1111-4111-8111-111111111111",
    slug: "ortho",
    title: "Ортобиология",
    school: "Школа ортобиологии",
    startsAt: "2026-10-10T12:00:00.000Z",
    specialties: [],
    speakers: [],
    state: "published",
    kind: { id: "k1", slug: "vebinar", title: "Вебинар" },
    format: "online",
    signUpCount: 3,
    ...over,
  });

  it("NEW: the card carries the event's kind and its format (D3)", () => {
    const parsed = UpcomingBroadcastCardSchema.safeParse(card());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.kind.slug).toBe("vebinar");
    expect(parsed.data.format).toBe("online");
    expect(
      UpcomingBroadcastCardSchema.safeParse(card({ kind: undefined })).success,
    ).toBe(false);
    expect(
      UpcomingBroadcastCardSchema.safeParse(card({ format: "radio" })).success,
    ).toBe(false);
  });

  it("NEW: the card carries the colleagues' sign-up count, a non-negative integer (A2)", () => {
    expect(UpcomingBroadcastCardSchema.safeParse(card()).success).toBe(true);
    expect(
      UpcomingBroadcastCardSchema.safeParse(card({ signUpCount: undefined }))
        .success,
    ).toBe(false);
    expect(
      UpcomingBroadcastCardSchema.safeParse(card({ signUpCount: -1 })).success,
    ).toBe(false);
  });

  it("NEW: a past card carries the same kind, format and count fields", () => {
    const parsed = PastBroadcastCardSchema.safeParse(
      card({
        state: "ended",
        recording: {
          state: "preparing",
          primaryKind: null,
          secondaryKind: null,
          posterUrl: null,
          expectedBy: null,
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("NEW: the listing query accepts the horizon (from, to) of the one codec (D2)", () => {
    const parsed = PublicEventListingQuerySchema.safeParse({
      timeframe: "upcoming",
      from: "2026-10-08",
      to: "2026-10-22",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.from).toBe("2026-10-08");
    expect(parsed.data.to).toBe("2026-10-22");
    expect(
      PublicEventListingQuerySchema.safeParse({
        timeframe: "upcoming",
        to: "22.10.2026",
      }).success,
    ).toBe(false);
  });

  it("NEW: the cursor stays accepted for other callers, but never beside a horizon", () => {
    expect(
      PublicEventListingQuerySchema.safeParse({
        timeframe: "upcoming",
        cursor: "abc",
      }).success,
    ).toBe(true);
    expect(
      PublicEventListingQuerySchema.safeParse({
        timeframe: "upcoming",
        cursor: "abc",
        to: "2026-10-22",
      }).success,
    ).toBe(false);
  });

  it("NEW: a horizon page echoes the applied horizon and the `to` «Показать ещё» writes", () => {
    const parsed = PublicEventListingPageSchema.safeParse({
      data: [card()],
      counts: { upcoming: 5, past: 0 },
      pagination: { nextCursor: null, hasMore: true },
      horizon: { from: "2026-10-08", to: "2026-10-22", nextTo: "2026-11-05" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.horizon?.nextTo).toBe("2026-11-05");
  });
});
