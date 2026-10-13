// @vitest-environment jsdom
import {
  Fragment,
  Suspense,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  fetchSpecialtyChoices: vi.fn(),
  fetchEventKindTitles: vi.fn(),
  fetchMonthEntries: vi.fn(),
  fetchMonthCounts: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => "/events",
  useSearchParams: () => new URLSearchParams(),
  permanentRedirect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(mocks.cookie ? { cookie: mocks.cookie } : {}),
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  fetchEventsFeed: mocks.fetchEventsFeed,
  fetchEventsLive: mocks.fetchEventsLive,
  fetchMyEvents: mocks.fetchMyEvents,
  fetchSpecialtyChoices: mocks.fetchSpecialtyChoices,
  fetchEventKindTitles: mocks.fetchEventKindTitles,
  fetchMonthEntries: mocks.fetchMonthEntries,
  fetchMonthCounts: mocks.fetchMonthCounts,
}));

import {
  EventsListingPage,
  FacetColumn,
  FacetSheetSection,
} from "./events-listing-page";
import { FeedSection, LiveSection, MyEventsSection } from "./feed-sections";
import { FeedFrame } from "./feed-frame";
import { FeedReadScope } from "./feed-read-scope";
import { LiveBlock } from "./live-block";
import { MonthView } from "./month-view";

const ROUTES = {
  listing: "/events",
  eventPage: "/events",
  login: "/login",
  accountEvents: "/account/events",
};

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
  headerCopy: {
    title: "События",
    subline: "События по вашей специальности и смежным",
  },
  routes: ROUTES,
};

const ACADEMY: EventsStorefrontHostConfig = {
  filterSet: "academy",
  contentSet: {
    feedPath: "/v1/public/events",
    tenseParam: "timeframe",
    livePath: "/v1/public/events/live",
    myEventsPath: "/v1/me/events",
    monthPath: "/v1/public/events",
    countsPath: "/v1/public/events/month-counts",
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
  facetOptions: {},
  matching: 0,
  cards: [CARD],
  today: "2026-10-08",
  horizon: {
    from: "2026-10-08",
    to: "2026-10-22",
    nextTo: "2026-11-05",
    nextFrom: null,
  },
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
const REQUEST = { cookie: "", forwardedFor: "10.0.0.1" };
const NO_SPECIALTIES = Promise.resolve([]);
/** The host's block retry; #2832 pins what it re-reads in `events-block-retry.test.tsx`. */
const RETRY = vi.fn(async (): Promise<ReactNode> => null);
const EMPTY_PAGE: EventsFeedPage = {
  ...PAGE,
  cards: [],
  remaining: 0,
  matching: 0,
};
const NO_KINDS = Promise.resolve([]);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookie = "";
  mocks.fetchMyEvents.mockResolvedValue({ authenticated: false });
  mocks.fetchEventsLive.mockResolvedValue({ ok: true, value: [] });
  mocks.fetchEventsFeed.mockResolvedValue({ ok: true, value: PAGE });
  mocks.fetchSpecialtyChoices.mockResolvedValue([]);
  mocks.fetchEventKindTitles.mockResolvedValue([]);
});

/** The FeedFrame element the one page returns in its feed view, inside the page's feed-read scope (#2832). */
async function frame(
  config: EventsStorefrontHostConfig,
  query: Record<string, string> = {},
) {
  const scope = (await EventsListingPage({
    config,
    searchParams: Promise.resolve(query),
    retry: RETRY,
  })) as ReactElement<{ children: ReactElement<ComponentProps<typeof FeedFrame>> }>;
  expect(scope.type).toBe(FeedReadScope);
  const element = scope.props.children;
  expect(element.type).toBe(FeedFrame);
  return element;
}

/** Every Suspense boundary in the page's own markup, in document order. */
function boundaries(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(boundaries);
  if (!isValidElement(node)) return [];
  if (node.type === Suspense) return [node];
  if (typeof node.type === "string" || node.type === Fragment) {
    return boundaries((node.props as { children?: ReactNode }).children);
  }
  return [];
}

