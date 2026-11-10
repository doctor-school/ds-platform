// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adaptDoctorEventsFeed } from "../adapters";
import type { EventsStorefrontHostConfig } from "../host-config";
import type { EventsFeedCard, EventsFeedPage } from "../model/feed";

/**
 * #1485 — 017 EARS-9: the home's nearest events ARE the events page's feed
 * block (019 EARS-3/EARS-9), capped. The capped block renders the first N
 * cards of the same read in the same form, its one link resolves to the full
 * listing, and a failed capped block's «Повторить» stays capped.
 */
const mocks = vi.hoisted(() => ({
  fetchEventsFeed: vi.fn(),
  fetchMyEvents: vi.fn(),
  fetchSpecialtyChoices: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      cookie: "__Host-ds_session=s; __Host-ds_specialty=neurology",
      "x-forwarded-for": "10.0.0.1",
    }),
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  fetchEventsFeed: mocks.fetchEventsFeed,
  fetchMyEvents: mocks.fetchMyEvents,
  fetchSpecialtyChoices: mocks.fetchSpecialtyChoices,
}));

import {
  type EventsBlockRetryAction,
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "./events-block-retry";
import { EventsFeed } from "./events-feed";
import { FeedSection } from "./feed-sections";

const DOCTOR: EventsStorefrontHostConfig = {
  filterSet: "doctor",
  contentSet: {
    feedPath: "/v1/storefront/doctor/events",
    tenseParam: "tense",
    relayCookie: "__Host-ds_specialty",
    livePath: "/v1/storefront/doctor/events/live",
    myEventsPath: "/v1/storefront/doctor/me/events",
    monthPath: "/v1/storefront/doctor/events/month",
    countsPath: "/v1/storefront/doctor/events/month-counts",
    adapt: adaptDoctorEventsFeed,
  },
  headerCopy: { title: "События", subline: "События" },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    accountEvents: "/account/events",
  },
};

function card(n: number): EventsFeedCard {
  return {
    id: `e-${n}`,
    slug: `e-${n}`,
    startsAt: `2026-10-${10 + n}T16:00:00.000Z`,
    format: "online",
    kindTitle: "Вебинар",
    title: `Разбор ${n}`,
    school: "Школа",
    speakers: [],
    state: "upcoming",
    signUpCount: 4,
    recording: null,
  };
}

const PAGE: EventsFeedPage = {
  facetOptions: {},
  matching: 7,
  cards: [1, 2, 3, 4, 5].map(card),
  today: "2026-10-08",
  horizon: {
    from: "2026-10-08",
    to: "2026-10-22",
    nextCount: 20,
    nextFrom: null,
  },
  remaining: 2,
  nextBatch: 2,
};

const REQUEST = {
  cookie: "",
  userAgent: "",
  acceptLanguage: "",
  forwardedFor: "10.0.0.1",
};
const NONE = Promise.resolve([]);

function hostAction(): EventsBlockRetryAction & ReturnType<typeof vi.fn> {
  const action = vi.fn(
    async (input: EventsBlockRetryInput): Promise<ReactNode> =>
      renderEventsBlock(DOCTOR, action, input),
  );
  return action as never;
}

function shownTitles(): string[] {
  return within(screen.getByTestId("events-feed"))
    .getAllByRole("heading")
    .map((heading) => heading.textContent ?? "")
    .filter((text) => text.startsWith("Разбор"));
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchMyEvents.mockResolvedValue({ authenticated: false });
  mocks.fetchEventsFeed.mockResolvedValue({ ok: true, value: PAGE });
  mocks.fetchSpecialtyChoices.mockResolvedValue([]);
});

describe("the feed block with a cap (017 EARS-9, #1485)", () => {
  it("017 EARS-9: a capped feed renders the first N cards of the read and one «Все события» link to the full listing", async () => {
    render(
      <>
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: Promise.resolve({ ok: true as const, value: PAGE }),
          mine: Promise.resolve({ ok: true as const, value: null }),
          specialties: NONE,
          kinds: NONE,
          request: REQUEST,
          retry: hostAction(),
          limit: 3,
        })}
      </>,
    );
    expect(shownTitles()).toEqual(["Разбор 1", "Разбор 2", "Разбор 3"]);
    const more = screen.getByTestId("events-feed-show-more");
    expect(more).toHaveTextContent("Все события");
    expect(more).toHaveAttribute("href", "/events");
  });

  it("017 EARS-9: without a cap the same read renders every card and the forward «Показать ещё» (019 EARS-3)", async () => {
    render(
      <>
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: Promise.resolve({ ok: true as const, value: PAGE }),
          mine: Promise.resolve({ ok: true as const, value: null }),
          specialties: NONE,
          kinds: NONE,
          request: REQUEST,
          retry: hostAction(),
        })}
      </>,
    );
    expect(shownTitles()).toHaveLength(5);
    expect(screen.getByTestId("events-feed-show-more")).not.toHaveTextContent(
      "Все события",
    );
  });

  it("017 EARS-9: a failed capped feed's «Повторить» re-runs the feed read and the recovered block stays capped", async () => {
    const action = hostAction();
    render(
      <>
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: Promise.resolve({ ok: false as const }),
          mine: Promise.resolve({ ok: true as const, value: null }),
          specialties: NONE,
          kinds: NONE,
          request: REQUEST,
          retry: action,
          limit: 3,
        })}
      </>,
    );
    const error = screen.getByTestId("events-feed-error");
    await userEvent.click(
      within(error).getByRole("button", { name: "Повторить" }),
    );
    await screen.findByTestId("events-feed");
    expect(action).toHaveBeenCalledWith({
      block: "feed",
      raw: {},
      registeredSlugs: [],
      limit: 3,
    });
    expect(shownTitles()).toHaveLength(3);
    expect(screen.getByTestId("events-feed-show-more")).toHaveTextContent(
      "Все события",
    );
  });
});

describe("EventsFeed — the capped feed block a home mounts (017 EARS-9)", () => {
  it("017 EARS-9: the home reads the upcoming feed with no facet and the relayed request, and renders it capped", async () => {
    // The mount is a Suspense boundary over the feed block: jsdom cannot
    // stream an async server child, so the test renders the fallback and the
    // block it suspends on, each as the server would.
    const mount = (await EventsFeed({
      config: DOCTOR,
      limit: 3,
      retry: hostAction(),
    })) as ReactElement<{ fallback: ReactElement; children: ReactElement }>;
    expect(mocks.fetchEventsFeed).toHaveBeenCalledWith(DOCTOR, {}, {
      cookie: "__Host-ds_session=s; __Host-ds_specialty=neurology",
      userAgent: "",
      acceptLanguage: "",
      forwardedFor: "10.0.0.1",
    });
    render(mount.props.fallback);
    expect(screen.getByTestId("events-feed-skeleton")).toBeInTheDocument();
    cleanup();
    const block = mount.props.children as ReactElement<
      Parameters<typeof FeedSection>[0]
    >;
    expect(block.type).toBe(FeedSection);
    expect(block.props.limit).toBe(3);
    render(<>{await FeedSection(block.props)}</>);
    expect(shownTitles()).toHaveLength(3);
  });
});
