import { describe, expect, it } from "vitest";

import { adaptDoctorEventsFeed, adaptPublicEventListing } from "./adapters";

const KIND = { id: "k-1", slug: "webinar", title: "Вебинар" };
const RECORDING = {
  state: "raw-only",
  primaryKind: "raw",
  secondaryKind: null,
  posterUrl: null,
  expectedBy: null,
  durationSec: 3240,
};

describe("adaptPublicEventListing — the Academy read onto the one feed model", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "a-1",
    title: "Эфир",
    school: "Школа",
    startsAt: "2026-10-20T16:00:00.000Z",
    specialties: ["Кардиология"],
    speakers: [{ name: "Иванов И. И." }],
    kind: KIND,
    format: "online",
    signUpCount: 12,
  };

  it("maps upcoming / live / ended cards, the horizon and the remainder of the tense", () => {
    const page = adaptPublicEventListing(
      {
        data: [
          { ...base, state: "published" },
          { ...base, id: "22222222-2222-4222-8222-222222222222", slug: "a-2", state: "live" },
        ],
        counts: { upcoming: 30, past: 4, upcomingSchools: 3 },
        pagination: { nextCursor: null, hasMore: true },
        horizon: { from: "2026-10-08", to: "2026-10-22", nextTo: "2026-11-05", nextFrom: null, remaining: 28, nextBatch: 5 },
      },
      { tense: "upcoming" },
    );
    expect(page.cards.map((c) => c.state)).toEqual(["upcoming", "live"]);
    expect(page.cards[0]).toMatchObject({
      kindTitle: "Вебинар",
      format: "online",
      signUpCount: 12,
      speakers: ["Иванов И. И."],
      recording: null,
    });
    expect(page.horizon).toEqual({
      from: "2026-10-08",
      to: "2026-10-22",
      nextTo: "2026-11-05",
      nextFrom: null,
    });
    expect(page.remaining).toBe(28);
    // N of «Показать ещё N из M» is the api's next batch, carried as is.
    expect(page.nextBatch).toBe(5);
  });

  it("NEW: a listing page without a horizon is a refused read, never a feed without «Показать ещё» (D2)", () => {
    expect(() =>
      adaptPublicEventListing(
        {
          data: [],
          counts: { upcoming: 30, past: 4, upcomingSchools: 3 },
          pagination: { nextCursor: "abc", hasMore: true },
        },
        { tense: "upcoming" },
      ),
    ).toThrow();
  });

  it("NEW: the Academy read's counts become the head summary — upcoming эфиры and their distinct schools (row 19)", () => {
    const page = adaptPublicEventListing(
      {
        data: [],
        counts: { upcoming: 30, past: 4, upcomingSchools: 3 },
        pagination: { nextCursor: null, hasMore: false },
        horizon: { from: "2026-10-08", to: "2026-10-22", nextTo: null, nextFrom: null, remaining: 0, nextBatch: 0 },
      },
      { tense: "past" },
    );
    expect(page.summary).toEqual({ events: 30, schools: 3 });
  });

  it("NEW: the Academy facet options reach the page model, and the matching count is the page plus the rest of the reach (rows 58, 60)", () => {
    const options = { project: [{ slug: "p", title: "Проект", count: 2 }], expert: [], topic: [] };
    const page = adaptPublicEventListing(
      {
        data: [{ ...base, state: "published" }],
        counts: { upcoming: 30, past: 4, upcomingSchools: 3 },
        pagination: { nextCursor: null, hasMore: true },
        horizon: { from: "2026-10-08", to: "2026-10-22", nextTo: "2026-11-05", nextFrom: null, remaining: 28, nextBatch: 5 },
        facets: options,
      },
      { tense: "upcoming" },
    );
    expect(page.facetOptions).toEqual(options);
    expect(page.matching).toBe(29);
  });

  it("a past card carries its recording projection", () => {
    const recording = {
      state: "montage",
      primaryKind: "edited",
      secondaryKind: "raw",
      posterUrl: null,
      expectedBy: null,
      durationSec: 2820,
    };
    const page = adaptPublicEventListing(
      {
        data: [{ ...base, state: "ended", recording }],
        counts: { upcoming: 0, past: 1, upcomingSchools: 0 },
        pagination: { nextCursor: null, hasMore: false },
        horizon: { from: "2026-09-24", to: "2026-10-09", nextTo: null, nextFrom: "2026-09-10", remaining: 3, nextBatch: 2 },
      },
      { tense: "past" },
    );
    expect(page.cards[0]?.state).toBe("past");
    expect(page.cards[0]?.recording).toEqual(recording);
    expect(page.horizon.nextFrom).toBe("2026-09-10");
    expect(page.remaining).toBe(3);
    expect(page.nextBatch).toBe(2);
  });
});

