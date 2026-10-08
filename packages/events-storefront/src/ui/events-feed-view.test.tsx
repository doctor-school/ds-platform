// @vitest-environment jsdom
import { Suspense, isValidElement, type ReactElement, type ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adaptDoctorEventsFeed, adaptPublicEventListing } from "../adapters";
import type { EventsStorefrontHostConfig } from "../host-config";
import type { EventsFeedCard, EventsFeedPage } from "../model/feed";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  cookie: "",
  fetchEventsFeed: vi.fn(),
  fetchEventsLive: vi.fn(),
  fetchMyEvents: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => "/events",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mocks.cookie ? { cookie: mocks.cookie } : {}),
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  fetchEventsFeed: mocks.fetchEventsFeed,
  fetchEventsLive: mocks.fetchEventsLive,
  fetchMyEvents: mocks.fetchMyEvents,
}));

import {
  EventsFeedView,
  FeedSection,
  LiveSection,
  MyEventsSection,
} from "./events-feed-view";
import { FeedFrame } from "./feed-frame";
import { LiveBlock } from "./live-block";

const ROUTES = {
  listing: "/events",
  eventPage: "/events",
  login: "/login",
  accountEvents: "/account/events",
};

const DOCTOR: EventsStorefrontHostConfig = {
  contentSet: {
    feedPath: "/v1/storefront/doctor/events",
    tenseParam: "tense",
    relayCookie: "__Host-ds_specialty",
    livePath: "/v1/storefront/doctor/events/live",
    myEventsPath: "/v1/storefront/doctor/me/events",
    adapt: adaptDoctorEventsFeed,
  },
  headerCopy: {
    title: "События",
    subline: "События по вашей специальности и смежным",
  },
  routes: ROUTES,
};

const ACADEMY: EventsStorefrontHostConfig = {
  contentSet: {
    feedPath: "/v1/public/events",
    tenseParam: "timeframe",
    livePath: "/v1/public/events/live",
    myEventsPath: "/v1/me/events",
    adapt: adaptPublicEventListing,
  },
  headerCopy: {
    title: "Расписание эфиров",
    subline: { schoolNoun: { one: "школа", few: "школы", many: "школ" } },
  },
  copy: { eventNoun: { one: "эфир", few: "эфира", many: "эфиров" } },
  routes: { ...ROUTES, listing: "/webinars", eventPage: "/webinars" },
};

const CARD: EventsFeedCard = {
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
};

const PAGE: EventsFeedPage = {
  cards: [CARD],
  horizon: { from: "2026-10-08", to: "2026-10-22", nextTo: "2026-11-05", nextFrom: null },
  remaining: 57,
  nextBatch: 6,
};

const strip = (n: number) => ({
  eventId: `ev-${n}`,
  slug: `live-${n}`,
  title: `Эфир ${n}`,
  school: "Школа",
  href: `/events/live-${n}`,
  endsAt: "2026-10-20T17:00:00.000Z",
  presenceCount: 12,
  viewerIsRegistered: false,
});

const SESSION = { cookie: "", forwardedFor: "" } as never;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookie = "";
  mocks.fetchMyEvents.mockResolvedValue({ authenticated: false });
  mocks.fetchEventsLive.mockResolvedValue({ ok: true, value: [] });
  mocks.fetchEventsFeed.mockResolvedValue({ ok: true, value: PAGE });
});

/** The FeedFrame element `EventsFeedView` returns, with its block children. */
async function frame(
  config: EventsStorefrontHostConfig,
  query: Record<string, string> = {},
) {
  const element = (await EventsFeedView({ config, query })) as ReactElement<{
    children: ReactNode[];
  }>;
  expect(element.type).toBe(FeedFrame);
  return element;
}

/** Each rendered block: its Suspense child's component and fallback test id. */
function blocks(element: ReactElement<{ children: ReactNode[] }>) {
  return element.props.children
    .filter((child): child is ReactElement => isValidElement(child))
    .map((child) => {
      expect(child.type).toBe(Suspense);
      const { children, fallback } = child.props as {
        children: ReactElement;
        fallback: ReactElement;
      };
      render(fallback);
      const skeleton = screen.getByTestId(/skeleton$/).dataset.testid;
      cleanup();
      return { block: children.type, skeleton };
    });
}

