import { describe, expect, it } from "vitest";

import {
  AroundEventSchema,
  EventPageViewSchema,
} from "./public-page.schema.js";

/**
 * 020 EARS-2 (#1765) — the shape contract of `AroundEvent`. The rules under
 * test are the ones that make «absent rather than dead» a STRUCTURAL fact
 * rather than a rendering convention: a destination that does not exist has no
 * key, and no href is ever `null` or empty.
 */
describe("AroundEvent", () => {
  it("020 EARS-2.1: links keys are absent, never null, when a host has no target", () => {
    const empty = AroundEventSchema.parse({ speakerPages: [] });
    expect(empty).toEqual({ speakerPages: [] });
    expect("school" in empty).toBe(false);
    expect("communityHref" in empty).toBe(false);

    expect(() =>
      AroundEventSchema.parse({ speakerPages: [], school: null }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({ speakerPages: [], communityHref: null }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({ speakerPages: [], communityHref: "" }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({
        speakerPages: [{ speakerKey: "ivanov", href: "" }],
      }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({
        speakerPages: [],
        school: { label: "Школа", href: "" },
      }),
    ).toThrow();
  });

  it("020 EARS-2.1: a populated link set round-trips every key", () => {
    const parsed = AroundEventSchema.parse({
      school: { label: "Школа кардиологии", href: "/schools/cardio" },
      speakerPages: [{ speakerKey: "ivanov", href: "/experts/ivanov" }],
      communityHref: "/community",
    });
    expect(parsed).toEqual({
      school: { label: "Школа кардиологии", href: "/schools/cardio" },
      speakerPages: [{ speakerKey: "ivanov", href: "/experts/ivanov" }],
      communityHref: "/community",
    });
  });

  it("020 EARS-2.1: the event page read requires links, so a host cannot omit it", () => {
    const keys = Object.keys(EventPageViewSchema.shape);
    expect(keys).toContain("links");
  });
});

/**
 * 020 EARS-4 (#1766) — the conditions line of the sign-up card reads «формат ·
 * время · длительность · НМО · стоимость в Pul», so the two economy facts must
 * be part of the read model rather than a rendering assumption. The rules under
 * test are the ones that keep the page honest: both facts are REQUIRED (a
 * consumer can never confuse «бесплатно» with «this read does not know»), and
 * the cost is a whole non-negative count of Pul attention points — never a
 * fraction, never a negative, never roubles.
 */
describe("EventPageView economy facts", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "cardio-webinar",
    title: "Кардиология сегодня",
    school: "Школа кардиологии",
    startsAt: "2026-09-10T15:00:00+03:00",
    durationMin: 90,
    nmo: true,
    pulCost: 250,
    description: "О чём эфир",
    speakers: [],
    specialties: ["Кардиология"],
    partners: [],
    state: "published",
    recording: {
      state: "preparing",
      primaryKind: null,
      secondaryKind: null,
      posterUrl: null,
      expectedBy: null,
      durationSec: null,
    },
    format: "online",
    seatsLeft: null,
    signUps: null,
    viewers: null,
    links: { speakerPages: [] },
  };

  it("020 EARS-4.1: the event page read carries nmo and the Pul cost", () => {
    const parsed = EventPageViewSchema.parse(base);
    expect(parsed.nmo).toBe(true);
    expect(parsed.pulCost).toBe(250);
  });

  it("020 EARS-4.1: a zero Pul cost is valid — it is the free-for-the-doctor reading", () => {
    expect(
      EventPageViewSchema.parse({ ...base, nmo: false, pulCost: 0 }).pulCost,
    ).toBe(0);
  });

  it("020 EARS-4.1: neither fact may be omitted, and the cost is a whole non-negative count", () => {
    const { nmo: _nmo, ...noNmo } = base;
    expect(() => EventPageViewSchema.parse(noNmo)).toThrow();
    const { pulCost: _cost, ...noCost } = base;
    expect(() => EventPageViewSchema.parse(noCost)).toThrow();
    expect(() => EventPageViewSchema.parse({ ...base, pulCost: -1 })).toThrow();
    expect(() =>
      EventPageViewSchema.parse({ ...base, pulCost: 1.5 }),
    ).toThrow();
  });
});

/**
 * 020 EARS-3 (#1767) and wave-3 gate H2 (row 43) — the two counts are
 * required-nullable: absent is `null`, never a zero-shaped value.
 */
describe("EventPageView social proof and viewers count", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "cardio-webinar",
    title: "Кардиология сегодня",
    school: "Школа кардиологии",
    startsAt: "2026-09-10T15:00:00+03:00",
    durationMin: 90,
    nmo: false,
    pulCost: 0,
    description: "О чём эфир",
    speakers: [],
    specialties: [],
    partners: [],
    state: "ended",
    recording: {
      state: "preparing",
      primaryKind: null,
      secondaryKind: null,
      posterUrl: null,
      expectedBy: null,
      durationSec: null,
    },
    format: "online",
    seatsLeft: null,
    signUps: null,
    viewers: null,
    links: { speakerPages: [] },
  };

  it("020 EARS-3: the read carries the sign-up proof split into same and adjacent specialties", () => {
    const signUps = { total: 51, sameSpecialty: 37, adjacentSpecialties: 14 };
    expect(EventPageViewSchema.parse({ ...base, signUps }).signUps).toEqual(
      signUps,
    );
  });

  it("020 EARS-3: a zero-shaped proof is refused — no sign-ups is `null`, and the field is never omitted", () => {
    expect(() =>
      EventPageViewSchema.parse({
        ...base,
        signUps: { total: 0, sameSpecialty: 0, adjacentSpecialties: 0 },
      }),
    ).toThrow();
    const { signUps: _signUps, ...noSignUps } = base;
    expect(() => EventPageViewSchema.parse(noSignUps)).toThrow();
  });

  it("020 EARS-1 (H2 row 43): the viewers count is a positive whole number or `null`, never `0` and never omitted", () => {
    expect(EventPageViewSchema.parse({ ...base, viewers: 12 }).viewers).toBe(
      12,
    );
    expect(() => EventPageViewSchema.parse({ ...base, viewers: 0 })).toThrow();
    const { viewers: _viewers, ...noViewers } = base;
    expect(() => EventPageViewSchema.parse(noViewers)).toThrow();
  });
});
