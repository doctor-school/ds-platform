import { describe, expect, it } from "vitest";

import { FEED_COPY } from "../copy/feed-copy";
import {
  type EventsFeedCard,
  buildFeedItems,
  emptyFeedState,
  liveStripView,
  myEventsCut,
  showMoreLabel,
} from "./feed";

const ROUTES = { eventPage: "/events" };

function card(patch: Partial<EventsFeedCard> = {}): EventsFeedCard {
  return {
    id: "e-1",
    slug: "slug-1",
    startsAt: "2026-10-20T16:00:00.000Z",
    format: "online",
    kindTitle: "Вебинар",
    title: "Сердечная недостаточность",
    school: "Школа кардиологии",
    speakers: ["Иванов И. И."],
    state: "upcoming",
    signUpCount: 47,
    recording: null,
    ...patch,
  };
}

function build(
  cards: readonly EventsFeedCard[],
  patch: Partial<Parameters<typeof buildFeedItems>[1]> = {},
) {
  return buildFeedItems(cards, {
    tense: "upcoming",
    viewerZone: "Europe/Moscow",
    registeredSlugs: new Set(),
    routes: ROUTES,
    copy: FEED_COPY,
    ...patch,
  });
}

describe("buildFeedItems — the one card projection of both hosts", () => {
  it("019 EARS-17: names the kind and the format as two labels, a long kind title included", () => {
    const long = "Междисциплинарная клинико-практическая конференция с разбором";
    const [item] = build([card({ kindTitle: long, format: "hybrid" })]);
    expect(item?.kindLabel).toBe(long);
    expect(item?.formatLabel).toBe("Гибрид");
  });

  it("NEW: pulCost 0 ⇒ no cost line and no «бесплатно»; 250 ⇒ «250 Pul»", () => {
    const [free, paid] = build([
      card({ id: "a", pulCost: 0 }),
      card({ id: "b", pulCost: 250 }),
    ]);
    expect(free?.pulCost).toBeUndefined();
    expect(free?.pulCostLabel).toBeUndefined();
    expect(free?.freeLabel).toBeUndefined();
    expect(JSON.stringify(free)).not.toContain("бесплатно");
    expect(paid?.pulCost).toBe(250);
    expect(paid?.pulCostLabel).toBe("250 Pul");
  });

  it("NEW: the card renders «Коллег записались: N» on upcoming and live cards, none on a past card", () => {
    const [upcoming, live] = build([
      card({ id: "a", signUpCount: 128 }),
      card({ id: "b", state: "live", signUpCount: 3 }),
    ]);
    expect(upcoming?.signUpCount).toBe(128);
    expect(upcoming?.signUpLabel).toBe("Коллег записались");
    expect(live?.signUpCount).toBe(3);
    const [past] = build([card({ state: "past", signUpCount: 9 })], {
      tense: "past",
    });
    expect(past?.signUpCount).toBeUndefined();
    expect(past?.signUpLabel).toBeUndefined();
  });

  it("NEW: absent nmo / city / seats ⇒ no chip; seatsLeft 0 ⇒ «мест не осталось»", () => {
    const [bare, full] = build([
      card({ id: "a" }),
      card({ id: "b", nmo: true, city: "Казань", seatsLeft: 0 }),
    ]);
    expect(bare?.nmoLabel).toBeUndefined();
    expect(bare?.city).toBeUndefined();
    expect(bare?.seatsLeft).toBeUndefined();
    expect(full?.nmoLabel).toBe("НМО");
    expect(full?.city).toBe("Казань");
    expect(full?.seatsLeft).toBe(0);
    expect(full?.soldOutLabel).toBe("мест не осталось");
  });

  it("NEW: an upcoming card on either host is one labelled link to its event page and renders no action", () => {
    const [item] = build([card()]);
    expect(item?.href).toBe("/events/slug-1");
    expect(item?.ctaHref).toBeUndefined();
    expect(item?.ctaLabel).toBeUndefined();
  });

  it("NEW: a live event's card reads «В эфире» on both hosts", () => {
    const [item] = build([card({ state: "live" })]);
    expect(item?.live).toBe(true);
    expect(item?.liveLabel).toBe("В эфире");
  });

  it("NEW: a registered viewer sees «Вы записаны» on exactly the registered card", () => {
    const items = build([card({ id: "a", slug: "mine" }), card({ id: "b" })], {
      registeredSlugs: new Set(["mine"]),
    });
    expect(items[0]?.registered).toBe(true);
    expect(items[0]?.registeredLabel).toBe("Вы записаны");
    expect(items[1]?.registered).toBe(false);
  });

  it("NEW: the past card offers «Смотреть запись» and lists no materials", () => {
    const [item] = build(
      [
        card({
          state: "past",
          recording: {
            state: "montage",
            primaryKind: "edited",
            secondaryKind: null,
            posterUrl: null,
            expectedBy: null,
          } as EventsFeedCard["recording"],
        }),
      ],
      { tense: "past" },
    );
    expect(item?.variant).toBe("past");
    expect(item?.ctaLabel).toBe("Смотреть запись");
    expect(item?.ctaHref).toBe("/events/slug-1");
    expect(JSON.stringify(item)).not.toMatch(/материал/i);
  });

  it("NEW: doctor host — an ended event without a published cut renders no recording action", () => {
    const [none, preparing] = build(
      [
        card({ id: "a", state: "past", recording: null }),
        card({
          id: "b",
          state: "past",
          recording: {
            state: "preparing",
            primaryKind: null,
            secondaryKind: null,
            posterUrl: null,
            expectedBy: "2026-10-20T00:00:00.000Z",
          } as EventsFeedCard["recording"],
        }),
      ],
      { tense: "past" },
    );
    expect(none?.ctaLabel).toBeUndefined();
    expect(none?.ctaHref).toBeUndefined();
    expect(preparing?.ctaLabel).toBeUndefined();
    expect(preparing?.recordingLabel).toBe("Запись готовится");
  });

  it("NEW: the past card renders no discussion link or control", () => {
    const [item] = build([card({ state: "past" })], { tense: "past" });
    expect(JSON.stringify(item)).not.toMatch(/обсужд/i);
  });

  it("NEW: past items group under «<month> <year>» newest first", () => {
    const items = build(
      [
        card({ id: "sep", state: "past", startsAt: "2026-09-10T10:00:00.000Z" }),
        card({ id: "aug", state: "past", startsAt: "2026-08-05T10:00:00.000Z" }),
      ],
      { tense: "past" },
    );
    expect(items.map((i) => i.groupLabel)).toEqual([
      "Сентябрь 2026",
      "Август 2026",
    ]);
    expect(items.map((i) => i.groupKey)).toEqual(["2026-09", "2026-08"]);
  });

  it("NEW: an online event at 23:30 МСК groups under the next day for a GMT+5 viewer; an offline event keeps its Moscow day", () => {
    const at = "2026-10-20T20:30:00.000Z"; // 23:30 МСК, 01:30 GMT+5 next day
    const [online, offline] = build(
      [
        card({ id: "on", startsAt: at, format: "online" }),
        card({ id: "off", startsAt: at, format: "offline" }),
      ],
      { viewerZone: "Asia/Yekaterinburg" },
    );
    expect(online?.groupKey).toBe("2026-10-21");
    expect(online?.time).toBe("01:30");
    expect(online?.tzLabel).toBe("GMT+5");
    expect(offline?.groupKey).toBe("2026-10-20");
    expect(offline?.time).toBe("23:30");
    expect(offline?.tzLabel).toBe("МСК");
  });

  it("NEW: hybrid with a venue zone ⇒ «На площадке HH:MM <zone>»; without ⇒ no line", () => {
    const [withZone, without] = build([
      card({ id: "a", format: "hybrid", venueZone: "Asia/Yekaterinburg" }),
      card({ id: "b", format: "hybrid" }),
    ]);
    expect(withZone?.venueTimeLabel).toBe("На площадке 21:00 GMT+5");
    expect(without?.venueTimeLabel).toBeUndefined();
  });
});

