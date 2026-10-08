import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventsStorefrontHostConfig } from "../host-config";

const { eventsFeedView, monthCalendarView, permanentRedirect } = vi.hoisted(
  () => ({
    eventsFeedView: vi.fn(() => null),
    monthCalendarView: vi.fn(() => null),
    permanentRedirect: vi.fn((href: string) => {
      throw new Error(`NEXT_REDIRECT ${href}`);
    }),
  }),
);

vi.mock("./events-feed-view", () => ({ EventsFeedView: eventsFeedView }));
vi.mock("./month-calendar-view", () => ({
  MonthCalendarView: monthCalendarView,
}));
vi.mock("next/navigation", () => ({ permanentRedirect }));

import { EventsListingPage } from "./events-listing-page";

const CONFIG = {
  headerCopy: { title: "Расписание эфиров", subline: "Ближайшие эфиры" },
  contentSet: {
    feedPath: "/v1/public/events",
    tenseParam: "timeframe",
    livePath: "/v1/public/events/live",
    myEventsPath: "/v1/me/events",
    adapt: () => ({
      cards: [],
      horizon: { from: "", to: "", nextTo: null, nextFrom: null },
      remaining: 0,
      nextBatch: 0,
    }),
  },
  routes: {
    listing: "/webinars",
    eventPage: "/webinars",
    login: "/login",
    accountEvents: "/account/events",
  },
} satisfies EventsStorefrontHostConfig;

/** The element the page renders for these params. */
async function render(params: Record<string, string>) {
  return (await EventsListingPage({
    config: CONFIG,
    searchParams: Promise.resolve(params),
  })) as { type: unknown; props: Record<string, unknown> };
}

afterEach(() => vi.clearAllMocks());

// Gate §2.4 / §4.3 D1 — the Academy listing route mounts the one feed view;
// `?view=month` keeps the month pane until PR 2.5.
describe("<EventsListingPage>", () => {
  it("EARS-19: ?view=month mounts the month pane with a validated month", async () => {
    const element = await render({ view: "month", month: "2026-07" });
    expect(element.type).toBe(monthCalendarView);
    expect(element.props).toMatchObject({ config: CONFIG, month: "2026-07" });

    const malformed = await render({ view: "month", month: "2026-7" });
    expect(malformed.props.month).toBeUndefined();
  });

  it("NEW: the default view mounts the one feed view with the host config and the query", async () => {
    const element = await render({ tense: "past", school: "s-1" });
    expect(element.type).toBe(eventsFeedView);
    expect(element.props).toMatchObject({
      config: CONFIG,
      query: { tense: "past", school: "s-1" },
    });
  });

  it("NEW: the head carries «Календарь на месяц →» to the month view of the same query", async () => {
    const element = await render({ tense: "past" });
    const action = element.props.headAction as {
      props: { tone: string; children: { props: { href: string } } };
    };
    expect(action.props.tone).toBe("on-primary");
    expect(action.props.children.props.href).toBe(
      "/webinars?tense=past&view=month",
    );
  });

  it("NEW: a legacy Academy URL answers a permanent redirect to its canonical form (D1)", async () => {
    await expect(
      render({ tab: "past", cursor: "c-1", cursorTrail: "a,b", page: "3" }),
    ).rejects.toThrow("NEXT_REDIRECT /webinars?tense=past");
    expect(permanentRedirect).toHaveBeenCalledWith("/webinars?tense=past");
  });

  it("NEW: a legacy month URL keeps view and month through the redirect (D1, until PR 2.5)", async () => {
    await expect(
      render({ view: "month", month: "2026-07", tab: "past" }),
    ).rejects.toThrow();
    expect(permanentRedirect).toHaveBeenCalledWith(
      "/webinars?view=month&month=2026-07&tense=past",
    );
  });
});
