import { describe, expect, it } from "vitest";

import {
  DoctorEventCardSchema,
  DoctorEventFormatSchema,
} from "./doctor-event-card.schema.js";

/**
 * 019 EARS-2 — the shared card payload. The component proof lives in
 * `packages/design-system/src/primitives/webinar-card.test.tsx`; this file pins
 * the vocabulary and the disclosure boundary the card renders from.
 */

const BASE = {
  id: "evt_1",
  slug: "kardio-forum",
  href: "/events/kardio-forum",
  startsAt: "2026-09-14T16:00:00.000Z",
  endsAt: null,
  format: "webinar" as const,
  kind: "3f1c7d2e-8a5b-4a1e-9c33-1d0f6b2a7e41",
  kindTitle: "Разбор клинического случая",
  title: "Кардиофорум: разбор клинических случаев",
  speaker: "Анна Соколова",
  source: "Школа кардиологии",
  nmo: true,
  pulCost: 0,
  signUpCount: 128,
  state: "normal" as const,
};

describe("019 EARS-2 — DoctorEventCard payload", () => {
  it("019 EARS-2.1: the format vocabulary is exactly the five spec formats", () => {
    expect(DoctorEventFormatSchema.options).toEqual([
      "webinar",
      "online-meeting",
      "offline-meetup",
      "congress",
      "podcast",
    ]);
  });

  it("019 EARS-2.2: every one of the five formats parses as a card payload", () => {
    for (const format of DoctorEventFormatSchema.options) {
      expect(DoctorEventCardSchema.parse({ ...BASE, format }).format).toBe(
        format,
      );
    }
  });

  it("019 EARS-2.3: an offline event carries its city and remaining seats", () => {
    const offline = DoctorEventCardSchema.parse({
      ...BASE,
      format: "offline-meetup",
      city: "Казань",
      seatsLeft: 12,
    });
    expect(offline.city).toBe("Казань");
    expect(offline.seatsLeft).toBe(12);
  });

  it("019 EARS-2.4: a congress may span dates and be hybrid (an endsAt plus a city)", () => {
    const congress = DoctorEventCardSchema.parse({
      ...BASE,
      format: "congress",
      endsAt: "2026-09-16T18:00:00.000Z",
      city: "Санкт-Петербург",
      seatsLeft: 40,
    });
    expect(congress.endsAt).not.toBeNull();
    expect(congress.city).toBe("Санкт-Петербург");
  });

  it("019 EARS-2.5: the sign-up count is a required field of every payload", () => {
    const { signUpCount: _dropped, ...withoutCount } = BASE;
    expect(DoctorEventCardSchema.safeParse(withoutCount).success).toBe(false);
  });

  it("019 EARS-2.6: zero cost is a valid Pul cost — the free-for-the-doctor reading", () => {
    expect(DoctorEventCardSchema.parse({ ...BASE, pulCost: 0 }).pulCost).toBe(0);
  });

  it("019 EARS-12: the card carries its own slug, so a host never slices it out of href", () => {
    const { slug: _dropped, ...withoutSlug } = BASE;
    expect(DoctorEventCardSchema.safeParse(withoutSlug).success).toBe(false);

    const card = DoctorEventCardSchema.parse(BASE);
    expect(card.slug).toBe("kardio-forum");
    expect(card.href).toBe(`/events/${card.slug}`);
  });

  it("019 EARS-2.7: no field may state who finances the event, and none may carry roubles", () => {
    for (const leak of [
      { sponsor: "…" },
      { financedBy: "…" },
      { partner: "…" },
      { priceRub: 4900 },
    ]) {
      expect(DoctorEventCardSchema.safeParse({ ...BASE, ...leak }).success).toBe(
        false,
      );
    }
  });
});