const FEED_BLOCKS: unknown[] = [LiveSection, MyEventsSection, FeedSection];

/** The feed blocks: each Suspense child's component and its fallback test id. */
function blocks(element: ReactElement<{ children: ReactNode }>) {
  return boundaries(element.props.children)
    .map(
      (child) =>
        child.props as { children: ReactElement; fallback: ReactElement },
    )
    .filter(({ children }) => FEED_BLOCKS.includes(children.type))
    .map(({ children, fallback }) => {
      render(fallback);
      const skeleton = screen.getByTestId(/skeleton$/).dataset.testid;
      cleanup();
      return { block: children.type, skeleton };
    });
}

describe("<EventsListingPage> — the feed view of both storefronts", () => {
  it("EARS-7: the kind dictionary is read only while the doctor URL applies a kind", async () => {
    await frame(DOCTOR);
    expect(mocks.fetchEventKindTitles).not.toHaveBeenCalled();
    await frame(DOCTOR, { kind: "master-klass" });
    expect(mocks.fetchEventKindTitles).toHaveBeenCalledTimes(1);
  });

  it("EARS-7: an applied kind no published or retired kind carries is dropped before any read, like an unknown format; a retired one is kept", async () => {
    mocks.fetchEventKindTitles.mockResolvedValue([
      { slug: "master-klass", title: "Мастер-класс" },
    ]);
    await frame(DOCTOR, { kind: "ghost", q: "сон" });
    const [, read] = mocks.fetchEventsFeed.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(read).toEqual({ q: "сон" });

    mocks.fetchEventsFeed.mockClear();
    await frame(DOCTOR, { kind: "master-klass" });
    const [, kept] = mocks.fetchEventsFeed.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(kept).toEqual({ kind: "master-klass" });
  });

  it("EARS-7: a failed kind-dictionary read drops no applied kind", async () => {
    mocks.fetchEventKindTitles.mockResolvedValue(null);
    await frame(DOCTOR, { kind: "master-klass" });
    const [, read] = mocks.fetchEventsFeed.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(read).toEqual({ kind: "master-klass" });
  });

  it("EARS-7: an applied retired kind with no event in this reading is a selected chip under its own title on the panel", async () => {
    render(
      await FacetColumn({
        config: DOCTOR,
        raw: { kind: ["master-klass"] },
        feed: Promise.resolve({ ok: true, value: PAGE }),
        specialties: Promise.resolve([]),
        kinds: Promise.resolve([{ slug: "master-klass", title: "Мастер-класс" }]),
      }),
    );
    const kinds = within(screen.getByRole("group", { name: "Вид события" }));
    expect(kinds.getByRole("button", { name: "Мастер-класс", pressed: true })).toBeInTheDocument();
    expect(screen.queryByText("master-klass")).not.toBeInTheDocument();
    expect(screen.getByText("Применено: 1")).toBeInTheDocument();
  });

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

  it("NEW: the page hands its view to the frame and keeps the URL tense in the month view (#2798)", async () => {
    const feed = (await frame(DOCTOR, { tense: "past" })).props;
    expect(feed).toMatchObject({ view: "feed", tense: "past" });
    const month = (await frame(DOCTOR, { view: "month", tense: "past" })).props;
    expect(month).toMatchObject({ view: "month", tense: "past" });
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
        {await LiveSection({
          config: DOCTOR,
          raw: {},
          session: SESSION,
          request: REQUEST,
        })}
        {await MyEventsSection({ config: DOCTOR, mine, retry: RETRY })}
        {await FeedSection({
          config: DOCTOR,
          query: {},
          feed: Promise.resolve({ ok: false as const }),
          mine,
          specialties: NO_SPECIALTIES,
          kinds: NO_KINDS,
          request: REQUEST,
          retry: RETRY,
        })}
      </>,
    );
    const error = screen.getByTestId("events-feed-error");
    expect(error).toHaveTextContent("Не удалось загрузить ленту событий");
    await userEvent.click(
      within(error).getByRole("button", { name: "Повторить" }),
    );
    // #2832: the retry is the feed block's own, never a refresh of every read.
    expect(RETRY).toHaveBeenCalledWith({
      block: "feed",
      raw: {},
      registeredSlugs: ["m-1"],
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("events-live-block")).toHaveTextContent("Эфир 1");
    expect(screen.getByTestId("events-my-events")).toHaveTextContent(
      "Моё событие",
    );
  });

  it("NEW: «Показать ещё» states the next batch and the remainder and writes the extent to the URL", async () => {
    render(
      await FeedSection({
        config: DOCTOR,
        query: {},
        feed: Promise.resolve({ ok: true as const, value: PAGE }),
        mine: Promise.resolve({ ok: true, value: null }),
        specialties: NO_SPECIALTIES,
        kinds: NO_KINDS,
        request: REQUEST,
        retry: RETRY,
      }),
    );
    const more = screen.getByTestId("events-feed-show-more");
    expect(more).toHaveTextContent("Показать ещё 6 (осталось 57)");
    expect(more).toHaveAttribute(
      "href",
      "/events?from=2026-10-08&to=2026-11-05",
    );
  });

  it("EARS-9: a host that states its subline by scope gets the line of the applied specialty scope (019 LD-9, #2871)", async () => {
    const scoped: EventsStorefrontHostConfig = {
      ...DOCTOR,
      headerCopy: {
        title: "События",
        subline: {
          byScope: {
            mineAndAdjacent: "line-mine",
            all: "line-all",
            picked: "line-picked",
          },
        },
      },
    };
    const lineOf = async (
      query: Record<string, string>,
      defaultScopeEmpty: boolean,
    ) => {
      mocks.fetchEventsFeed.mockResolvedValue({
        ok: true,
        value: { ...PAGE, defaultScopeEmpty },
      });
      const page = await frame(scoped, query);
      const { subline } = page.props as unknown as { subline: ReactElement };
      expect(subline.type).toBe(Suspense);
      const { children } = subline.props as { children: ReactElement };
      render(
        await (children.type as (p: unknown) => Promise<ReactElement>)(
          children.props,
        ),
      );
      const text = screen.getByTestId("events-feed-subline-scope").textContent;
      cleanup();
      return text;
    };
    expect(await lineOf({}, false)).toBe("line-mine");
    expect(await lineOf({}, true)).toBe("line-all");
    expect(await lineOf({ specialty: "all" }, false)).toBe("line-all");
    expect(await lineOf({ specialty: "mine-and-adjacent" }, true)).toBe(
      "line-mine",
    );
    expect(await lineOf({ specialty: "s-1" }, false)).toBe("line-picked");
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
    render(
      await (children.type as (p: unknown) => Promise<ReactElement>)(
        children.props,
      ),
    );
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
      <>
        {await MyEventsSection({
          config: DOCTOR,
          mine: Promise.resolve({ ok: true, value: null }),
          retry: RETRY,
        })}
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the doctor's default «Моя и смежные» is empty (019 EARS-9, LD-9)", () => {
  const FALLBACK_PAGE: EventsFeedPage = { ...PAGE, defaultScopeEmpty: true };
  const panel = (raw: Record<string, string>, page: EventsFeedPage) =>
    FacetColumn({
      config: DOCTOR,
      raw,
      feed: Promise.resolve({ ok: true as const, value: page }),
      specialties: NO_SPECIALTIES,
      kinds: NO_KINDS,
    });

  it("EARS-9: the default feed opens with «Все специальности» selected as this visitor's default — not counted, nothing to reset", async () => {
    render(await panel({}, FALLBACK_PAGE));
    expect(
      screen.getByRole("button", { name: "Все специальности" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Моя и смежные" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/Применено/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Сбросить" })).toBeNull();
  });

  it("EARS-9: under the fall-back a facet beyond the default is counted alone, and «Сбросить» follows it", async () => {
    render(await panel({ format: "online" }, FALLBACK_PAGE));
    expect(
      screen.getByRole("button", { name: "Все специальности" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Применено: 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Сбросить" })).toHaveAttribute(
      "href",
      "/events",
    );
  });

  it("EARS-9: the narrow-screen «Фильтры» trigger does not count the fall-back default", async () => {
    render(
      await FacetSheetSection({
        config: DOCTOR,
        raw: {},
        feed: Promise.resolve({ ok: true as const, value: FALLBACK_PAGE }),
        specialties: NO_SPECIALTIES,
        kinds: NO_KINDS,
      }),
    );
    expect(screen.getByTestId("events-filter-open")).toHaveTextContent(
      /^Фильтры$/,
    );
  });

  it("EARS-9: picking «Моя и смежные» writes it into the URL, so the fall-back does not take it back", async () => {
    render(await panel({}, FALLBACK_PAGE));
    await userEvent.click(
      screen.getByRole("button", { name: "Моя и смежные" }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/events?specialty=mine-and-adjacent",
      { scroll: false },
    );
  });

  it("EARS-9: an explicit «Моя и смежные» narrows this visitor's default — counted 1 with «Сбросить»", async () => {
    render(await panel({ specialty: "mine-and-adjacent" }, FALLBACK_PAGE));
    expect(
      screen.getByRole("button", { name: "Моя и смежные" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Применено: 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Сбросить" })).toHaveAttribute(
      "href",
      "/events",
    );
  });

  it("EARS-9: after picking «Моя и смежные» another facet keeps the scope in the URL", async () => {
    render(await panel({ specialty: "mine-and-adjacent" }, FALLBACK_PAGE));
    await userEvent.click(
      within(screen.getByRole("group", { name: "Формат" })).getByRole(
        "button",
        { name: "Онлайн" },
      ),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/events?format=online&specialty=mine-and-adjacent",
      { scroll: false },
    );
  });

  it("EARS-9: an explicit «Все специальности» is this visitor's default — not counted, and picking it leaves the URL scope-free", async () => {
    render(await panel({ specialty: "all" }, FALLBACK_PAGE));
    expect(
      screen.getByRole("button", { name: "Все специальности" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/Применено/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Сбросить" })).toBeNull();
  });

  it("EARS-9: from «Моя и смежные» back to «Все специальности» returns the default URL", async () => {
    render(await panel({ specialty: "mine-and-adjacent" }, FALLBACK_PAGE));
    await userEvent.click(
      screen.getByRole("button", { name: "Все специальности" }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/events", { scroll: false });
  });

  it("EARS-9: removing the last picked specialty returns this visitor to the default URL, not to a counted «Моя и смежные»", async () => {
    render(await panel({ specialty: "s1" }, FALLBACK_PAGE));
    await userEvent.click(screen.getByRole("button", { name: /^Убрать: / }));
    expect(mocks.push).toHaveBeenCalledWith("/events", { scroll: false });
  });

  it("EARS-9: an explicit scope in the URL wins — «Моя и смежные» stays selected and uncounted", async () => {
    render(
      await panel(
        { specialty: "mine-and-adjacent" },
        { ...PAGE, defaultScopeEmpty: false },
      ),
    );
    expect(
      screen.getByRole("button", { name: "Моя и смежные" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/Применено/)).toBeNull();
  });

  it("EARS-9: the doctor adapter carries the read's fall-back signal onto the page", () => {
    const dto = {
      tense: "upcoming",
      today: "2026-10-08",
      facets: { kind: [], city: [] },
      from: "2026-10-08",
      to: "2026-10-22",
      days: [],
      totalCount: 0,
      nextTo: null,
      nextFrom: null,
      remaining: 0,
      nextBatch: 0,
      targeting: {
        mode: "all",
        specialtyReference: "osteo",
        directionIds: [],
        adjacentDirectionIds: [],
        defaultScopeEmpty: true,
      },
    };
    expect(
      adaptDoctorEventsFeed(dto, { tense: "upcoming" }).defaultScopeEmpty,
    ).toBe(true);
    expect(
      adaptDoctorEventsFeed(
        {
          ...dto,
          targeting: {
            ...dto.targeting,
            mode: "targeted",
            defaultScopeEmpty: false,
          },
        },
        { tense: "upcoming" },
      ).defaultScopeEmpty,
    ).toBe(false);
  });
});

describe("the empty state of both views (019 EARS-9, #2786)", () => {
  const TOPICS = {
    topic: [
      { slug: "biomedical", title: "Медико-биологические науки", count: 0 },
    ],
    project: [{ slug: "golden", title: "Золотая школа", count: 0 }],
  };
  /** The empty block's actions in order, by accessible name and href. */
  const actionsOf = (block: HTMLElement) =>
    within(block)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);

  it("EARS-9: an empty feed names the first facet whose removal finds events, counted by a widen read of the same tense, and offers the widening then «Сбросить фильтры»", async () => {
    mocks.fetchEventsFeed
      .mockResolvedValueOnce({
        ok: true,
        value: { ...EMPTY_PAGE, matching: 0 },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...EMPTY_PAGE, matching: 12 },
      });
    const query = { tense: "past", project: "golden", topic: "biomedical" };
    render(
      await FeedSection({
        config: ACADEMY,
        query,
        feed: Promise.resolve({
          ok: true as const,
          value: { ...EMPTY_PAGE, facetOptions: TOPICS },
        }),
        mine: Promise.resolve({ ok: true, value: null }),
        specialties: NO_SPECIALTIES,
        kinds: NO_KINDS,
        request: REQUEST,
        retry: RETRY,
      }),
    );
    expect(
      mocks.fetchEventsFeed.mock.calls.map(([, raw, request]) => [
        raw,
        request,
      ]),
    ).toEqual([
      [{ ...query, topic: undefined }, REQUEST],
      [{ ...query, project: undefined }, REQUEST],
    ]);
    const empty = screen.getByTestId("events-feed-empty");
    expect(empty).toHaveTextContent(
      "Нет эфиров по фильтру «Проект: Золотая школа»",
    );
    expect(empty).toHaveTextContent("Без этого фильтра найдётся 12 эфиров.");
    expect(actionsOf(empty)).toEqual([
      [
        "Убрать фильтр «Проект: Золотая школа»",
        "/webinars?tense=past&topic=biomedical",
      ],
      ["Сбросить фильтры", "/webinars?tense=past"],
    ]);
  });

  it("EARS-9: an empty doctor feed names a picked specialty by the specialty book «Специальность: <name>»", async () => {
    mocks.fetchEventsFeed.mockResolvedValueOnce({
      ok: true,
      value: { ...EMPTY_PAGE, matching: 3 },
    });
    render(
      await FeedSection({
        config: DOCTOR,
        query: { specialty: "neurology" },
        feed: Promise.resolve({ ok: true as const, value: EMPTY_PAGE }),
        mine: Promise.resolve({ ok: true, value: null }),
        specialties: Promise.resolve([
          { code: "neurology", name: "Неврология" },
        ]),
        kinds: NO_KINDS,
        request: REQUEST,
        retry: RETRY,
      }),
    );
    const empty = screen.getByTestId("events-feed-empty");
    expect(empty).toHaveTextContent(
      "Нет событий по фильтру «Специальность: Неврология»",
    );
    expect(actionsOf(empty)).toEqual([
      ["Показать смежные специальности", "/events"],
      ["Сбросить фильтры", "/events"],
    ]);
  });

  it("EARS-7: an empty doctor feed under a kind the read does not offer (a retired kind with no event in this reading) names it by the kind dictionary, never by its raw slug", async () => {
    mocks.fetchEventsFeed.mockResolvedValueOnce({ ok: true, value: { ...EMPTY_PAGE, matching: 5 } });
    render(
      await FeedSection({
        config: DOCTOR,
        query: { kind: "vebinar" },
        feed: Promise.resolve({ ok: true as const, value: EMPTY_PAGE }),
        mine: Promise.resolve({ ok: true, value: null }),
        specialties: NO_SPECIALTIES,
        kinds: Promise.resolve([{ slug: "vebinar", title: "Вебинар" }]),
        request: REQUEST,
        retry: RETRY,
      }),
    );
    const empty = screen.getByTestId("events-feed-empty");
    expect(empty).toHaveTextContent("Нет событий по фильтру «Вид события: Вебинар»");
    expect(empty).not.toHaveTextContent("vebinar");
  });

  it("EARS-9: a non-empty feed makes no widen read", async () => {
    render(
      await FeedSection({
        config: DOCTOR,
        query: { format: "offline" },
        feed: Promise.resolve({ ok: true as const, value: PAGE }),
        mine: Promise.resolve({ ok: true, value: null }),
        specialties: NO_SPECIALTIES,
        kinds: NO_KINDS,
        request: REQUEST,
        retry: RETRY,
      }),
    );
    expect(mocks.fetchEventsFeed).not.toHaveBeenCalled();
  });

  it("EARS-9: an empty month names the facet by its title and counts the tense's whole reach (#2786)", async () => {
    mocks.fetchMonthEntries.mockResolvedValue({ ok: true, value: [] });
    mocks.fetchMonthCounts.mockResolvedValue({ ok: true, value: [] });
    mocks.fetchEventsFeed.mockResolvedValueOnce({
      ok: true,
      value: { ...EMPTY_PAGE, matching: 1 },
    });
    const raw = { view: "month", topic: "biomedical" };
    render(
      await MonthView({
        config: ACADEMY,
        raw,
        month: "2026-10",
        feed: Promise.resolve({
          ok: true as const,
          value: { ...EMPTY_PAGE, facetOptions: TOPICS },
        }),
        specialties: NO_SPECIALTIES,
        kinds: NO_KINDS,
        request: REQUEST,
        retry: RETRY,
      }),
    );
    expect(mocks.fetchEventsFeed).toHaveBeenCalledWith(
      ACADEMY,
      { ...raw, topic: undefined },
      REQUEST,
    );
    const empty = screen.getByTestId("events-month-empty");
    expect(empty).toHaveTextContent(
      "Нет эфиров по фильтру «Тема: Медико-биологические науки»",
    );
    expect(empty).toHaveTextContent("Без этого фильтра найдётся 1 эфир.");
    expect(actionsOf(empty)).toEqual([
      ["Показать все темы", "/webinars?view=month"],
      ["Сбросить фильтры", "/webinars?view=month"],
    ]);
  });

  it.each([
    ["finds nothing", { ok: true, value: { ...EMPTY_PAGE, matching: 0 } }],
    ["fails", { ok: false }],
  ])(
    "EARS-9: an empty month whose every widen read %s offers no widening, only «Сбросить фильтры» (#2786)",
    async (_case, widenRead) => {
      mocks.fetchMonthEntries.mockResolvedValue({ ok: true, value: [] });
      mocks.fetchMonthCounts.mockResolvedValue({ ok: true, value: [] });
      mocks.fetchEventsFeed.mockResolvedValue(widenRead);
      render(
        await MonthView({
          config: DOCTOR,
          raw: { view: "month", kind: "lecture" },
          month: "2026-10",
          feed: Promise.resolve({ ok: true as const, value: EMPTY_PAGE }),
          specialties: NO_SPECIALTIES,
          kinds: NO_KINDS,
          request: REQUEST,
          retry: RETRY,
        }),
      );
      const empty = screen.getByTestId("events-month-empty");
      expect(empty).toHaveTextContent("По выбранным фильтрам событий нет");
      expect(actionsOf(empty)).toEqual([
        ["Сбросить фильтры", "/events?view=month"],
      ]);
    },
  );
});

describe("<FeedFrame> — the head", () => {
  function renderFrame(
    tense: "upcoming" | "past" = "upcoming",
    view: "feed" | "month" = "feed",
    headAction?: ReactNode,
  ) {
    return render(
      <FeedFrame
        title="События"
        subline="События по вашей специальности и смежным"
        tense={tense}
        view={view}
        hrefs={{ upcoming: "/events", past: "/events?tense=past" }}
        headAction={headAction}
      >
        <p>лента</p>
      </FeedFrame>,
    );
  }

  it("NEW: host header copy renders title + subline on each host", () => {
    renderFrame();
    expect(
      screen.getByRole("heading", { level: 1, name: "События" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("События по вашей специальности и смежным"),
    ).toBeInTheDocument();
  });

  it("NEW: the head carries the tense tabs «Прошедшие | Будущие» with «Будущие» selected by default and writes tense=past to the URL", async () => {
    renderFrame();
    const tabs = within(screen.getByTestId("events-tense-tabs")).getAllByRole(
      "tab",
    );
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Прошедшие",
      "Будущие",
    ]);
    expect(screen.getByRole("tab", { name: "Будущие" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(screen.getByRole("tab", { name: "Прошедшие" }));
    expect(mocks.push).toHaveBeenCalledWith("/events?tense=past");
  });

  it("NEW: the month view carries no tense tabs; the tense stays the URL's and the content stays keyed by it (#2798)", () => {
    renderFrame(
      "past",
      "month",
      <a href="/events?tense=past">← Лента событий</a>,
    );
    expect(screen.queryByTestId("events-tense-tabs")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    // No tabs ⇒ no tab panel: no orphan `tabpanel` labelled by a missing tab.
    expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
    expect(screen.getByText("лента")).toBeInTheDocument();
    // The head row holds only the view link, right-aligned, desktop-only.
    const row = screen.getByTestId("events-head-row");
    expect(row).toHaveClass("hidden", "lg:flex", "justify-end");
    expect(
      within(row).getByRole("link", { name: "← Лента событий" }),
    ).toBeInTheDocument();
  });

  it("NEW: the feed view keeps the head row with the tense tabs on every width (#2798)", () => {
    renderFrame("upcoming", "feed");
    const row = screen.getByTestId("events-head-row");
    expect(row).not.toHaveClass("hidden");
    expect(within(row).getByTestId("events-tense-tabs")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("лента");
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
      .mockResolvedValue(
        new Response(JSON.stringify([strip(1)]), { status: 200 }),
      );
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

  it("019 EARS-6: the server render and the refresh read the SAME applied scope (#2907)", async () => {
    mocks.fetchEventsLive.mockResolvedValue({ ok: true, value: [strip(1)] });
    const element = (await LiveSection({
      config: DOCTOR,
      raw: { specialty: "all", format: "online" },
      session: SESSION,
      request: REQUEST,
    })) as ReactElement<{ livePath: string }>;
    const scoped = "/v1/storefront/doctor/events/live?specialty=all";
    expect(mocks.fetchEventsLive).toHaveBeenCalledWith(
      scoped,
      DOCTOR,
      SESSION,
      REQUEST,
    );
    expect(element.props.livePath).toBe(scoped);
    // Keyed by the scope: a scope toggle re-mounts the block on the new scope.
    expect(element.key).toBe(scoped);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("[]", { status: 200 }));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render(element);
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        scoped,
        expect.objectContaining({ credentials: "include" }),
      ),
    );
    fetchSpy.mockRestore();
  });

  it("019 EARS-6: the default scope states no query, so the strip reads «моя и смежные» like the feed", async () => {
    await LiveSection({ config: DOCTOR, raw: {}, session: SESSION, request: REQUEST });
    expect(mocks.fetchEventsLive.mock.calls[0]?.[0]).toBe(
      "/v1/storefront/doctor/events/live",
    );
  });

  it("019 EARS-6: a new server answer re-syncs the mounted strip without a reload", () => {
    const { rerender } = render(
      <LiveBlock
        initial={{ ok: true, value: [strip(1)] }}
        livePath="/v1/storefront/doctor/events/live?specialty=all"
        routes={ROUTES}
      />,
    );
    expect(screen.getByTestId("events-live-block")).toHaveTextContent("Эфир 1");
    rerender(
      <LiveBlock
        initial={{ ok: true, value: [] }}
        livePath="/v1/storefront/doctor/events/live?specialty=all"
        routes={ROUTES}
      />,
    );
    expect(screen.queryByTestId("events-live-block")).toBeNull();
  });

  it("019 EARS-6: nothing live ⇒ no block in the tree", () => {
    const { container } = render(
      <LiveBlock
        initial={{ ok: true, value: [] }}
        livePath="/x"
        routes={ROUTES}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
