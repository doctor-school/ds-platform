import { describe, expect, it } from "vitest";
import type { EventPageView, ParticipationCta } from "@ds/schemas";

import {
  EVENT_PAGE_COPY,
  eventFormatBlockProps,
  eventPageChips,
  eventPageDateLine,
  eventPageKicker,
  eventSignupCardProps,
  eventSpeakerCards,
} from "./event-page-view";

/**
 * 020 EARS-1 / EARS-18 (#1764, slice 3) — the shared `EventPageView` → block-props
 * projection. These are the assertions that make the cross-host identity
 * structural: both storefronts call THESE functions, so anything proven here is
 * proven for `/webinars/:slug` and `/events/:slug` alike.
 */

const VIEW: EventPageView = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "prp-gonartroz",
  title: "PRP при гонартрозе",
  school: "Школа ортобиологии",
  // 2026-08-28T16:00:00Z = 19:00 МСК, пятница.
  startsAt: "2026-08-28T16:00:00.000Z",
  durationMin: 90,
  description: "Разбор клинического случая.",
  speakers: [
    {
      source: "expert",
      expertId: "22222222-2222-4222-8222-222222222222",
      expertSlug: "mikhail-strakhov",
      name: "Михаил Страхов",
      credentials: "Д.м.н., профессор",
      photoUrl: "https://cdn.example/mikhail.jpg",
      role: "Травматолог-ортопед",
    },
    {
      source: "legacy",
      name: "Анна Петрова",
      credentials: "К.м.н.",
    },
  ],
  specialties: ["Травматология и ортопедия", "Ортобиология"],
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

const REGISTER_CTA: ParticipationCta = {
  action: "register",
  label: "Участвовать",
  href: "/register?returnTo=%2Fwebinars%2Fprp-gonartroz",
  reason: null,
};

describe("020 EARS-1 — shared event-page view projection", () => {
  it("020 EARS-1: the hero date line carries date, МСК time and duration in one string", () => {
    expect(eventPageDateLine(VIEW)).toBe("28 августа, 19:00 (МСК) · 90 минут");
  });

  it("020 EARS-1: the kicker joins the school with the participation format", () => {
    expect(eventPageKicker(VIEW)).toBe("Школа ортобиологии · Онлайн");
  });

  it("020 EARS-1: the hero chips are the projection's specialties, in order", () => {
    expect(eventPageChips(VIEW)).toEqual([
      "Травматология и ортопедия",
      "Ортобиология",
    ]);
  });

  it("020 EARS-1: the hero chips never synthesise an НМО badge the read model has no field for", () => {
    // EARS-11 (#1774) owns accreditation; inventing a chip here would be the
    // untracked seam F-22 forbids.
    expect(eventPageChips(VIEW).some((chip) => chip.includes("НМО"))).toBe(false);
  });

  it("020 EARS-1: the sign-up card renders the server CTA verbatim and never re-resolves it", () => {
    const props = eventSignupCardProps(VIEW, REGISTER_CTA);
    expect(props.cta).toBe(REGISTER_CTA);
    expect(props.timeLabel).toBe("19:00");
    expect(props.dateLabel).toBe("28 августа");
    expect(props.weekdayLabel).toBe("пятница · МСК");
  });

  it("020 EARS-1: a sold-out CTA with no target passes through unchanged (no host-side branch)", () => {
    const soldOut: ParticipationCta = {
      action: "sold-out",
      label: "Мест нет",
      href: null,
      reason: "Офлайн-места закончились",
    };
    expect(eventSignupCardProps(VIEW, soldOut).cta).toEqual(soldOut);
  });

  it("020 EARS-1: the sign-up conditions state format, duration and price", () => {
    expect(eventSignupCardProps(VIEW, REGISTER_CTA).conditions).toEqual([
      { label: "Формат", value: "Онлайн" },
      { label: "Длительность", value: "90 минут" },
      { label: "Участие", value: "бесплатно для врача" },
    ]);
  });

  it("020 EARS-1: speakers map from the legacy+expert union with one section heading", () => {
    const cards = eventSpeakerCards(VIEW);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      name: "Михаил Страхов",
      roleKicker: "Травматолог-ортопед",
      affiliation: "Д.м.н., профессор",
      photoUrl: "https://cdn.example/mikhail.jpg",
      initials: "МС",
      heading: EVENT_PAGE_COPY.speakersHeading,
    });
    // The legacy variant degrades to initials rather than to a broken image.
    expect(cards[1]).toMatchObject({ name: "Анна Петрова", initials: "АП" });
    expect(cards[1]?.photoUrl).toBeUndefined();
    expect(cards[1]?.heading).toBeUndefined();
  });

  it("020 EARS-1: no speaker card links out to an expert page neither host owns yet", () => {
    for (const card of eventSpeakerCards(VIEW)) {
      expect(card.href).toBeUndefined();
      expect(card.footerHref).toBeUndefined();
    }
  });

  it("020 EARS-1: an online event gets the format block", () => {
    expect(eventFormatBlockProps(VIEW)).toMatchObject({
      kind: "online",
      roomOpensLine: EVENT_PAGE_COPY.roomOpensLine,
    });
  });

  it("020 EARS-1: offline and hybrid render NO format block until EARS-8 (#1771)", () => {
    expect(eventFormatBlockProps({ ...VIEW, format: "offline" })).toBeNull();
    expect(eventFormatBlockProps({ ...VIEW, format: "hybrid" })).toBeNull();
  });

  it("020 EARS-18: a host copy override changes words, never the mapping shape", () => {
    const doctorCopy = { ...EVENT_PAGE_COPY, priceFree: "бесплатно" };
    const shared = eventSignupCardProps(VIEW, REGISTER_CTA);
    const doctor = eventSignupCardProps(VIEW, REGISTER_CTA, doctorCopy);
    expect(doctor.conditions?.map((row) => row.label)).toEqual(
      shared.conditions?.map((row) => row.label),
    );
    expect(doctor.conditions?.[2]?.value).toBe("бесплатно");
  });
});
