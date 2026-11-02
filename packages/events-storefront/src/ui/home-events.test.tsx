// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adaptDoctorEventsFeed } from "../adapters";
import type {
  EventsStorefrontHostConfig,
  HomeEventsHostConfig,
} from "../host-config";
import type { EventsFeedCard, EventsFeedPage } from "../model/feed";

/**
 * 017 EARS-9 (#1485) — the home nearest-events block: a short preview of the
 * upcoming feed. The SAME feed read the events page makes (with the host's
 * relayed specialty cookie), the SAME card unit, the first `cardCap` cards and
 * a link to the full feed; the empty and error renders, and an «Обновить» that
 * re-runs that one read.
 */
const mocks = vi.hoisted(() => ({
  fetchEventsFeed: vi.fn(),
  fetchMyEvents: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      cookie: "__Host-ds_session=s; __Host-ds_specialty=kardiologiya",
      "x-forwarded-for": "10.0.0.1",
    }),
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  fetchEventsFeed: mocks.fetchEventsFeed,
  fetchMyEvents: mocks.fetchMyEvents,
}));

import { BlockRetry } from "./block-retry";
import {
  HomeEventsBody,
  HomeEventsSkeleton,
  homeEventsEyebrow,
  renderHomeEventsBlock,
} from "./home-events";

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
  headerCopy: { title: "События", subline: "" },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    accountEvents: "/account/events",
  },
};

const HOME: HomeEventsHostConfig = {
  eyebrow: {
    general: "События",
    targeted: "По вашей специальности и смежным областям",
  },
  title: "Ближайшие события",
  allLink: { label: "Все события →", placement: "head" },
  cardCap: 3,
  empty: {
    title: "Пока ничего не запланировано по вашей специальности",
    pointer: {
      text: "Посмотрите события смежных областей — ",
      linkLabel: "все события →",
    },
  },
};

function card(n: number): EventsFeedCard {
  return {
    id: `id-${n}`,
    slug: `evt-${n}`,
    startsAt: `2026-09-0${n}T09:00:00.000Z`,
    format: "online",
    kindTitle: "Вебинар",
    title: `Событие ${n}`,
    school: "Школа",
    speakers: ["Иванов И. И."],
    state: "upcoming",
    signUpCount: 3,
    recording: null,
  };
}

function page(
  cards: EventsFeedCard[],
  targetingMode?: EventsFeedPage["targetingMode"],
): EventsFeedPage {
  return {
    ...(targetingMode ? { targetingMode } : {}),
    today: "2026-09-01",
    cards,
    horizon: {
      from: "2026-09-01",
      to: "2026-09-30",
      nextCount: null,
      nextFrom: null,
    },
    remaining: 0,
    nextBatch: 0,
    facetOptions: {},
    matching: cards.length,
  };
}

const noRetry = async (): Promise<ReactNode> => null;

beforeEach(() => {
  mocks.fetchEventsFeed.mockReset();
  mocks.fetchMyEvents.mockReset();
  mocks.fetchMyEvents.mockResolvedValue({ authenticated: false });
});
afterEach(cleanup);

