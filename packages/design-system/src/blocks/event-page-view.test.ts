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
  eventPageTimeParts,
  eventProgrammeContent,
  eventSignupCardProps,
  eventSocialProof,
  eventSpeakerCards,
  eventViewersMeta,
  eventAiredMeta,
  type EventSignupViewer,
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
  // The standing reading of feature 007's model today: no НМО, no Pul cost.
  nmo: false,
  pulCost: 0,
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
      source: "expert",
      expertId: "33333333-3333-4333-8333-333333333333",
      expertSlug: "anna-petrova",
      name: "Анна Петрова",
      credentials: "К.м.н.",
      photoUrl: null,
      role: "Ревматолог",
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
    durationSec: null,
  },
  format: "online",
  seatsLeft: null,
  signUps: null,
  viewers: null,
  // 020 EARS-2 — the link set BOTH hosts resolve today: every key absent,
  // because neither storefront mounts a school, expert or community route.
  links: { speakerPages: [] },
};

/** The two viewers the sign-up footnote distinguishes (#3307). */
const GUEST: EventSignupViewer = { signedIn: false };
const SIGNED_IN: EventSignupViewer = { signedIn: true };

const REGISTER_CTA: ParticipationCta = {
  action: "register",
  label: "Участвовать",
  href: "/register?returnTo=%2Fwebinars%2Fprp-gonartroz",
  reason: null,
  presenceCount: null,
};

