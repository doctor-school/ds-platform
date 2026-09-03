import { describe, expect, it } from "vitest";
import type { EventPageView, ParticipationCta } from "@ds/schemas";

import {
  EVENT_PAGE_COPY,
  eventFormatBlockProps,
  eventLifecycleCountdown,
  eventLifecyclePlate,
  eventPageChips,
  eventPageDateLine,
  eventPageKicker,
  eventPageKickerParts,
  eventProgrammeContent,
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
  // 020 EARS-2 — the link set BOTH hosts resolve today: every key absent,
  // because neither storefront mounts a school, expert or community route.
  links: { speakerPages: [] },
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

  it("020 EARS-1: the sign-up footnote shall render in the register state only (#1764)", () => {
    // Canvas:201 puts «Нужна регистрация …» under the register control alone.
    expect(eventSignupCardProps(VIEW, REGISTER_CTA).note).toBe(
      EVENT_PAGE_COPY.signupNote,
    );
    for (const cta of [
      { action: "registered", label: "Вы записаны", href: null, reason: null },
      { action: "sold-out", label: "Мест нет", href: null, reason: null },
      {
        action: "unavailable",
        label: "Участие недоступно",
        href: null,
        reason: "Событие завершилось",
      },
      {
        action: "enter-room",
        label: "Войти в эфир",
        href: "/room/prp-gonartroz",
        reason: null,
      },
    ] satisfies ParticipationCta[]) {
      // A footnote about registering would contradict the words above it.
      expect(eventSignupCardProps(VIEW, cta).note).toBeUndefined();
    }
  });

  it("020 EARS-18: the lifecycle plate is a mapper decision, not a host one (#1764)", () => {
    expect(eventLifecyclePlate({ ...VIEW, state: "live" })).toEqual({
      state: "live",
      variant: "live",
    });
    for (const state of ["published", "ended", "hidden"] as const) {
      expect(eventLifecyclePlate({ ...VIEW, state })).toEqual({
        state,
        variant: "label",
      });
    }
    // A legacy эфир has no lifecycle word of its own (014-design §3.1).
    expect(eventLifecyclePlate({ ...VIEW, state: "in_archive" })).toBeNull();
  });

  it("020 EARS-1: the sign-up conditions follow the canvas order, wording and accent (#1779)", () => {
    // Canvas:206-228 — «Участие» leads in the success tone, and the format row
    // says WHERE the doctor goes («Онлайн · комната эфира»), not just the
    // one-word format the hero kicker carries. The owner's Stage-B round-1
    // rejection was this exact row set.
    expect(eventSignupCardProps(VIEW, REGISTER_CTA).conditions).toEqual([
      { label: "Участие", value: "Бесплатно для врача", tone: "success" },
      { label: "Формат", value: "Онлайн · комната эфира" },
      { label: "Длительность", value: "90 минут" },
    ]);
  });

  it("020 EARS-1: only the price row carries the success accent (#1779)", () => {
    const rows = eventSignupCardProps(VIEW, REGISTER_CTA).conditions ?? [];
    expect(rows.filter((row) => row.tone === "success")).toHaveLength(1);
    expect(rows[0]?.tone).toBe("success");
  });

  it("020 EARS-1: an offline event's format row names the format without a room (#1779)", () => {
    const rows =
      eventSignupCardProps({ ...VIEW, format: "offline" }, REGISTER_CTA)
        .conditions ?? [];
    expect(rows[1]).toEqual({ label: "Формат", value: "Очно" });
  });

  it("020 EARS-1: the plate countdown is calendar days in МСК, RU-pluralised (#1779)", () => {
    // Canvas:171 «Скоро · через 5 дней». 2026-08-23 МСК → 2026-08-28 МСК = 5.
    const now = new Date("2026-08-23T09:00:00.000Z");
    expect(eventLifecycleCountdown(VIEW, EVENT_PAGE_COPY, now)).toBe(
      "через 5 дней",
    );
    expect(
      eventLifecycleCountdown(
        VIEW,
        EVENT_PAGE_COPY,
        new Date("2026-08-27T09:00:00.000Z"),
      ),
    ).toBe("через 1 день");
    expect(
      eventLifecycleCountdown(
        VIEW,
        EVENT_PAGE_COPY,
        new Date("2026-08-26T09:00:00.000Z"),
      ),
    ).toBe("через 2 дня");
  });

  it("020 EARS-1: a countdown is offered only where it cannot contradict the plate word (#1779)", () => {
    const now = new Date("2026-08-23T09:00:00.000Z");
    // Today, and anything already started, has no days left to name.
    expect(
      eventLifecycleCountdown(
        VIEW,
        EVENT_PAGE_COPY,
        new Date("2026-08-28T09:00:00.000Z"),
      ),
    ).toBeNull();
    // «В эфире» / «Эфир завершён» / «Скрыто» are present-tense or terminal.
    for (const state of ["live", "ended", "hidden"] as const) {
      expect(
        eventLifecycleCountdown({ ...VIEW, state }, EVENT_PAGE_COPY, now),
      ).toBeNull();
    }
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
    });
    // The FIRST card keeps the canvas default heading «Ведёт» (canvas:118) by
    // leaving it unset; every later card suppresses it with an explicit `null`,
    // because `undefined` would RESTORE that default and print one heading per
    // speaker.
    expect(cards[0]?.heading).toBeUndefined();
    expect(cards[1]?.heading).toBeNull();
    // The legacy variant degrades to initials rather than to a broken image.
    expect(cards[1]).toMatchObject({ name: "Анна Петрова", initials: "АП" });
    expect(cards[1]?.photoUrl).toBeUndefined();
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
    expect(doctor.conditions?.[0]?.value).toBe("бесплатно");
  });
});