describe("<EventsFeedView> — the feed view of both storefronts", () => {
  it.each([
    ["doctor", DOCTOR],
    ["Academy", ACADEMY],
  ])(
    "NEW: block order per host (%s) — head with tense tabs → «Идёт сейчас» → «Мои события» → day feed; each block streams behind its own skeleton",
    async (_host, config) => {
      mocks.cookie = "__Host-ds_session=s";
      const element = await frame(config);
      expect(blocks(element)).toEqual([
        { block: LiveSection, skeleton: "events-live-skeleton" },
        { block: MyEventsSection, skeleton: "events-my-events-skeleton" },
        { block: FeedSection, skeleton: "events-feed-skeleton" },
      ]);
    },
  );

  it("NEW: a guest feed renders no account band and every block of a signed-in reader except «Мои события»", async () => {
    const element = await frame(DOCTOR);
    expect(blocks(element).map((b) => b.block)).toEqual([
      LiveSection,
      FeedSection,
    ]);
  });

  it("NEW: «Прошедшие» renders the feed only — the live block and «Мои события» belong to «Будущие»", async () => {
    mocks.cookie = "__Host-ds_session=s";
    const element = await frame(DOCTOR, { tense: "past" });
    expect(blocks(element).map((b) => b.block)).toEqual([FeedSection]);
  });

  it("NEW: feed read fails ⇒ the feed block shows the cause + «Повторить», the live block and «Мои события» still render", async () => {
    mocks.fetchEventsFeed.mockResolvedValue({ ok: false });
    mocks.fetchEventsLive.mockResolvedValue({ ok: true, value: [strip(1)] });
    const mine = Promise.resolve({
      ok: true as const,
      value: [
        {
          slug: "m-1",
          title: "Моё событие",
          school: "Школа",
          startsAt: "2099-10-20T16:00:00.000Z",
          format: "online",
          state: "upcoming",
        },
      ] as never,
    });
    render(
      <>
        {await LiveSection({ config: DOCTOR, session: SESSION })}
        {await MyEventsSection({ config: DOCTOR, mine })}
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: Promise.resolve({ ok: false as const }),
          mine,
        })}
      </>,
    );
    const error = screen.getByTestId("events-feed-error");
    expect(error).toHaveTextContent("Не удалось загрузить ленту событий");
    await userEvent.click(within(error).getByRole("button", { name: "Повторить" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("events-live-block")).toHaveTextContent("Эфир 1");
    expect(screen.getByTestId("events-my-events")).toHaveTextContent("Моё событие");
  });

  it("NEW: «Показать ещё» states the next batch and the remainder and writes the extent to the URL", async () => {
    render(
      await FeedSection({
        config: DOCTOR,
        query: {},
        feed: Promise.resolve({ ok: true as const, value: PAGE }),
        mine: Promise.resolve({ ok: true, value: null }),
      }),
    );
    const more = screen.getByTestId("events-feed-show-more");
    expect(more).toHaveTextContent("Показать ещё 6 из 57");
    expect(more).toHaveAttribute("href", "/events?from=2026-10-08&to=2026-11-05");
  });

  it("019 row 19: the Academy head subline counts the upcoming эфиры and their schools «N эфиров · M школ»; the doctor head keeps its copy", async () => {
    mocks.fetchEventsFeed.mockResolvedValue({
      ok: true,
      value: { ...PAGE, summary: { events: 21, schools: 3 } },
    });
    const academy = await frame(ACADEMY);
    const { subline } = academy.props as unknown as { subline: ReactElement };
    expect(subline.type).toBe(Suspense);
    const { children } = subline.props as { children: ReactElement };
    render(await (children.type as (p: unknown) => Promise<ReactElement>)(children.props));
    expect(screen.getByTestId("events-feed-subline-counts")).toHaveTextContent(
      "21 эфир · 3 школы",
    );
    cleanup();

    const doctor = await frame(DOCTOR);
    expect((doctor.props as unknown as { subline: unknown }).subline).toBe(
      "События по вашей специальности и смежным",
    );
  });

  it("NEW: a guest gets no «Мои события» block even when its read answers", async () => {
    const { container } = render(
      <>{await MyEventsSection({ config: DOCTOR, mine: Promise.resolve({ ok: true, value: null }) })}</>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("<FeedFrame> — the head", () => {
  function renderFrame(tense: "upcoming" | "past" = "upcoming") {
    return render(
      <FeedFrame
        title="События"
        subline="События по вашей специальности и смежным"
        tense={tense}
        hrefs={{ upcoming: "/events", past: "/events?tense=past" }}
      >
        <p>лента</p>
      </FeedFrame>,
    );
  }

  it("NEW: host header copy renders title + subline on each host", () => {
    renderFrame();
    expect(screen.getByRole("heading", { level: 1, name: "События" })).toBeInTheDocument();
    expect(screen.getByText("События по вашей специальности и смежным")).toBeInTheDocument();
  });

  it("NEW: the head carries the tense tabs «Прошедшие | Будущие» with «Будущие» selected by default and writes tense=past to the URL", async () => {
    renderFrame();
    const tabs = within(screen.getByTestId("events-tense-tabs")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Прошедшие", "Будущие"]);
    expect(screen.getByRole("tab", { name: "Будущие" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Прошедшие" }));
    expect(mocks.push).toHaveBeenCalledWith("/events?tense=past");
  });

  it("NEW: no archive subtitle, tab or «Архив записей» block renders on either host", () => {
    renderFrame("past");
    expect(screen.queryByText(/Архив/)).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});

describe("<LiveBlock> — «Идёт сейчас» (gate rows 43–44)", () => {
  it("NEW: 3 live ⇒ 2 strips + «Ещё 1 в эфире →»", () => {
    render(
      <LiveBlock
        initial={{ ok: true, value: [strip(1), strip(2), strip(3)] }}
        livePath="/v1/storefront/doctor/events/live"
        routes={ROUTES}
      />,
    );
    const block = screen.getByTestId("events-live-block");
    expect(within(block).getByText("Эфир 1")).toBeInTheDocument();
    expect(within(block).getByText("Эфир 2")).toBeInTheDocument();
    expect(within(block).queryByText("Эфир 3")).toBeNull();
    expect(within(block).getByText("Ещё 1 в эфире →")).toBeInTheDocument();
  });

  it("NEW: read failed ⇒ the error line + retry, which re-reads the live path", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([strip(1)]), { status: 200 }));
    render(
      <LiveBlock
        initial={{ ok: false }}
        livePath="/v1/storefront/doctor/events/live"
        routes={ROUTES}
      />,
    );
    expect(screen.getByTestId("events-live-error")).toHaveTextContent(
      "Не удалось проверить, что сейчас в эфире",
    );
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/v1/storefront/doctor/events/live",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(await screen.findByText("Эфир 1")).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("019 EARS-6: nothing live ⇒ no block in the tree", () => {
    const { container } = render(
      <LiveBlock initial={{ ok: true, value: [] }} livePath="/x" routes={ROUTES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
