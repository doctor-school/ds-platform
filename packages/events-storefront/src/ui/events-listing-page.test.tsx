import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventsStorefrontHostConfig } from "../host-config";

const { permanentRedirect, fetchEventsFeed } = vi.hoisted(() => ({
  permanentRedirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  }),
  fetchEventsFeed: vi.fn(() => new Promise(() => {})),
}));

vi.mock("next/navigation", () => ({ permanentRedirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  fetchEventsFeed,
  fetchSpecialtyChoices: vi.fn(async () => []),
  fetchMyEvents: vi.fn(() => new Promise(() => {})),
}));

import { EventsListingPage } from "./events-listing-page";
import { FeedSection } from "./feed-sections";
import { MonthView } from "./month-view";

const CONFIG = {
  filterSet: "academy",
  headerCopy: { title: "Расписание эфиров", subline: "Ближайшие эфиры" },
  contentSet: {
    feedPath: "/v1/public/events",
    tenseParam: "timeframe",
    livePath: "/v1/public/events/live",
    myEventsPath: "/v1/me/events",
    monthPath: "/v1/public/events",
    countsPath: "/v1/public/events/month-counts",
    adapt: () => ({
      cards: [],
      facetOptions: {},
      matching: 0,
      today: "2026-10-08",
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

type AnyElement = ReactElement<Record<string, unknown>>;

/** Every element of the rendered tree (props + children, depth-first). */
function elementsOf(node: ReactNode): AnyElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  const nested = Object.values(element.props).flatMap((value) =>
    isValidElement(value) || Array.isArray(value) ? elementsOf(value as ReactNode) : [],
  );
  return [element, ...nested];
}

async function render(params: Record<string, string>) {
  return elementsOf(
    (await EventsListingPage({
      config: CONFIG,
      searchParams: Promise.resolve(params),
    })) as ReactNode,
  );
}

const byTestId = (tree: AnyElement[], id: string) =>
  tree.find((element) => element.props["data-testid"] === id);

afterEach(() => vi.clearAllMocks());

// Gate §2.5 rows 51 / 56 and §5 «one page, host config only».
describe("<EventsListingPage>", () => {
  it("019 EARS-19: ?view=month mounts the month view of the one page with a validated month", async () => {
    const tree = await render({ view: "month", month: "2026-07" });
    const month = tree.find((element) => element.type === MonthView);
    expect(month?.props).toMatchObject({ config: CONFIG, month: "2026-07" });
    expect(tree.some((element) => element.type === FeedSection)).toBe(false);

    const malformed = await render({ view: "month", month: "2026-7" });
    const fallback = malformed.find((element) => element.type === MonthView);
    expect(fallback?.props.month).toBeUndefined();
  });

  it("NEW: the default view mounts the day feed with the host config and the query, no month view", async () => {
    const tree = await render({ tense: "past", school: "s-1" });
    const feed = tree.find((element) => element.type === FeedSection);
    expect(feed?.props).toMatchObject({
      config: CONFIG,
      query: { tense: "past", school: "s-1" },
    });
    expect(tree.some((element) => element.type === MonthView)).toBe(false);
  });

  it("NEW: the switch link «Календарь на месяц →» / «← Лента событий» keeps the tense and the facets (row 51)", async () => {
    const feed = await render({ tense: "past", topic: "t-1" });
    const toMonth = byTestId(feed, "events-view-switch");
    expect(toMonth?.props.href).toBe("/webinars?view=month&tense=past&topic=t-1");
    expect(toMonth?.props.children).toBe("Календарь на месяц →");
    expect(byTestId(feed, "events-view-switch-narrow")?.props.href).toBe(
      toMonth?.props.href,
    );

    const month = await render({ tense: "past", topic: "t-1", view: "month" });
    const toFeed = byTestId(month, "events-view-switch");
    expect(toFeed?.props.href).toBe("/webinars?tense=past&topic=t-1");
    expect(toFeed?.props.children).toBe("← Лента событий");
  });

  it("NEW: a legacy Academy URL answers a permanent redirect to its canonical form (D1)", async () => {
    await expect(
      render({ tab: "past", cursor: "c-1", cursorTrail: "a,b", page: "3" }),
    ).rejects.toThrow("NEXT_REDIRECT /webinars?tense=past");
    expect(permanentRedirect).toHaveBeenCalledWith("/webinars?tense=past");
  });

  it("NEW: a legacy month URL keeps view and month through the one codec's redirect (D1)", async () => {
    await expect(
      render({ view: "month", month: "2026-07", tab: "past" }),
    ).rejects.toThrow();
    expect(permanentRedirect).toHaveBeenCalledWith(
      "/webinars?view=month&month=2026-07&tense=past",
    );
  });
});
