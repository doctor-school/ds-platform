// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adaptDoctorEventsFeed } from "../adapters";
import type { EventsStorefrontHostConfig } from "../host-config";
import type { EventsFeedPage } from "../model/feed";

/**
 * #2832 — 019 EARS-9: «a retry that re-runs only that read while the other
 * blocks stay usable». A failed block's «Повторить» calls the host's retry
 * action for THAT block; the action re-runs only that block's read and
 * re-renders only that block — never a route refresh of every read.
 */
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  fetchEventsFeed: vi.fn(),
  fetchEventsLive: vi.fn(),
  fetchMyEvents: vi.fn(),
  fetchSpecialtyChoices: vi.fn(),
  fetchMonthEntries: vi.fn(),
  fetchMonthCounts: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
  usePathname: () => "/events",
  useSearchParams: () => new URLSearchParams(),
  permanentRedirect: vi.fn(),
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
  fetchEventsLive: mocks.fetchEventsLive,
  fetchMyEvents: mocks.fetchMyEvents,
  fetchSpecialtyChoices: mocks.fetchSpecialtyChoices,
  fetchMonthEntries: mocks.fetchMonthEntries,
  fetchMonthCounts: mocks.fetchMonthCounts,
}));

import { BlockError } from "./block-error";
import { BlockRetry } from "./block-retry";
import {
  type EventsBlockRetryAction,
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "./events-block-retry";
import { CountedSubline, FeedSection, MyEventsSection } from "./feed-sections";
import { FeedReadScope } from "./feed-read-scope";
import { FacetColumn } from "./events-listing-page";
import { MonthView } from "./month-view";

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
  headerCopy: { title: "События", subline: "События по вашей специальности и смежным" },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    accountEvents: "/account/events",
  },
};

const PAGE: EventsFeedPage = {
  facetOptions: {},
  matching: 1,
  cards: [
    {
      id: "e-1",
      slug: "e-1",
      startsAt: "2026-10-20T16:00:00.000Z",
      format: "online",
      kindTitle: "Вебинар",
      title: "Клинический разбор",
      school: "Школа",
      speakers: [],
      state: "upcoming",
      signUpCount: 4,
      recording: null,
    },
  ],
  today: "2026-10-08",
  horizon: { from: "2026-10-08", to: "2026-10-22", nextTo: "2026-11-05", nextFrom: null },
  remaining: 0,
  nextBatch: 0,
};

const REQUEST = { cookie: "", forwardedFor: "10.0.0.1" };
const ACTION_REQUEST = {
  cookie: "__Host-ds_session=s; __Host-ds_specialty=neurology",
  forwardedFor: "10.0.0.1",
};
const NO_SPECIALTIES = Promise.resolve([]);

/** The reads a retry must leave alone, by name. */
const READS = () => ({
  feed: mocks.fetchEventsFeed,
  live: mocks.fetchEventsLive,
  myEvents: mocks.fetchMyEvents,
  specialties: mocks.fetchSpecialtyChoices,
  monthEntries: mocks.fetchMonthEntries,
  monthCounts: mocks.fetchMonthCounts,
});

function calledReads(): string[] {
  return Object.entries(READS())
    .filter(([, read]) => read.mock.calls.length > 0)
    .map(([name]) => name);
}

/** The host's action, as a host wires it: the package render over its config. */
function hostAction(): EventsBlockRetryAction & ReturnType<typeof vi.fn> {
  const action = vi.fn(
    async (input: EventsBlockRetryInput): Promise<ReactNode> =>
      renderEventsBlock(DOCTOR, action, input),
  );
  return action as never;
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchMyEvents.mockResolvedValue({ authenticated: false });
  mocks.fetchEventsLive.mockResolvedValue({ ok: true, value: [] });
  mocks.fetchEventsFeed.mockResolvedValue({ ok: true, value: PAGE });
  mocks.fetchSpecialtyChoices.mockResolvedValue([]);
  mocks.fetchMonthCounts.mockResolvedValue({ ok: true, value: [] });
});