/**
 * 020 EARS-2 (#1765) — the decision set the page owes a registration-free
 * reader, and the rule that an impossible destination is ABSENT rather than
 * dead. Both hosts run these functions, so what holds here holds on
 * `/webinars/:slug` and `/events/:slug` alike.
 */
describe("020 EARS-2 — the registration-free decision set", () => {
  it("020 EARS-2.4: eventSpeakerCards carries href only for speakers with a page; the kicker is a link only with links.school", () => {
    // Today's reality on both hosts: no links at all.
    const bare = eventSpeakerCards(VIEW);
    expect(bare[0]?.href).toBeUndefined();
    expect(bare[1]?.href).toBeUndefined();
    expect(eventPageKickerParts(VIEW)).toEqual({
      school: "Школа ортобиологии",
      formatLabel: "Онлайн",
    });
    expect("schoolHref" in eventPageKickerParts(VIEW)).toBe(false);

    // A host that HAS the routes: the expert card links, the legacy card never
    // does (it carries no stable key), and the kicker becomes a link.
    const linked: EventPageView = {
      ...VIEW,
      links: {
        school: { label: "Школа ортобиологии", href: "/schools/ortho" },
        speakerPages: [
          { speakerKey: "mikhail-strakhov", href: "/experts/mikhail-strakhov" },
        ],
      },
    };
    const cards = eventSpeakerCards(linked);
    expect(cards[0]?.href).toBe("/experts/mikhail-strakhov");
    expect(cards[1]?.href).toBeUndefined();
    expect(eventPageKickerParts(linked)).toEqual({
      school: "Школа ортобиологии",
      schoolHref: "/schools/ortho",
      formatLabel: "Онлайн",
    });
    // The one-string kicker keeps reading the same either way.
    expect(eventPageKicker(linked)).toBe("Школа ортобиологии · Онлайн");
  });

  it("020 EARS-2.4: an entry for an unknown speaker key links nobody", () => {
    const stale: EventPageView = {
      ...VIEW,
      links: { speakerPages: [{ speakerKey: "someone-else", href: "/experts/x" }] },
    };
    expect(eventSpeakerCards(stale).every((card) => card.href === undefined)).toBe(
      true,
    );
  });

  it("020 EARS-2.5: the programme content is the download with a PDF and the lifecycle sentence without one", () => {
    expect(
      eventProgrammeContent({ ...VIEW, programPdfUrl: "https://cdn/x.pdf" }),
    ).toEqual({ downloadHref: "https://cdn/x.pdf" });

    for (const state of ["published", "live"] as const) {
      expect(eventProgrammeContent({ ...VIEW, state })).toEqual({
        statement: EVENT_PAGE_COPY.programmePending,
      });
    }
    for (const state of ["ended", "hidden", "in_archive"] as const) {
      expect(eventProgrammeContent({ ...VIEW, state })).toEqual({
        statement: EVENT_PAGE_COPY.programmeNeverPublished,
      });
    }
    // Never «скоро», never an empty answer (EARS-19 / NG-1).
    expect(EVENT_PAGE_COPY.programmePending).not.toMatch(/скоро/iu);
    expect(EVENT_PAGE_COPY.programmeNeverPublished.length).toBeGreaterThan(0);
  });
});
