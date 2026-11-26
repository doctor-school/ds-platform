import { describe, expect, it } from "vitest";
import {
  EVENTS_LIST_SORT_DEFAULT,
  EVENTS_LIST_VIEW_DEFAULT,
  eventsListHref,
  eventsListPeriod,
  eventsListSortOrderKind,
  eventsListViewFromAddress,
  isEventsListSortDefault,
  type EventsListView,
} from "./events-list";

const address = (search: string) => new URLSearchParams(search);

describe("007 EARS-14: the admin event list view in the address", () => {
  it("007 EARS-14: a bare address is the default view — newest start date first, page 1, no filter", () => {
    expect(eventsListViewFromAddress(address(""))).toEqual({
      q: "",
      state: "",
      startsFrom: "",
      startsTo: "",
      sort: { key: "startsAt", direction: "desc" },
      page: 1,
    });
    expect(EVENTS_LIST_SORT_DEFAULT).toEqual({
      key: "startsAt",
      direction: "desc",
    });
  });

  it("007 EARS-14: the sort, the filters and the page read back from the address", () => {
    expect(
      eventsListViewFromAddress(
        address(
          "q=%D0%9A%D0%B0%D1%80%D0%B4%D0%B8%D0%BE&state=published&startsFrom=2026-10-01&startsTo=2026-10-31&sort=title&dir=asc&page=3",
        ),
      ),
    ).toEqual({
      q: "Кардио",
      state: "published",
      startsFrom: "2026-10-01",
      startsTo: "2026-10-31",
      sort: { key: "title", direction: "asc" },
      page: 3,
    });
  });

  it("007 EARS-14: the legacy in_archive state is a state the list filters by", () => {
    expect(eventsListViewFromAddress(address("state=in_archive")).state).toBe(
      "in_archive",
    );
  });

  it("007 EARS-14: a sort key without a direction reads ascending, as the route does", () => {
    expect(eventsListViewFromAddress(address("sort=school")).sort).toEqual({
      key: "school",
      direction: "asc",
    });
  });

  it("007 EARS-14: a value the route would refuse reads as not applied, never as a 400 page", () => {
    const view = eventsListViewFromAddress(
      address(
        `q=${"я".repeat(161)}&state=retired&startsFrom=2026-02-31&startsTo=31.10.2026&sort=kind&dir=up&page=0`,
      ),
    );
    expect(view).toEqual(EVENTS_LIST_VIEW_DEFAULT);
    expect(eventsListViewFromAddress(address("sort=title&dir=up")).sort).toEqual(
      EVENTS_LIST_SORT_DEFAULT,
    );
    expect(eventsListViewFromAddress(address("page=2.5")).page).toBe(1);
    expect(eventsListViewFromAddress(address("page=-4")).page).toBe(1);
  });

  it("007 EARS-14: an inverted period keeps its «с» and drops the «по» the route would refuse", () => {
    const view = eventsListViewFromAddress(
      address("startsFrom=2026-10-31&startsTo=2026-10-01"),
    );
    expect(view.startsFrom).toBe("2026-10-31");
    expect(view.startsTo).toBe("");
  });

  it("007 EARS-14: the default view writes a bare address — the default order is left out of it", () => {
    expect(eventsListHref("/events", EVENTS_LIST_VIEW_DEFAULT)).toBe("/events");
  });

  it("007 EARS-14: a non-default view writes every part it holds, page 1 omitted", () => {
    const view: EventsListView = {
      q: "ХСН",
      state: "hidden",
      startsFrom: "2026-09-01",
      startsTo: "",
      sort: { key: "state", direction: "desc" },
      page: 1,
    };
    const href = eventsListHref("/events", view);
    expect(href).toBe(
      "/events?q=%D0%A5%D0%A1%D0%9D&state=hidden&startsFrom=2026-09-01&sort=state&dir=desc",
    );
    const back = eventsListViewFromAddress(address(href.split("?")[1]!));
    expect(back).toEqual(view);
    expect(
      eventsListHref("/events", { ...EVENTS_LIST_VIEW_DEFAULT, page: 2 }),
    ).toBe("/events?page=2");
  });

  it("007 EARS-14: the search is written trimmed and a blank search is left out", () => {
    expect(
      eventsListHref("/events", { ...EVENTS_LIST_VIEW_DEFAULT, q: "  " }),
    ).toBe("/events");
    expect(
      eventsListHref("/events", { ...EVENTS_LIST_VIEW_DEFAULT, q: " вебинар " }),
    ).toBe("/events?q=%D0%B2%D0%B5%D0%B1%D0%B8%D0%BD%D0%B0%D1%80");
  });

  it("007 EARS-14: only the date-desc pair is the default order", () => {
    expect(isEventsListSortDefault({ key: "startsAt", direction: "desc" })).toBe(
      true,
    );
    expect(isEventsListSortDefault({ key: "startsAt", direction: "asc" })).toBe(
      false,
    );
    expect(isEventsListSortDefault({ key: "title", direction: "desc" })).toBe(
      false,
    );
  });

  it("007 EARS-14: the period chip shows Moscow calendar days, never shifted, with an open end", () => {
    expect(eventsListPeriod(EVENTS_LIST_VIEW_DEFAULT)).toBeNull();
    expect(
      eventsListPeriod({
        ...EVENTS_LIST_VIEW_DEFAULT,
        startsFrom: "2026-10-01",
        startsTo: "2026-10-31",
      }),
    ).toEqual({ from: "01.10.2026", to: "31.10.2026" });
    expect(
      eventsListPeriod({ ...EVENTS_LIST_VIEW_DEFAULT, startsTo: "2027-01-15" }),
    ).toEqual({ from: "", to: "15.01.2027" });
  });

  it("007 EARS-14: each sort key reads in its own order wording", () => {
    expect(eventsListSortOrderKind("startsAt")).toBe("date");
    expect(eventsListSortOrderKind("title")).toBe("text");
    expect(eventsListSortOrderKind("school")).toBe("text");
    expect(eventsListSortOrderKind("state")).toBe("state");
  });
});
