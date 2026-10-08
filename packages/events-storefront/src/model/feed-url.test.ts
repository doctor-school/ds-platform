import { describe, expect, it } from "vitest";

import {
  canonicalFeedRedirect,
  feedReadQuery,
  feedTenseOf,
  showMoreHref,
  tenseHref,
} from "./feed-url";

describe("canonicalFeedRedirect — §4.3 D1, the legacy Academy URL", () => {
  it("NEW: each legacy Academy param redirects to its canonical form; a dropped cursor lands on the first batch", () => {
    expect(canonicalFeedRedirect("/webinars", { tab: "past" })).toBe(
      "/webinars?tense=past",
    );
    expect(
      canonicalFeedRedirect("/webinars", {
        tab: "past",
        cursor: "abc",
        cursorTrail: "x,y",
        page: "3",
      }),
    ).toBe("/webinars?tense=past");
    expect(
      canonicalFeedRedirect("/webinars", { cursor: "abc", page: "2" }),
    ).toBe("/webinars");
    expect(canonicalFeedRedirect("/webinars", { tab: "upcoming" })).toBe(
      "/webinars",
    );
  });

  it("between PR 2.4 and 2.5 the redirect passes view and month through unchanged", () => {
    expect(
      canonicalFeedRedirect("/webinars", {
        tab: "past",
        view: "month",
        month: "2026-09",
      }),
    ).toBe("/webinars?view=month&month=2026-09&tense=past");
  });

  it("a canonical URL needs no redirect", () => {
    expect(canonicalFeedRedirect("/webinars", {})).toBeNull();
    expect(
      canonicalFeedRedirect("/webinars", { tense: "past", view: "month" }),
    ).toBeNull();
  });
});

describe("the one feed codec (019 LD-1)", () => {
  it("NEW: tense tabs write tense=past to the URL; «Будущие» is the default and carries no param", () => {
    expect(tenseHref("/events", { from: "2026-10-01", to: "2026-11-01" }, "past")).toBe(
      "/events?tense=past",
    );
    expect(tenseHref("/events", { tense: "past", format: "online" }, "upcoming")).toBe(
      "/events?format=online",
    );
    expect(feedTenseOf({})).toBe("upcoming");
    expect(feedTenseOf({ tense: "past" })).toBe("past");
    expect(feedTenseOf({ tense: "nonsense" })).toBe("upcoming");
  });

  it("NEW: «Показать ещё» writes the extent to the URL — «Будущие» widens to, «Прошедшие» widens from", () => {
    expect(
      showMoreHref("/events", {}, {
        from: "2026-10-08",
        to: "2026-10-22",
        nextTo: "2026-11-05",
        nextFrom: null,
      }),
    ).toBe("/events?from=2026-10-08&to=2026-11-05");
    expect(
      showMoreHref("/events", { tense: "past" }, {
        from: "2026-09-24",
        to: "2026-10-08",
        nextTo: null,
        nextFrom: "2026-09-10",
      }),
    ).toBe("/events?tense=past&from=2026-09-10&to=2026-10-08");
    expect(
      showMoreHref("/events", {}, { from: "a", to: "b", nextTo: null, nextFrom: "z" }),
    ).toBeNull();
    expect(
      showMoreHref("/events", { tense: "past" }, { from: "a", to: "b", nextTo: "y", nextFrom: null }),
    ).toBeNull();
  });

  it("NEW: «Показать ещё» writes BOTH returned bounds — a capped read that moved its fixed edge slides the window instead of growing it (row 32)", () => {
    // «Прошедшие»: the URL asked for [2026-01-01, 2026-10-09); the capped read
    // answered [2026-01-01, 2026-03-01) and names the next older `from`.
    expect(
      showMoreHref(
        "/webinars",
        { tense: "past", from: "2026-01-01", to: "2026-10-09" },
        { from: "2026-01-01", to: "2026-03-01", nextTo: null, nextFrom: "2025-12-18" },
      ),
    ).toBe("/webinars?tense=past&from=2025-12-18&to=2026-03-01");
    // «Будущие»: the capped read moved `from` up past the nearest days.
    expect(
      showMoreHref(
        "/events",
        { from: "2026-10-08", to: "2027-06-01" },
        { from: "2026-12-20", to: "2027-06-01", nextTo: "2027-06-15", nextFrom: null },
      ),
    ).toBe("/events?from=2026-12-20&to=2027-06-15");
  });

  it("the read query carries the tense under the host's read param and the codec's horizon and facets", () => {
    expect(
      feedReadQuery({ from: "2026-10-08", to: "2026-10-22", junk: "x" }, "timeframe").toString(),
    ).toBe("from=2026-10-08&to=2026-10-22&timeframe=upcoming");
    expect(
      feedReadQuery({ tense: "past", format: "online" }, "tense").toString(),
    ).toBe("format=online&tense=past");
  });
});
