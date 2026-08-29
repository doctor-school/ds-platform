import { describe, expect, it } from "vitest";
import { buildWebinarsHref } from "./webinars-url";

describe("buildWebinarsHref", () => {
  it("EARS-11: week/month navigation preserves tab, facets and feed page state loss-free", () => {
    const state = {
      tab: "past",
      specialty: "cardiology",
      cursor: "opaque-cursor",
      cursorTrail: "older-cursor",
      page: "3",
    };
    const month = buildWebinarsHref(state, {
      view: "month",
      month: "2026-09",
    });
    expect(month).toContain("tab=past");
    expect(month).toContain("specialty=cardiology");
    expect(month).toContain("cursor=opaque-cursor");
    expect(month).toContain("page=3");

    const roundTrip = buildWebinarsHref(
      Object.fromEntries(new URL(month, "https://academy.test").searchParams),
      { view: "week", month: "2026-10" },
    );
    expect(roundTrip).toContain("tab=past");
    expect(roundTrip).toContain("specialty=cardiology");
    expect(roundTrip).toContain("cursor=opaque-cursor");
    expect(roundTrip).toContain("page=3");
    expect(roundTrip).toContain("month=2026-10");
  });

  it("EARS-11: only a feed-membership change explicitly resets cursor and page", () => {
    const href = buildWebinarsHref(
      { tab: "past", cursor: "opaque", cursorTrail: "older", page: "4" },
      { view: "week", resetFeedPage: true },
    );
    expect(href).toBe("/webinars?tab=past");
  });
});
