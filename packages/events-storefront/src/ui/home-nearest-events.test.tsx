import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { EventsStorefrontHostConfig } from "../host-config";
import type { BlockRead, EventsFeedCard, EventsFeedPage } from "../model/feed";

const { fetchNearestEvents } = vi.hoisted(() => ({
  fetchNearestEvents: vi.fn(() => new Promise(() => {})),
}));

vi.mock("next/navigation", () => ({ permanentRedirect: vi.fn(), useRouter: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_specialty=kardiologiya" }),
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  fetchNearestEvents,
}));

import { BlockError } from "./block-error";
import { CompactMonthSection } from "./events-listing-page";
import { HomeNearestEvents, NearestEventsBody, NearestEventsSkeleton } from "./home-nearest-events";
import { NearestEventCards } from "./nearest-event-cards";

const CONFIG = {
  filterSet: "doctor",
  headerCopy: { title: "События", subline: "События" },
  contentSet: {
    feedPath: "/v1/storefront/doctor/events",
    tenseParam: "tense",
    relayCookie: "__Host-ds_specialty",
    livePath: "/v1/storefront/doctor/events/live",
    myEventsPath: "/v1/storefront/doctor/me/events",
    monthPath: "/v1/storefront/doctor/events/month",
    countsPath: "/v1/storefront/doctor/events/month-counts",
    adapt: () => { throw new Error("unused"); },
  },
  routes: { listing: "/events", eventPage: "/events", login: "/login", accountEvents: "/account/events" },
} satisfies EventsStorefrontHostConfig;

type AnyElement = ReactElement<Record<string, unknown>>;

function elementsOf(node: ReactNode): AnyElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  const nested = Object.values(element.props).flatMap((value) =>
    isValidElement(value) || Array.isArray(value) ? elementsOf(value as ReactNode) : [],
  );
  return [element, ...nested];
}

const card = (id: string): EventsFeedCard => ({
  id, slug: id, startsAt: "2026-09-02T09:00:00.000Z", format: "online", kindTitle: "Вебинар",
  title: id, school: "Doctor.School", speakers: [], state: "upcoming", signUpCount: 0, recording: null,
});

function page(cards: EventsFeedCard[], targeting?: EventsFeedPage["targeting"]): BlockRead<EventsFeedPage> {
  return {
    ok: true,
    value: {
      today: "2026-09-01", cards, remaining: 0, nextBatch: 0, facetOptions: {}, matching: cards.length,
      horizon: { from: "2026-09-01", to: "2026-09-15", nextTo: null, nextFrom: null },
      ...(targeting ? { targeting } : {}),
    },
  };
}

async function body(nearest: BlockRead<EventsFeedPage>, window = nearest) {
  return elementsOf(
    (await NearestEventsBody({
      config: CONFIG,
      read: Promise.resolve({ window, nearest }),
      request: { cookie: "", forwardedFor: "" },
    })) as ReactNode,
  );
}

const textOf = (els: AnyElement[]) =>
  els.flatMap((el) => Object.values(el.props).filter((v) => typeof v === "string")).join(" | ");

describe("HomeNearestEvents", () => {
  it("017 EARS-9: the block reads the host's feed with the relayed cookie and streams behind card skeletons, the «Все события» link into the events page", async () => {
    const els = elementsOf((await HomeNearestEvents({ config: CONFIG })) as ReactNode);
    const [config, request] = fetchNearestEvents.mock.calls[0] as unknown as [unknown, { cookie: string }];
    expect(config).toBe(CONFIG);
    expect(request.cookie).toBe("__Host-ds_specialty=kardiologiya");
    expect(textOf(els)).toContain("Ближайшие события");
    const all = els.find((el) => el.props["data-testid"] === "home-events-all");
    expect(all?.props.href).toBe("/events");
    expect(els.some((el) => el.type === NearestEventsSkeleton)).toBe(true);
  });

  it("017 EARS-9: a read with events renders the shared cards beside the compact month over the default window", async () => {
    const window = page([], { mode: "all", adjacentDirectionIds: [] });
    const els = await body(page(["a", "b", "c", "d"].map(card)), window);
    const cards = els.find((el) => el.type === NearestEventCards);
    expect((cards?.props.cards as EventsFeedCard[]).map((c) => c.id)).toEqual(["a", "b", "c"]);
    const month = els.find((el) => el.type === CompactMonthSection);
    expect(month?.props.raw).toEqual({});
    expect(await (month?.props.feed as Promise<unknown>)).toBe(window);
    expect(els.some((el) => el.props["data-testid"] === "home-events-empty")).toBe(false);
  });

  it("017 EARS-9: a targeted empty read states it and links adjacent areas only when adjacentDirections is non-empty", async () => {
    const withAdjacent = await body(page([], { mode: "targeted", adjacentDirectionIds: ["adj"] }));
    expect(textOf(withAdjacent)).toContain("Пока ничего не запланировано по вашей специальности");
    const link = withAdjacent.find((el) => el.props["data-testid"] === "home-events-adjacent");
    expect(link?.props.href).toBe("/events");
    expect(withAdjacent.some((el) => el.type === CompactMonthSection)).toBe(false);

    const alone = await body(page([], { mode: "targeted", adjacentDirectionIds: [] }));
    expect(textOf(alone)).toContain("Пока ничего не запланировано по вашей специальности");
    expect(alone.some((el) => el.props["data-testid"] === "home-events-adjacent")).toBe(false);
  });

  it("017 EARS-9: a «Другое» choice serves the general selection and says so (LD-5)", async () => {
    const els = await body(page([card("a")], { mode: "general", adjacentDirectionIds: [] }));
    expect(textOf(els)).toContain("Показываем общую подборку");
  });

  it("017 EARS-9: a failed read renders the Russian cause with «Обновить», whose retry re-issues the read", async () => {
    const els = await body({ ok: false });
    const error = els.find((el) => el.type === BlockError);
    expect(error?.props.title).toBe("Не удалось загрузить события.");
    expect(error?.props.retryLabel).toBe("Обновить");
    // No own `onRetry`: the retry re-runs the server render (router.refresh).
    expect(error?.props.onRetry).toBeUndefined();
  });
});