describe("adaptDoctorEventsFeed — the doctor read onto the one feed model", () => {
  const card = {
    id: "d-1",
    slug: "d-1",
    href: "/events/d-1",
    startsAt: "2026-10-20T16:00:00.000Z",
    endsAt: "2026-10-20T17:00:00.000Z",
    format: "offline",
    kind: KIND,
    title: "Событие",
    speaker: "Петров П. П.",
    source: "Проект",
    nmo: false,
    pulCost: 0,
    signUpCount: 5,
    city: "Казань",
    state: "normal",
  };

  it("maps the day groups flat, the horizon and the remainder", () => {
    const page = adaptDoctorEventsFeed(
      {
        tense: "upcoming",
        from: "2026-10-08",
        to: "2026-10-22",
        days: [
          { day: "2026-10-20", label: "20 октября", items: [card, { ...card, id: "d-2", slug: "d-2", state: "live" }] },
        ],
        totalCount: 2,
        nextTo: "2026-11-05",
        nextFrom: null,
        remaining: 7,
        nextBatch: 4,
        targeting: { mode: "all", specialtyReference: null, directionIds: [], adjacentDirectionIds: [] },
      },
      { tense: "upcoming" },
    );
    expect(page.cards.map((c) => c.state)).toEqual(["upcoming", "live"]);
    expect(page.cards[0]).toMatchObject({
      school: "Проект",
      speakers: ["Петров П. П."],
      kindTitle: "Вебинар",
      city: "Казань",
      nmo: false,
      pulCost: 0,
      recording: null,
    });
    expect(page.horizon).toEqual({
      from: "2026-10-08",
      to: "2026-10-22",
      nextTo: "2026-11-05",
      nextFrom: null,
    });
    expect(page.remaining).toBe(7);
    expect(page.nextBatch).toBe(4);
  });

  it("NEW: the doctor facet options reach the page model (row 58, D9)", () => {
    const facets = { kind: [{ slug: "webinar", title: "Вебинар", count: 1 }], city: [] };
    const page = adaptDoctorEventsFeed(
      {
        tense: "upcoming", from: "2026-10-08", to: "2026-10-22",
        days: [{ day: "2026-10-20", label: "20 октября", items: [card] }],
        totalCount: 1, nextTo: null, nextFrom: null, remaining: 0, nextBatch: 0,
        targeting: { mode: "all", specialtyReference: null, directionIds: [], adjacentDirectionIds: [] },
        facets,
      },
      { tense: "upcoming" },
    );
    expect(page.facetOptions).toEqual(facets);
    expect(page.matching).toBe(1);
  });

  it("NEW: an ended doctor card is a past card carrying its recording projection", () => {
    const page = adaptDoctorEventsFeed(
      {
        tense: "past",
        from: "2026-09-24",
        to: "2026-10-09",
        days: [{ day: "2026-10-01", label: "1 октября", items: [{ ...card, state: "recorded", recording: RECORDING }] }],
        totalCount: 1,
        nextTo: null,
        nextFrom: null,
        remaining: 0,
        nextBatch: 0,
        targeting: { mode: "all", specialtyReference: null, directionIds: [], adjacentDirectionIds: [] },
      },
      { tense: "past" },
    );
    expect(page.cards[0]?.state).toBe("past");
    expect(page.cards[0]?.recording).toEqual(RECORDING);
  });
});
