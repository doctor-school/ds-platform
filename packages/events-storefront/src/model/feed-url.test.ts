import { describe, expect, it } from "vitest";

import { appliedFacetsOf, withAppliedFacets } from "./facets";
import {
  canonicalFeedRedirect,
  dayHref,
  monthHref,
  monthReadQuery,
  pageMonthOf,
  pageViewOf,
  viewHref,
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

  it("NEW: §4.3 D1 — view and month keep their meaning in the one codec through the legacy redirect", () => {
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
      feedReadQuery({ from: "2026-10-08", to: "2026-10-22", junk: "x" }, "timeframe", "academy").toString(),
    ).toBe("from=2026-10-08&to=2026-10-22&timeframe=upcoming");
    expect(
      feedReadQuery({ tense: "past", format: "online" }, "tense", "doctor").toString(),
    ).toBe("format=online&tense=past");
  });
});

describe("the month view is a view of the one page (row 51)", () => {
  it("NEW: the round-trip keeps tense and facets on both hosts", () => {
    const doctor = { tense: "past", format: "online", specialty: "all", from: "2026-09-01", to: "2026-10-01", day: "2026-09-10" };
    const toMonth = viewHref("/events", doctor, "month");
    expect(toMonth).toBe("/events?view=month&tense=past&format=online&specialty=all");
    const back = viewHref("/events", Object.fromEntries(new URL(toMonth, "http://x").searchParams), "feed");
    expect(back).toBe("/events?tense=past&format=online&specialty=all");

    const academy = { tense: "past", project: ["a", "b"], topic: "t" };
    const toAcademyMonth = viewHref("/webinars", academy, "month");
    expect(toAcademyMonth).toBe("/webinars?view=month&tense=past&project=a&project=b&topic=t");
    expect(pageViewOf({ view: "month" })).toBe("month");
    expect(pageViewOf({ view: "week" })).toBe("feed");
  });

  it("NEW: a malformed month reads as absent and never voids the rest of the URL", () => {
    expect(pageMonthOf({ month: "2026-13" })).toBeUndefined();
    expect(pageMonthOf({ month: "2026-09" })).toBe("2026-09");
    expect(monthHref("/events", { view: "month", month: "nope", format: "online" }, "2026-11")).toBe(
      "/events?view=month&month=2026-11&format=online",
    );
    expect(monthHref("/events", { view: "month", month: "2026-11", day: "2026-11-02" }, undefined)).toBe(
      "/events?view=month",
    );
  });

  it("NEW: each host's reads take only that host's facets", () => {
    const raw = { view: "month", month: "2026-09", format: "online", project: "p" };
    expect(monthReadQuery(raw, "doctor", { month: "2026-09" }).toString()).toBe("month=2026-09&format=online");
    expect(monthReadQuery(raw, "academy", { year: "2026" }).toString()).toBe("year=2026&project=p");
    expect(feedReadQuery(raw, "timeframe", "academy").toString()).toBe("project=p&timeframe=upcoming");
  });
});