describe("017 EARS-9 — home nearest-events block", () => {
  it("EARS-9: when the home page renders, the block shall head with the host's eyebrow, title and a «Все события» link into the events feed", async () => {
    render(
      await HomeEventsBody({
        config: DOCTOR,
        home: HOME,
        read: { ok: true, value: page([card(1)], "general") },
        registeredSlugs: [],
        retry: noRetry,
      }),
    );
    expect(screen.getByTestId("home-events-eyebrow").textContent).toBe(
      "События",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Ближайшие события" }),
    ).toBeTruthy();
    const all = screen.getByTestId("home-events-all");
    expect(all.textContent).toBe("Все события →");
    expect(all.getAttribute("href")).toBe("/events");
  });

  it("EARS-9: when the feed read is targeted on the doctor's specialty, the eyebrow shall be the host's targeted eyebrow", async () => {
    render(
      await HomeEventsBody({
        config: DOCTOR,
        home: HOME,
        read: { ok: true, value: page([card(1)], "targeted") },
        registeredSlugs: [],
        retry: noRetry,
      }),
    );
    expect(screen.getByTestId("home-events-eyebrow").textContent).toBe(
      "По вашей специальности и смежным областям",
    );
  });

  it("EARS-9: when the feed read is not targeted (general, all, or a host with no targeting), the eyebrow shall be the host's general one", () => {
    for (const mode of ["general", "all", undefined] as const) {
      expect(homeEventsEyebrow(HOME, { ok: true, value: page([], mode) })).toBe(
        "События",
      );
    }
    // A failed read states no targeting it does not know.
    expect(homeEventsEyebrow(HOME, { ok: false })).toBe("События");
    // A host with one eyebrow keeps it on a targeted read.
    expect(
      homeEventsEyebrow(
        { ...HOME, eyebrow: { general: "Эфиры" } },
        { ok: true, value: page([], "targeted") },
      ),
    ).toBe("Эфиры");
  });

  it("EARS-9: when the feed read answers, the block shall show only the first cardCap cards of the upcoming feed as the feed's card unit", async () => {
    render(
      await HomeEventsBody({
        config: DOCTOR,
        home: HOME,
        read: { ok: true, value: page([1, 2, 3, 4, 5].map(card)) },
        registeredSlugs: ["evt-2"],
        retry: noRetry,
      }),
    );
    const cards = screen.getByTestId("home-events-cards");
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(cards.querySelectorAll("[data-webinar-card]")).toHaveLength(3);
    for (const slug of ["evt-1", "evt-2", "evt-3"]) {
      expect(cards.querySelector(`a[href="/events/${slug}"]`)).not.toBeNull();
    }
    expect(cards.querySelector('a[href="/events/evt-4"]')).toBeNull();
  });

  it("EARS-9: when the feed read has no upcoming event, the block shall state the host's empty copy with the pointer into the events feed", async () => {
    render(
      await HomeEventsBody({
        config: DOCTOR,
        home: HOME,
        read: { ok: true, value: page([]) },
        registeredSlugs: [],
        retry: noRetry,
      }),
    );
    const empty = screen.getByTestId("home-events-empty");
    expect(empty.textContent).toContain(
      "Пока ничего не запланировано по вашей специальности",
    );
    expect(empty.textContent).toContain("Посмотрите события смежных областей");
    const link = within(empty).getByRole("link", { name: "все события →" });
    expect(link.getAttribute("href")).toBe("/events");
    expect(screen.queryByTestId("home-events-cards")).toBeNull();
  });

  it("EARS-9: when the feed read fails, the block shall state «Не удалось загрузить события.» and «Обновить» shall re-run the read and replace the block with its cards", async () => {
    mocks.fetchEventsFeed.mockResolvedValue({
      ok: true,
      value: page([card(1)]),
    });
    const retry = vi.fn(() => renderHomeEventsBlock(DOCTOR, HOME, retry));
    render(
      <BlockRetry retry={retry}>
        {await HomeEventsBody({
          config: DOCTOR,
          home: HOME,
          read: { ok: false },
          registeredSlugs: [],
          retry,
        })}
      </BlockRetry>,
    );
    const error = screen.getByTestId("home-events-error");
    expect(error.textContent).toContain("Не удалось загрузить события.");
    expect(screen.getByTestId("home-events-eyebrow").textContent).toBe(
      "События",
    );
    await userEvent.click(
      within(error).getByRole("button", { name: "Обновить" }),
    );

    expect(await screen.findByTestId("home-events-cards")).toBeTruthy();
    expect(screen.queryByTestId("home-events-error")).toBeNull();
    // The retried block replaces the failed one whole: one head, not two.
    expect(screen.getAllByTestId("home-events-eyebrow")).toHaveLength(1);
    expect(mocks.fetchEventsFeed).toHaveBeenCalledTimes(1);
    const [config, raw, request] = mocks.fetchEventsFeed.mock.calls[0]!;
    expect(config).toBe(DOCTOR);
    expect(raw).toEqual({});
    // The relayed specialty cookie rides with the read: targeted after a choice.
    expect(request.cookie).toContain("__Host-ds_specialty=kardiologiya");
  });

  it("EARS-9: while the read is in flight, the block shall render cardCap card skeletons", () => {
    render(<HomeEventsSkeleton config={DOCTOR} home={HOME} />);
    // The targeting is the read's, still unknown: no eyebrow is claimed yet.
    expect(screen.queryByTestId("home-events-eyebrow")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Ближайшие события" }),
    ).toBeTruthy();
    const skeleton = screen.getByTestId("home-events-skeleton");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(skeleton.children).toHaveLength(3);
  });

  it("EARS-9: a host that places the link below the cards shall get it after the cards, not in the head", async () => {
    const foot: HomeEventsHostConfig = {
      ...HOME,
      cardCap: 2,
      allLink: { label: "Все события и эфиры →", placement: "foot" },
    };
    render(
      await HomeEventsBody({
        config: DOCTOR,
        home: foot,
        read: { ok: true, value: page([1, 2, 3].map(card)) },
        registeredSlugs: [],
        retry: noRetry,
      }),
    );
    expect(
      within(screen.getByTestId("home-events-cards")).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(screen.getAllByTestId("home-events-all")).toHaveLength(1);
    expect(screen.getByTestId("home-events-all").textContent).toBe(
      "Все события и эфиры →",
    );
  });
});