describe("020 EARS-1 — shared event-page view projection", () => {
  it("020 EARS-1: the server's hero date line (no viewer zone yet) carries date, МСК time and duration in one string", () => {
    expect(eventPageDateLine(VIEW)).toBe("28 августа, 19:00 (МСК) · 90 минут");
  });

  it("020 EARS-2: an online event's hero time reads in the viewer's zone with its label; an offline event stays МСК (gate row 30, Amendment 2026-10-02)", () => {
    const zone = "Asia/Yekaterinburg";
    expect(eventPageDateLine(VIEW, undefined, zone)).toBe(
      "28 августа, 21:00 (GMT+5) · 90 минут",
    );
    expect(
      eventPageDateLine({ ...VIEW, format: "hybrid" }, undefined, zone),
    ).toBe("28 августа, 21:00 (GMT+5) · 90 минут");
    expect(
      eventPageDateLine({ ...VIEW, format: "offline" }, undefined, zone),
    ).toBe("28 августа, 19:00 (МСК) · 90 минут");
    expect(eventPageTimeParts(VIEW, zone)).toEqual({
      time: "21:00",
      date: "28 августа",
      dateWithYear: "28 августа 2026",
      weekday: "пятница",
      zoneLabel: "GMT+5",
    });
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

  it("020 EARS-4.3: an event that credits nothing gets NO НМО chip and no substitute row", () => {
    // `nmo: false` reads as silence (LD-8): no «без НМО», no greyed placeholder.
    expect(eventPageChips(VIEW).some((chip) => chip.includes("НМО"))).toBe(
      false,
    );
    const rows =
      eventSignupCardProps(VIEW, REGISTER_CTA, GUEST).conditions ?? [];
    expect(rows.some((row) => row.label === "НМО")).toBe(false);
    expect(rows[0]).toEqual({
      label: "Участие",
      value: "Бесплатно для врача",
      tone: "success",
    });
  });

  it("020 EARS-4.5: an accredited event carries the НМО chip LAST, after the specialties", () => {
    // Canvas:52 — the badge is the only headline-adjacent place НМО may appear
    // (EARS-14); it never becomes the title and never leads the chip row.
    expect(eventPageChips({ ...VIEW, nmo: true })).toEqual([
      "Травматология и ортопедия",
      "Ортобиология",
      "НМО",
    ]);
  });

  it("020 EARS-1: the sign-up card renders the server CTA verbatim and never re-resolves it", () => {
    const props = eventSignupCardProps(VIEW, REGISTER_CTA, GUEST);
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
      presenceCount: null,
    };
    expect(eventSignupCardProps(VIEW, soldOut, GUEST).cta).toEqual(soldOut);
  });

  it("020 EARS-5: a guest on the register state reads the return footnote under «Участвовать» (#3307)", () => {
    // event-page.dc.html `ctaGuest` — the guest is the one viewer the footnote
    // speaks to: the press sends them through 021 and back to this page.
    expect(eventSignupCardProps(VIEW, REGISTER_CTA, GUEST).note).toBe(
      EVENT_PAGE_COPY.signupNote,
    );
    expect(
      eventSignupCardProps({ ...VIEW, pulCost: 50 }, REGISTER_CTA, GUEST).note,
    ).toBe(EVENT_PAGE_COPY.signupNote);
  });

  it("020 EARS-5: a signed-in, not-registered doctor reads the event's own Pul cost instead of the guest footnote (#3307)", () => {
    // event-page.dc.html `ctaJoin` — no registration detour is coming, so the
    // guest's «вернём вас на эту страницу» would be untrue. The cost is the
    // event's real `pulCost`, never the canvas's sample 50.
    expect(
      eventSignupCardProps({ ...VIEW, pulCost: 250 }, REGISTER_CTA, SIGNED_IN)
        .note,
    ).toBe("Спишем 250 Pul при записи.");
    expect(
      eventSignupCardProps({ ...VIEW, pulCost: 50 }, REGISTER_CTA, SIGNED_IN)
        .note,
    ).toBe("Спишем 50 Pul при записи.");
  });

  it("020 EARS-5: a signed-in doctor on a zero-cost event gets no footnote at all (#3307)", () => {
    // Nothing is debited, so there is no sentence to say — and the zero cost is
    // never restated as money wording under the control.
    const card = eventSignupCardProps(
      { ...VIEW, pulCost: 0 },
      REGISTER_CTA,
      SIGNED_IN,
    );
    expect(card.note).toBeUndefined();
  });

  it("020 EARS-5: no pre-start reminder or e-mail promise is made to a signed-in doctor (#3307, wave 2 #2040)", () => {
    const note =
      eventSignupCardProps({ ...VIEW, pulCost: 50 }, REGISTER_CTA, SIGNED_IN)
        .note ?? "";
    expect(note).not.toMatch(/напомн|почт|ссылк/iu);
  });

  it("020 EARS-5: registered, sold-out, closed and room states carry no footnote for any viewer (#1764, #3307)", () => {
    for (const cta of [
      {
        action: "registered",
        label: "Вы записаны",
        href: null,
        reason: null,
        presenceCount: null,
      },
      {
        action: "sold-out",
        label: "Мест нет",
        href: null,
        reason: null,
        presenceCount: null,
      },
      {
        action: "unavailable",
        label: "Участие недоступно",
        href: null,
        reason: "Событие завершилось",
        presenceCount: null,
      },
      {
        action: "enter-room",
        label: "Войти в эфир",
        href: "/room/prp-gonartroz",
        reason: null,
        presenceCount: 4,
      },
    ] satisfies ParticipationCta[]) {
      // A footnote about registering would contradict the words above it.
      for (const viewer of [GUEST, SIGNED_IN]) {
        expect(
          eventSignupCardProps({ ...VIEW, pulCost: 50 }, cta, viewer).note,
        ).toBeUndefined();
      }
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
    expect(eventSignupCardProps(VIEW, REGISTER_CTA, GUEST).conditions).toEqual([
      { label: "Участие", value: "Бесплатно для врача", tone: "success" },
      { label: "Формат", value: "Онлайн · комната эфира" },
      { label: "Длительность", value: "90 минут" },
    ]);
  });

  it("020 EARS-4.4: a non-zero cost reads as Pul attention points, in the default tone", () => {
    // Pul are attention points, never roubles, and a cost is a neutral fact
    // rather than good news — only the FREE reading earns the success accent.
    const rows =
      eventSignupCardProps({ ...VIEW, pulCost: 250 }, REGISTER_CTA, GUEST)
        .conditions ?? [];
    expect(rows[0]).toEqual({ label: "Участие", value: "250 Pul" });
    expect(rows.filter((row) => row.tone === "success")).toHaveLength(0);
    expect(
      rows.some(
        (row) => typeof row.value === "string" && /₽|руб/i.test(row.value),
      ),
    ).toBe(false);
  });

  it("020 EARS-4.5: the НМО row is the FOURTH condition, right after Длительность", () => {
    expect(
      eventSignupCardProps({ ...VIEW, nmo: true }, REGISTER_CTA, GUEST)
        .conditions,
    ).toEqual([
      { label: "Участие", value: "Бесплатно для врача", tone: "success" },
      { label: "Формат", value: "Онлайн · комната эфира" },
      { label: "Длительность", value: "90 минут" },
      { label: "НМО", value: "Баллы начисляются" },
    ]);
  });

  it("020 EARS-4.6: the conditions are the canvas rows and never a fifth kind of row", () => {
    // Canvas:181-198 is the closed set. A row the canvas does not carry would
    // be a new product statement made in a mapper.
    const labels = (view: EventPageView) =>
      (eventSignupCardProps(view, REGISTER_CTA, GUEST).conditions ?? []).map(
        (row) => row.label,
      );
    expect(labels(VIEW)).toEqual(["Участие", "Формат", "Длительность"]);
    expect(labels({ ...VIEW, nmo: true, pulCost: 250 })).toEqual([
      "Участие",
      "Формат",
      "Длительность",
      "НМО",
    ]);
  });

  it("020 EARS-1: only the price row carries the success accent (#1779)", () => {
    const rows =
      eventSignupCardProps(VIEW, REGISTER_CTA, GUEST).conditions ?? [];
    expect(rows.filter((row) => row.tone === "success")).toHaveLength(1);
    expect(rows[0]?.tone).toBe("success");
  });

  it("020 EARS-1: an offline event's format row names the format without a room (#1779)", () => {
    const rows =
      eventSignupCardProps({ ...VIEW, format: "offline" }, REGISTER_CTA, GUEST)
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

  it("020 EARS-1: speakers map from the expert projection with one section heading", () => {
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
    // A speaker with no photo degrades to initials rather than to a broken image.
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

  it("020 EARS-18: a host copy override changes words, never the mapping shape", () => {
    const doctorCopy = { ...EVENT_PAGE_COPY, priceFree: "бесплатно" };
    const shared = eventSignupCardProps(VIEW, REGISTER_CTA, GUEST);
    const doctor = eventSignupCardProps(VIEW, REGISTER_CTA, GUEST, doctorCopy);
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

    // A host that HAS the routes: only the speaker whose key is listed links,
    // the other one never does, and the kicker becomes a link.
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
      links: {
        speakerPages: [{ speakerKey: "someone-else", href: "/experts/x" }],
      },
    };
    expect(
      eventSpeakerCards(stale).every((card) => card.href === undefined),
    ).toBe(true);
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

/**
 * Wave-3 PR 3.3 (#2072) — the format block per format (020 EARS-8, gate rows
 * 41, 33), the seats-exhausted switch (EARS-9, row 34), the social proof
 * (EARS-3, row 36), the ended meta row's viewers count (H2, row 43) and the
 * ended card's conditions (#2072 comment 6217460822).
 */
describe("020 wave-3 PR 3.3 — format, seats, social proof, viewers", () => {
  const SWITCH_CTA: ParticipationCta = {
    action: "switch-to-online",
    label: "Участвовать онлайн",
    href: "/register?returnTo=%2Fwebinars%2Fprp-gonartroz",
    reason: null,
    presenceCount: null,
  };

  it("020 EARS-8: an offline event renders the remaining seats, and no ticket or QR", () => {
    const block = eventFormatBlockProps({
      ...VIEW,
      format: "offline",
      seatsLeft: 12,
    });
    expect(block).toEqual({
      kind: "offline",
      heading: EVENT_PAGE_COPY.formatHeading.offline,
      seatsLine: "Осталось 12 мест",
    });
    expect(JSON.stringify(block)).not.toMatch(/билет|QR/iu);
  });

  it("020 EARS-8: the seats line agrees in number", () => {
    const line = (seatsLeft: number) => {
      const block = eventFormatBlockProps({
        ...VIEW,
        format: "offline",
        seatsLeft,
      });
      return block?.kind === "offline" ? block.seatsLine : null;
    };
    expect(line(1)).toBe("Осталось 1 место");
    expect(line(3)).toBe("Осталось 3 места");
    expect(line(21)).toBe("Осталось 21 место");
    expect(line(0)).toBe("Мест не осталось");
  });

  it("020 EARS-19: an offline event with no seat limit renders no empty format block", () => {
    expect(
      eventFormatBlockProps({ ...VIEW, format: "offline", seatsLeft: null }),
    ).toBeNull();
  });

  it("020 EARS-8: a hybrid event carries both halves as tabs, defaulting to «очно» while seats remain", () => {
    const block = eventFormatBlockProps(
      { ...VIEW, format: "hybrid", seatsLeft: 12 },
      REGISTER_CTA,
    );
    expect(block).toMatchObject({
      kind: "hybrid",
      defaultMode: "offline",
      tabs: { offline: "Очно", online: "Онлайн" },
      seatsLine: "Осталось 12 мест",
      room: { roomOpensLine: EVENT_PAGE_COPY.roomOpensLine },
      statement: null,
    });
  });

  it("020 EARS-9: a hybrid event with no seats opens on «онлайн» and says why", () => {
    const block = eventFormatBlockProps(
      { ...VIEW, format: "hybrid", seatsLeft: 0 },
      SWITCH_CTA,
    );
    expect(block).toMatchObject({
      kind: "hybrid",
      defaultMode: "online",
      seatsLine: "Мест не осталось",
      statement: {
        title: EVENT_PAGE_COPY.hybridSoldOut.title,
        body: EVENT_PAGE_COPY.hybridSoldOut.body,
      },
    });
  });

  it("020 EARS-8: a hybrid event with no seat limit renders the online half alone, never an empty «очно» tab", () => {
    expect(
      eventFormatBlockProps({ ...VIEW, format: "hybrid", seatsLeft: null }),
    ).toMatchObject({ kind: "online" });
  });

  it("020 EARS-19: «Комната эфира откроется…» renders only before the start", () => {
    const live = eventFormatBlockProps({ ...VIEW, state: "live" });
    expect(live).toEqual({
      kind: "online",
      heading: EVENT_PAGE_COPY.formatHeading.online,
      duringLine: EVENT_PAGE_COPY.duringLine,
    });
    for (const state of ["ended", "hidden"] as const) {
      for (const format of ["online", "offline", "hybrid"] as const) {
        expect(
          eventFormatBlockProps({ ...VIEW, state, format, seatsLeft: 4 }),
        ).toBeNull();
      }
    }
  });

  it("020 EARS-3: the social proof states the total and, separately, the adjacent specialties", () => {
    expect(
      eventSocialProof({
        ...VIEW,
        signUps: { total: 51, sameSpecialty: 37, adjacentSpecialties: 14 },
      }),
    ).toEqual({
      total: "Уже записался 51 коллега",
      adjacent: "в том числе 14 врачей смежных специальностей",
    });
    expect(
      eventSocialProof({
        ...VIEW,
        signUps: { total: 3, sameSpecialty: 1, adjacentSpecialties: 2 },
      }),
    ).toEqual({
      total: "Уже записались 3 коллеги",
      adjacent: "в том числе 2 врача смежных специальностей",
    });
  });

  it("020 EARS-3: no adjacent line at zero adjacent sign-ups, no proof at all without sign-ups or on an ended page", () => {
    expect(
      eventSocialProof({
        ...VIEW,
        signUps: { total: 12, sameSpecialty: 12, adjacentSpecialties: 0 },
      }),
    ).toEqual({ total: "Уже записались 12 коллег", adjacent: null });
    expect(eventSocialProof({ ...VIEW, signUps: null })).toBeNull();
    expect(
      eventSocialProof({
        ...VIEW,
        state: "ended",
        signUps: { total: 12, sameSpecialty: 12, adjacentSpecialties: 0 },
      }),
    ).toBeNull();
  });

  it("020 H2: the ended meta row reads «Смотрели N коллег» from the read, and nothing when it is absent", () => {
    expect(eventViewersMeta({ ...VIEW, state: "ended", viewers: 214 })).toEqual(
      { label: "Смотрели", value: "214 коллег" },
    );
    expect(eventViewersMeta({ ...VIEW, state: "ended", viewers: 1 })).toEqual({
      label: "Смотрели",
      value: "1 коллега",
    });
    expect(
      eventViewersMeta({ ...VIEW, state: "ended", viewers: null }),
    ).toBeNull();
  });

  it("020 H2: the ended meta row states «Эфир прошёл» with the event's date and year, and nothing before the end", () => {
    expect(eventAiredMeta({ ...VIEW, state: "ended" })).toEqual({
      label: "Эфир прошёл",
      value: "28 августа 2026",
    });
    expect(eventAiredMeta({ ...VIEW, state: "published" })).toBeNull();
    expect(eventAiredMeta({ ...VIEW, state: "live" })).toBeNull();
    expect(eventPageTimeParts(VIEW).dateWithYear).toBe("28 августа 2026");
  });

  it("020 EARS-19: the ended sign-up card carries no participation-cost row — never «Бесплатно для врача»", () => {
    const UNAVAILABLE: ParticipationCta = {
      action: "unavailable",
      label: "Участие недоступно",
      href: null,
      reason: "Событие завершилось",
      presenceCount: null,
    };
    for (const pulCost of [0, 50]) {
      const card = eventSignupCardProps(
        { ...VIEW, state: "ended", pulCost },
        UNAVAILABLE,
        GUEST,
      );
      expect(card.conditions?.map((row) => row.label)).not.toContain(
        EVENT_PAGE_COPY.conditionPrice,
      );
      expect(JSON.stringify(card)).not.toMatch(/бесплатн|Pul/iu);
    }
  });
});