describe("renderEventsBlock — one block's read, one block's render (#2832)", () => {
  it("EARS-9: a month-grid retry re-runs only the month read and renders only the month grid", async () => {
    mocks.fetchMonthEntries.mockResolvedValue({ ok: true, value: [] });
    const action = hostAction();
    const raw = { view: "month", month: "2026-10" };
    render(
      <>
        {await renderEventsBlock(DOCTOR, action, {
          block: "month",
          raw,
          month: "2026-10",
          today: "2026-10-08",
          horizon: PAGE.horizon,
          facetOptions: {},
        })}
      </>,
    );
    expect(calledReads()).toEqual(["monthEntries"]);
    expect(mocks.fetchMonthEntries).toHaveBeenCalledWith(DOCTOR, raw, "2026-10", ACTION_REQUEST);
    expect(screen.getByTestId("month-grid-desktop")).toBeInTheDocument();
    expect(screen.queryByTestId("events-month-error")).toBeNull();
    expect(screen.queryByTestId("month-toolbar")).toBeNull();
  });

  it("EARS-9: a day-feed retry re-runs only the feed read and keeps the registered marks it was given", async () => {
    const action = hostAction();
    render(
      <>
        {await renderEventsBlock(DOCTOR, action, {
          block: "feed",
          raw: {},
          registeredSlugs: ["e-1"],
        })}
      </>,
    );
    expect(calledReads()).toEqual(["feed"]);
    expect(mocks.fetchEventsFeed).toHaveBeenCalledWith(DOCTOR, {}, ACTION_REQUEST);
    expect(screen.getByTestId("events-feed")).toHaveTextContent("Клинический разбор");
  });

  it("EARS-9: a «Мои события» retry re-runs only the viewer's registrations read", async () => {
    const action = hostAction();
    await renderEventsBlock(DOCTOR, action, { block: "my-events" });
    expect(calledReads()).toEqual(["myEvents"]);
    expect(mocks.fetchMyEvents).toHaveBeenCalledWith(
      DOCTOR.contentSet.myEventsPath,
      expect.objectContaining({ cookie: ACTION_REQUEST.cookie }),
    );
  });

  it("EARS-9: a retry that is not one of the page's blocks is refused before any read", async () => {
    const action = hostAction();
    await expect(
      renderEventsBlock(DOCTOR, action, { block: "everything" } as never),
    ).rejects.toThrow();
    expect(calledReads()).toEqual([]);
  });
});

