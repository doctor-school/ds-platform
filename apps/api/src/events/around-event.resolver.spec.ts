import { describe, expect, it } from "vitest";
import { AroundEventSchema, type HostFreeEventPageView } from "@ds/schemas";

import {
  type AroundEventRoutes,
  resolveAroundEvent,
} from "./around-event.resolver.js";

/**
 * A host whose school, expert and community screens all exist — the shape both
 * storefronts will produce once the two-site-IA screens land. Nothing in the
 * platform serves these paths today; they exist here so the POLICY is pinned
 * independently of whether any host has caught up with it.
 */
const FULL_ROUTES: AroundEventRoutes = {
  schoolPath: (school) => `/schools/${encodeURIComponent(school)}`,
  expertPath: (speaker) => `/experts/${speaker.slug}`,
  communityPath: (event) => `/community/${event.slug}`,
};

/** The table BOTH hosts run today: no school, no expert page, no community. */
const NO_ROUTES: AroundEventRoutes = {
  schoolPath: () => null,
  expertPath: () => null,
  communityPath: () => null,
};

const VIEW: HostFreeEventPageView = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "kardio-2026",
  title: "Кардиология: разбор клинических случаев",
  school: "Школа кардиологии",
  startsAt: "2026-09-28T16:00:00.000Z",
  durationMin: 90,
  description: "Разбор трёх случаев.",
  speakers: [
    {
      source: "expert",
      expertId: "22222222-2222-4222-8222-222222222222",
      expertSlug: "mihail-strahov",
      name: "Михаил Страхов",
      credentials: "Д.м.н.",
      photoUrl: null,
      role: "Лектор",
    },
  ],
  specialties: ["Кардиология"],
  partners: [],
  state: "published",
  recording: {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
  },
  format: "online",
  seatsLeft: null,
};

describe("resolveAroundEvent", () => {
  it("020 EARS-2.2: a host route table with paths yields school/speaker/community links; null paths yield absent keys", () => {
    const full = resolveAroundEvent(VIEW, FULL_ROUTES);
    expect(full).toEqual({
      school: {
        label: "Школа кардиологии",
        href: `/schools/${encodeURIComponent("Школа кардиологии")}`,
      },
      // The LEGACY speaker has no stable key, so it is never offered a page —
      // only the expert arm appears.
      speakerPages: [
        { speakerKey: "mihail-strahov", href: "/experts/mihail-strahov" },
      ],
      communityHref: "/community/kardio-2026",
    });
    expect(AroundEventSchema.parse(full)).toEqual(full);

    const none = resolveAroundEvent(VIEW, NO_ROUTES);
    expect(none).toEqual({ speakerPages: [] });
    expect("school" in none).toBe(false);
    expect("communityHref" in none).toBe(false);
    expect(AroundEventSchema.parse(none)).toEqual(none);
  });

  it("020 EARS-2.2: one host mounting a route never changes what the other host answers", () => {
    const schoolOnly: AroundEventRoutes = {
      ...NO_ROUTES,
      schoolPath: () => "/schools/cardio",
    };
    expect(resolveAroundEvent(VIEW, schoolOnly)).toEqual({
      school: { label: "Школа кардиологии", href: "/schools/cardio" },
      speakerPages: [],
    });
    expect(resolveAroundEvent(VIEW, NO_ROUTES)).toEqual({ speakerPages: [] });
  });

  it("020 EARS-2.2: an event with no speakers yields an empty page list, never a null entry", () => {
    const noSpeakers: HostFreeEventPageView = { ...VIEW, speakers: [] };
    expect(resolveAroundEvent(noSpeakers, FULL_ROUTES).speakerPages).toEqual([]);
  });
});
