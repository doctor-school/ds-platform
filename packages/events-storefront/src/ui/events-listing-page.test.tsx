import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventsStorefrontHostConfig } from "../host-config";

const { discoveryListing, monthCalendarView } = vi.hoisted(() => ({
  discoveryListing: vi.fn(() => null),
  monthCalendarView: vi.fn(() => null),
}));

vi.mock("./discovery-listing", () => ({ DiscoveryListing: discoveryListing }));
vi.mock("./month-calendar-view", () => ({
  MonthCalendarView: monthCalendarView,
}));

import { EventsListingPage } from "./events-listing-page";

const CONFIG: EventsStorefrontHostConfig = {
  headerCopy: { title: "Расписание эфиров", subline: "Ближайшие эфиры" },
  contentSet: { myEventsPath: "/v1/me/events" },
  routes: {
    listing: "/webinars",
    eventPage: "/webinars",
    login: "/login",
    accountEvents: "/account/events",
  },
};

/** The props the page hands to the pane it renders. */
async function render(params: Record<string, string>) {
  const element = (await EventsListingPage({
    config: CONFIG,
    searchParams: Promise.resolve(params),
  })) as { type: unknown; props: Record<string, unknown> };
  return element;
}

afterEach(() => vi.clearAllMocks());

// 004 EARS-7 / EARS-19 — gate §2.2 row 16: the listing route is one mount and
// `?view=month` selects the month pane.
describe("<EventsListingPage>", () => {
  it("EARS-19: ?view=month mounts the month pane with a validated month", async () => {
    const element = await render({ view: "month", month: "2026-07" });
    expect(element.type).toBe(monthCalendarView);
    expect(element.props).toMatchObject({ config: CONFIG, month: "2026-07" });

    const malformed = await render({ view: "month", month: "2026-7" });
    expect(malformed.props.month).toBeUndefined();
  });

  it("EARS-18: the week pane carries the month into both switcher hrefs on the host's listing route", async () => {
    const element = await render({ month: "2026-09", tab: "past", page: "2" });
    expect(element.type).toBe(discoveryListing);
    expect(element.props).toMatchObject({
      config: CONFIG,
      timeframe: "past",
      page: 2,
      monthViewHref: "/webinars?month=2026-09&tab=past&page=2&view=month",
      weekViewHref: "/webinars?month=2026-09&tab=past&page=2",
    });
  });

  it("EARS-7: an invalid page falls back to the first page", async () => {
    const element = await render({ page: "-3" });
    expect(element.props).toMatchObject({ timeframe: "upcoming", page: 1 });
  });
});