describe("showMoreLabel", () => {
  it("NEW: «Показать ещё» states the next batch and the remainder", () => {
    expect(showMoreLabel(57, FEED_COPY)).toBe("Показать ещё 20 из 57");
    expect(showMoreLabel(3, FEED_COPY)).toBe("Показать ещё 3 из 3");
    expect(showMoreLabel(null, FEED_COPY)).toBe("Показать ещё");
  });
});

describe("liveStripView — 019 EARS-6 «Идёт сейчас»", () => {
  const strip = (n: number, registered = false) => ({
    eventId: `ev-${n}`,
    slug: `live-${n}`,
    title: `Эфир ${n}`,
    school: "Школа",
    href: registered ? `/events/live-${n}/room` : `/events/live-${n}`,
    endsAt: "2026-10-20T17:00:00.000Z",
    presenceCount: 12,
    viewerIsRegistered: registered,
  });

  it("NEW: 3 live ⇒ 2 strips + «Ещё 1 в эфире →»", () => {
    const view = liveStripView([strip(1), strip(2), strip(3)], {
      viewerZone: "Europe/Moscow",
      routes: ROUTES,
      copy: FEED_COPY,
    });
    expect(view.strips).toHaveLength(2);
    expect(view.strips.map((s) => s.title)).toEqual(["Эфир 1", "Эфир 2"]);
    expect(view.moreLabel).toBe("Ещё 1 в эфире →");
  });

  it("the strip paints the server's href; it never decides it", () => {
    const view = liveStripView([strip(1, true), strip(2)], {
      viewerZone: "Europe/Moscow",
      routes: ROUTES,
      copy: FEED_COPY,
    });
    expect(view.strips[0]?.actionHref).toBe("/events/live-1/room");
    expect(view.strips[0]?.actionLabel).toBe("Войти в комнату эфира");
    expect(view.strips[1]?.actionHref).toBe("/events/live-2");
    expect(view.strips[1]?.actionLabel).toBe("Открыть страницу события");
    expect(view.strips[0]?.titleHref).toBe("/events/live-1");
    expect(view.strips[0]?.liveLabel).toBe("Идёт сейчас");
    expect(view.strips[0]?.meta).toBe("12 в комнате · Школа · до 20:00 МСК");
    expect(view.moreLabel).toBeNull();
  });
});