describe("«Повторить» in a failed block (#2832)", () => {
  it("EARS-9: the failed month grid retries through the host action for that block, never a route refresh", async () => {
    mocks.fetchMonthEntries.mockResolvedValueOnce({ ok: false });
    const action = hostAction();
    const raw = { view: "month", month: "2026-10" };
    render(
      await MonthView({
        config: DOCTOR,
        raw,
        month: "2026-10",
        feed: Promise.resolve({ ok: true as const, value: PAGE }),
        specialties: NO_SPECIALTIES,
        request: REQUEST,
        retry: action,
      }),
    );
    const toolbar = screen.getByTestId("month-toolbar");
    const error = screen.getByTestId("events-month-error");
    expect(error).toHaveTextContent("Не удалось загрузить календарь");

    vi.clearAllMocks();
    mocks.fetchMonthEntries.mockResolvedValue({ ok: true, value: [] });
    await userEvent.click(within(error).getByRole("button", { name: "Повторить" }));

    expect(await screen.findByTestId("month-grid-desktop")).toBeInTheDocument();
    expect(screen.queryByTestId("events-month-error")).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({
      block: "month",
      raw,
      month: "2026-10",
      today: "2026-10-08",
      horizon: PAGE.horizon,
      facetOptions: {},
    });
    expect(calledReads()).toEqual(["monthEntries"]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    // The picker and its toolbar are the same nodes — only the grid re-rendered.
    expect(screen.getByTestId("month-toolbar")).toBe(toolbar);
  });

  it("EARS-9: a month grid that fails again states its cause again and still retries only itself", async () => {
    mocks.fetchMonthEntries.mockResolvedValue({ ok: false });
    const action = hostAction();
    render(
      await MonthView({
        config: DOCTOR,
        raw: { view: "month" },
        month: "2026-10",
        feed: Promise.resolve({ ok: true as const, value: PAGE }),
        specialties: NO_SPECIALTIES,
        request: REQUEST,
        retry: action,
      }),
    );
    for (const attempt of [1, 2]) {
      await userEvent.click(
        within(screen.getByTestId("events-month-error")).getByRole("button", {
          name: "Повторить",
        }),
      );
      await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(attempt));
      expect(await screen.findByTestId("events-month-error")).toHaveTextContent(
        "Не удалось загрузить календарь",
      );
    }
    expect(mocks.fetchEventsFeed).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("EARS-9: the failed day feed retries only the feed read; «Мои события» beside it is not re-read", async () => {
    const mine = Promise.resolve({
      ok: true as const,
      value: [
        {
          slug: "e-1",
          title: "Моё событие",
          school: "Школа",
          startsAt: "2099-10-20T16:00:00.000Z",
          format: "online",
          state: "upcoming",
        },
      ] as never,
    });
    const action = hostAction();
    render(
      <>
        {await MyEventsSection({ config: DOCTOR, mine, retry: action })}
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: Promise.resolve({ ok: false as const }),
          mine,
          specialties: NO_SPECIALTIES,
          request: REQUEST,
          retry: action,
        })}
      </>,
    );
    const error = screen.getByTestId("events-feed-error");
    await userEvent.click(within(error).getByRole("button", { name: "Повторить" }));

    expect(await screen.findByTestId("events-feed")).toHaveTextContent("Клинический разбор");
    expect(action).toHaveBeenCalledWith({ block: "feed", raw: {}, registeredSlugs: ["e-1"] });
    expect(calledReads()).toEqual(["feed"]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("events-my-events")).toHaveTextContent("Моё событие");
  });

  it("EARS-9: a recovered day feed fills what the page derives from the feed read — «Вид события», the subline — from the retried read, with no other read", async () => {
    const action = hostAction();
    const failed = Promise.resolve({ ok: false as const });
    const panel = { config: DOCTOR, raw: {}, feed: failed, specialties: NO_SPECIALTIES };
    render(
      <FeedReadScope>
        {await CountedSubline({
          feed: failed,
          eventNoun: { one: "событие", few: "события", many: "событий" },
          schoolNoun: { one: "школа", few: "школы", many: "школ" },
        })}
        {await FacetColumn(panel)}
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: failed,
          mine: Promise.resolve({ ok: true as const, value: null }),
          specialties: NO_SPECIALTIES,
          request: REQUEST,
          retry: action,
        })}
      </FeedReadScope>,
    );
    expect(screen.queryByRole("group", { name: "Вид события" })).toBeNull();
    expect(screen.queryByTestId("events-feed-subline-counts")).toBeNull();

    vi.clearAllMocks();
    mocks.fetchEventsFeed.mockResolvedValue({
      ok: true,
      value: {
        ...PAGE,
        facetOptions: { kind: [{ slug: "webinar", title: "Вебинар", count: 3 }] },
        summary: { events: 5, schools: 2 },
      },
    });
    await userEvent.click(
      within(screen.getByTestId("events-feed-error")).getByRole("button", { name: "Повторить" }),
    );

    expect(await screen.findByTestId("events-feed")).toBeInTheDocument();
    const kind = await screen.findByRole("group", { name: "Вид события" });
    expect(within(kind).getByRole("button", { name: "Вебинар" })).toBeInTheDocument();
    expect(screen.getByTestId("events-feed-subline-counts")).toHaveTextContent(
      "5 событий · 2 школы",
    );
    expect(calledReads()).toEqual(["feed"]);
    expect(mocks.fetchEventsFeed).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("EARS-9: a page the server renders again drops the recovered feed read for its own", async () => {
    const action = hostAction();
    const failed = Promise.resolve({ ok: false as const });
    const panel = { config: DOCTOR, raw: {}, feed: failed, specialties: NO_SPECIALTIES };
    const page = async () => (
      <FeedReadScope>
        {await FacetColumn(panel)}
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: failed,
          mine: Promise.resolve({ ok: true as const, value: null }),
          specialties: NO_SPECIALTIES,
          request: REQUEST,
          retry: action,
        })}
      </FeedReadScope>
    );
    const { rerender } = render(await page());
    mocks.fetchEventsFeed.mockResolvedValue({
      ok: true,
      value: { ...PAGE, facetOptions: { kind: [{ slug: "webinar", title: "Вебинар", count: 3 }] } },
    });
    await userEvent.click(
      within(screen.getByTestId("events-feed-error")).getByRole("button", { name: "Повторить" }),
    );
    expect(await screen.findByRole("group", { name: "Вид события" })).toBeInTheDocument();

    rerender(await page());
    expect(screen.queryByRole("group", { name: "Вид события" })).toBeNull();
    expect(screen.getByTestId("events-feed-error")).toBeInTheDocument();
  });

  it("EARS-9: a retry in flight keeps «Повторить» readable, marks it busy and ignores a second press", async () => {
    let answer: (block: ReactNode) => void = () => {};
    const retry = vi.fn(
      () =>
        new Promise<ReactNode>((resolve) => {
          answer = resolve;
        }),
    );
    render(
      <BlockRetry retry={retry}>
        <BlockError title="Не удалось" description="Причина" testId="block-error" />
      </BlockRetry>,
    );
    const button = screen.getByRole("button", { name: "Повторить" });
    await userEvent.click(button);
    await vi.waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    // Not the native disabled state — that dims the control near-invisible on
    // the error card; the pending press stays a readable, busy control.
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);

    answer(<p>Блок загружен</p>);
    expect(await screen.findByText("Блок загружен")).toBeInTheDocument();
  });

  it("EARS-9: an action that cannot be reached leaves the block's cause and its «Повторить» in place", async () => {
    const retry = vi.fn(async (): Promise<ReactNode> => {
      throw new Error("offline");
    });
    render(
      <BlockRetry retry={retry}>
        <BlockError title="Не удалось" description="Причина" testId="block-error" />
      </BlockRetry>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(
      within(screen.getByTestId("block-error")).getByRole("button", { name: "Повторить" }),
    ).toBeEnabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
