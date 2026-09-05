import { describe, expect, it } from "vitest";
import type { EventListItem } from "@ds/design-system/blocks";
import type { DoctorEventCard, DoctorEventsFeed } from "@ds/schemas";
import { parseReturnTarget } from "@ds/schemas";

import {
  DOCTOR_EVENTS_FEED_COPY,
  toEventListItems,
} from "@/lib/events-feed-cards";

/**
 * 019 EARS-12 (#1527) — the guest read path and its hand-off.
 *
 * The feed READ is viewer-independent: the payload below is the SAME object for
 * both viewers, and only the projection differs. What this tier pins is that
 * difference — where «Участвовать» points for a guest versus a doctor, and that
 * the guest's target is the one the shared guard mints and accepts back.
 */
const CARD: DoctorEventCard = {
  id: "evt_1",
  slug: "kardio-forum",
  href: "/events/kardio-forum",
  startsAt: "2026-09-14T16:00:00.000Z",
  endsAt: null,
  format: "webinar",
  kind: "3f1c7d2e-8a5b-4a1e-9c33-1d0f6b2a7e41",
  kindTitle: "Разбор клинического случая",
  title: "Кардиофорум",
  speaker: "Анна Соколова",
  source: "Школа кардиологии",
  nmo: true,
  pulCost: 0,
  signUpCount: 128,
  state: "normal",
};

function feedOf(...items: DoctorEventCard[]): DoctorEventsFeed {
  return {
    tense: "upcoming",
    from: "2026-09-14",
    to: "2026-09-28",
    days: [{ day: "2026-09-14", label: "14 сентября, понедельник", items }],
    totalCount: items.length,
    nextTo: null,
    targeting: {
      mode: "targeted",
      specialtyReference: "cardiology",
      directionIds: [],
      adjacentDirectionIds: [],
    },
  };
}

const FEED_QUERY = { tense: "upcoming", day: "2026-09-14" };

describe("019 EARS-12: the feed card CTA", () => {
  it("019 EARS-12: when a GUEST reads the feed, the card CTA hands off to registration with the canonical return target", () => {
    const [item] = toEventListItems(feedOf(CARD), {
      viewer: "guest",
      feedQuery: FEED_QUERY,
    });

    expect(item!.ctaLabel).toBe(DOCTOR_EVENTS_FEED_COPY.participate);
    expect(item!.ctaHref!.startsWith("/register?returnTo=")).toBe(true);

    // The target is not merely present — it is the value the ONE guard accepts,
    // and it restores THIS feed query on THIS card.
    const returnTo = decodeURIComponent(
      item!.ctaHref!.slice("/register?returnTo=".length),
    );
    expect(parseReturnTarget(returnTo)).toEqual({
      eventSlug: "kardio-forum",
      returnTo,
    });
    expect(returnTo).toBe(
      "/events?day=2026-09-14&tense=upcoming&specialty=mine-and-adjacent" +
        "&resume=kardio-forum",
    );
  });

  it("019 EARS-12: an undeclared search param of the route never rides the minted target", () => {
    const [item] = toEventListItems(feedOf(CARD), {
      viewer: "guest",
      feedQuery: { ...FEED_QUERY, utm_source: "mail", resume: "older-event" },
    });

    expect(item!.ctaHref).not.toContain("utm_source");
    expect(item!.ctaHref!.match(/resume/g)).toHaveLength(1);
    expect(item!.ctaHref).toContain("resume%3Dkardio-forum");
  });

  it("019 EARS-12: when a DOCTOR reads the feed, the CTA is the event page — 019 issues no participation command", () => {
    const [item] = toEventListItems(feedOf(CARD), {
      viewer: "doctor",
      feedQuery: FEED_QUERY,
    });

    expect(item!.ctaHref).toBe("/events/kardio-forum");
    expect(item!.ctaLabel).toBe(DOCTOR_EVENTS_FEED_COPY.participate);
  });

  it("019 EARS-12: a live card is open to both viewers, and a registered/soldOut/recorded card carries no CTA", () => {
    for (const viewer of ["guest", "doctor"] as const) {
      const [live] = toEventListItems(
        feedOf({ ...CARD, state: "live" }),
        { viewer, feedQuery: FEED_QUERY },
      );
      expect(live!.ctaHref, `live, ${viewer}`).toBeDefined();

      for (const state of ["registered", "soldOut", "recorded"] as const) {
        const [closed] = toEventListItems(feedOf({ ...CARD, state }), {
          viewer,
          feedQuery: FEED_QUERY,
        });
        expect(closed!.ctaHref, `${state}, ${viewer}`).toBeUndefined();
        expect(closed!.ctaLabel, `${state}, ${viewer}`).toBeUndefined();
      }
    }
  });

  it("019 EARS-12: a feed query the ONE codec rejects yields no guest CTA rather than an unguarded link", () => {
    const [item] = toEventListItems(feedOf(CARD), {
      viewer: "guest",
      feedQuery: { kind: "not-a-uuid" },
    });

    expect(item!.ctaHref).toBeUndefined();
    expect(item!.ctaLabel).toBeUndefined();
  });

  it("019 EARS-12: the projection is otherwise identical for both viewers — the read carries no per-viewer state", () => {
    const strip = ({ ctaHref: _href, ctaLabel: _label, ...rest }: EventListItem) =>
      rest;
    const guest = toEventListItems(feedOf(CARD), {
      viewer: "guest",
      feedQuery: FEED_QUERY,
    });
    const doctor = toEventListItems(feedOf(CARD), {
      viewer: "doctor",
      feedQuery: FEED_QUERY,
    });

    expect(guest.map(strip)).toEqual(doctor.map(strip));
  });
});