describe("myEventsCut — 019 EARS-11", () => {
  const row = (n: number, startsAt: string, state = "upcoming") => ({
    eventId: `00000000-0000-4000-8000-00000000000${n}`,
    slug: `mine-${n}`,
    title: `Моё ${n}`,
    school: "Школа",
    startsAt,
    state,
    recording: null,
    participationFormat: "online" as const,
    roomHref: null,
  });

  it("NEW: 4 registrations ⇒ 3 rows nearest first, live excluded; 0 ⇒ no block", () => {
    const rows = myEventsCut(
      [
        row(4, "2026-10-25T10:00:00.000Z"),
        row(1, "2026-10-21T10:00:00.000Z"),
        row(9, "2026-10-20T10:00:00.000Z", "live"),
        row(3, "2026-10-23T10:00:00.000Z"),
        row(2, "2026-10-22T10:00:00.000Z"),
      ] as never,
      { viewerZone: "Europe/Moscow", routes: ROUTES, copy: FEED_COPY },
    );
    expect(rows.map((r) => r.title)).toEqual(["Моё 1", "Моё 2", "Моё 3"]);
    expect(rows[0]?.href).toBe("/events/mine-1");
    expect(rows[0]?.time).toBe("13:00 МСК");
    expect(myEventsCut([], {
      viewerZone: "Europe/Moscow",
      routes: ROUTES,
      copy: FEED_COPY,
    })).toEqual([]);
  });
});

describe("emptyFeedState — 019 EARS-9, LD-9", () => {
  it("NEW: a facet-emptied feed names that facet and links its removal", () => {
    const state = emptyFeedState(
      { tense: "upcoming", format: ["offline"], city: ["Казань"] },
      { listing: "/events", noun: { one: "событие", few: "события", many: "событий" }, copy: FEED_COPY },
    );
    expect(state.title).toBe("Нет событий по фильтру «Формат: Офлайн»");
    expect(state.action?.label).toBe("Убрать фильтр «Формат: Офлайн»");
    expect(state.action?.href).toBe("/events?city=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C");
  });

  it("NEW: an empty specialty offers «Показать смежные специальности»", () => {
    const state = emptyFeedState(
      { specialty: ["cardiology"] },
      { listing: "/events", noun: { one: "событие", few: "события", many: "событий" }, copy: FEED_COPY },
    );
    expect(state.action?.label).toBe("Показать смежные специальности");
    expect(state.action?.href).toBe("/events");
  });

  it("no facet ⇒ the plain empty feed, no action", () => {
    const state = emptyFeedState(
      {},
      { listing: "/webinars", noun: { one: "эфир", few: "эфира", many: "эфиров" }, copy: FEED_COPY },
    );
    expect(state.title).toBe("Эфиров нет");
    expect(state.action).toBeNull();
  });
});