describe("dayHref — one day-href rule over the extent (row 57)", () => {
  const HORIZON = { from: "2026-09-01", to: "2026-09-15" };
  // Today is pinned so the tense boundary is fixed; the served «Будущие» extent is HORIZON.
  const TODAY = "2026-09-01";
  const params = (value: string) => new URL(value, "http://127.0.0.1").searchParams;

  it("EARS-4.5: a day inside the served horizon leaves the horizon alone", () => {
    const query = params(dayHref("/events", { format: "online" }, "2026-09-04", HORIZON, TODAY));
    expect(query.get("day")).toBe("2026-09-04");
    expect(query.get("month")).toBe("2026-09");
    expect(query.get("to")).toBeNull();
    expect(query.get("from")).toBeNull();
    expect(query.get("format")).toBe("online");
  });

  it("EARS-4.5: the day AT the exclusive bound widens — that day is not served yet", () => {
    const query = params(dayHref("/events", {}, "2026-09-15", HORIZON, TODAY));
    expect(query.get("from")).toBe("2026-09-01");
    expect(query.get("to")).toBe("2026-09-16");
  });

  it("EARS-4.5: a day past the horizon widens to the day AFTER it, so the day itself is inside the read", () => {
    const query = params(dayHref("/events", {}, "2026-09-20", HORIZON, TODAY));
    expect(query.get("day")).toBe("2026-09-20");
    expect(query.get("to")).toBe("2026-09-21");
  });

  it("EARS-4.5: widening at a month boundary rolls the bound into the next month", () => {
    const query = params(dayHref("/events", {}, "2026-09-30", { from: "2026-09-01", to: "2026-09-29" }, TODAY));
    expect(query.get("to")).toBe("2026-10-01");
    expect(query.get("month")).toBe("2026-09");
  });

  it("EARS-4.5: with no horizon known the href never invents one", () => {
    const query = params(dayHref("/events", {}, "2026-09-20", undefined, TODAY));
    expect(query.get("to")).toBeNull();
    expect(query.get("from")).toBeNull();
  });

  it("NEW: on «Прошедшие» a day older than the extent widens `from` back to it", () => {
    const query = params(dayHref("/webinars", { tense: "past" }, "2026-08-20", HORIZON, TODAY));
    expect(query.get("from")).toBe("2026-08-20");
    expect(query.get("to")).toBe("2026-09-15");
    expect(query.get("tense")).toBe("past");
  });

  it("NEW: a day beyond the served extent widens the read so the day is inside it — «Будущие»", () => {
    const query = params(dayHref("/events", { view: "month" }, "2026-09-28", HORIZON, TODAY));
    expect(query.get("view")).toBeNull();
    expect(query.get("tense")).toBeNull();
    expect(query.get("from")).toBe("2026-09-01");
    expect(query.get("to")).toBe("2026-09-29");
    expect(query.get("day")).toBe("2026-09-28");
  });

  it("NEW: a day beyond the served extent widens the read so the day is inside it — «Прошедшие»", () => {
    const served = { from: "2026-08-18", to: "2026-09-02" };
    const query = params(dayHref("/events", { tense: "past" }, "2026-08-03", served, TODAY));
    expect(query.get("tense")).toBe("past");
    expect(query.get("from")).toBe("2026-08-03");
    expect(query.get("to")).toBe("2026-09-02");
  });

  it("NEW: a day across the tense boundary switches the tense and lands on that day — a past day under «Будущие»", () => {
    const near = params(dayHref("/events", { format: "online" }, "2026-08-25", HORIZON, TODAY));
    expect(near.get("tense")).toBe("past");
    expect(near.get("day")).toBe("2026-08-25");
    // Inside the default «Прошедшие» extent (14 days back): no bound is written.
    expect(near.get("from")).toBeNull();
    expect(near.get("to")).toBeNull();
    expect(near.get("format")).toBe("online");

    const far = params(dayHref("/events", {}, "2026-08-03", HORIZON, TODAY));
    expect(far.get("tense")).toBe("past");
    expect(far.get("from")).toBe("2026-08-03");
    expect(far.get("to")).toBe("2026-09-02");
  });

  it("NEW: with no today given, the boundary is the served extent's anchor — the read's own today", () => {
    expect(params(dayHref("/events", {}, "2026-08-31", HORIZON)).get("tense")).toBe("past");
    expect(params(dayHref("/events", {}, "2026-09-01", HORIZON)).get("tense")).toBeNull();
    const served = { from: "2026-08-18", to: "2026-09-02" };
    expect(params(dayHref("/events", { tense: "past" }, "2026-08-31", served)).get("tense")).toBe("past");
    expect(params(dayHref("/events", { tense: "past" }, "2026-09-01", served)).get("tense")).toBeNull();
  });

  it("NEW: a day across the tense boundary switches the tense and lands on that day — today and later under «Прошедшие»", () => {
    const served = { from: "2026-08-18", to: "2026-09-02" };
    const today = params(dayHref("/events", { tense: "past" }, TODAY, served, TODAY));
    expect(today.get("tense")).toBeNull();
    expect(today.get("day")).toBe(TODAY);
    expect(today.get("from")).toBeNull();
    expect(today.get("to")).toBeNull();

    const far = params(dayHref("/events", { tense: "past" }, "2026-09-25", served, TODAY));
    expect(far.get("tense")).toBeNull();
    expect(far.get("from")).toBe("2026-09-01");
    expect(far.get("to")).toBe("2026-09-26");
  });
});

describe("the facet panel writes the URL (rows 58, 59)", () => {
  it("NEW: each host writes exactly its set; an applied facet round-trips through the URL", () => {
    const applied = appliedFacetsOf({ format: "online", project: "p", from: "2026-09-01" });
    expect(applied.format).toEqual(["online"]);
    expect(withAppliedFacets({ tense: "past", format: "online", from: "x" }, { ...applied, kind: ["lecture"] }, "doctor"))
      .toMatchObject({ tense: "past", format: ["online"], kind: ["lecture"], from: undefined });
    expect(withAppliedFacets({ project: "p" }, { ...applied, project: ["q"], format: ["offline"] }, "academy"))
      .toMatchObject({ project: ["q"] });
    expect(withAppliedFacets({}, { ...applied, format: ["offline"] }, "academy").format).toBeUndefined();
  });

  it("NEW: the three specialty states round-trip through the URL; removing the last picked one returns to «Моя и смежные»", () => {
    expect(appliedFacetsOf({}).specialtyScope).toBe("mine-and-adjacent");
    expect(appliedFacetsOf({ specialty: "all" }).specialtyScope).toBe("all");
    expect(appliedFacetsOf({ specialty: ["s1", "s2"] }, (id) => `name-${id}`).specialtyScope).toEqual([
      { id: "s1", label: "name-s1" },
      { id: "s2", label: "name-s2" },
    ]);
    const base = appliedFacetsOf({});
    expect(withAppliedFacets({}, { ...base, specialtyScope: "all" }, "doctor").specialty).toBe("all");
    expect(withAppliedFacets({}, { ...base, specialtyScope: [{ id: "s1", label: "x" }] }, "doctor").specialty).toEqual(["s1"]);
    expect(withAppliedFacets({ specialty: "s1" }, { ...base, specialtyScope: [] }, "doctor").specialty).toBeUndefined();
  });
});
