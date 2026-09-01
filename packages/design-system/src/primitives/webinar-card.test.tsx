import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WebinarCard } from "./webinar-card";

afterEach(cleanup);

/**
 * Neo-brutalist webinar listing card (004 EARS-8, source
 * `design-source/webinar-card.dc.html`). The reusable listing UNIT: a
 * time-plate + content grid that carries the `UpcomingBroadcastCard` choose-set
 * (date + time МСК, school kicker, title, specialty chips, speakers) and links
 * the whole card to its event page. Off-scale canvas geometry (196px time
 * column, 56px time) lives here in the design-system SoT, not in app code
 * (the arbitrary-value + rhythm gates are app-scoped). jsdom pins the content
 * contract + the block-link + the live signal.
 */

const BASE = {
  href: "/webinars/ahilles-plastika",
  time: "19:00",
  tzLabel: "МСК",
  dateLabel: "16 июля · ср",
  school: "Школа травматологии и ортопедии",
  title: "Пластика ахиллова сухожилия: разбор клинических случаев",
  specialties: ["Травматология", "Ортопедия"],
  speakers: [{ name: "Анна Соколова" }, { name: "Михаил Верещагин" }],
};

describe("WebinarCard — content set (EARS-8)", () => {
  it("EARS-8: carries the full choose-set — time+МСК, date, school, title, specialties, speakers", () => {
    render(<WebinarCard {...BASE} />);
    expect(screen.getByText("19:00")).toBeInTheDocument();
    expect(screen.getByText("МСК")).toBeInTheDocument();
    expect(screen.getByText("16 июля · ср")).toBeInTheDocument();
    expect(screen.getByText(BASE.school)).toBeInTheDocument();
    expect(screen.getByText(BASE.title)).toBeInTheDocument();
    // Both specialties render as chips.
    expect(screen.getByText("Травматология")).toBeInTheDocument();
    expect(screen.getByText("Ортопедия")).toBeInTheDocument();
    // Both speakers render by name.
    expect(screen.getByText("Анна Соколова")).toBeInTheDocument();
    expect(screen.getByText("Михаил Верещагин")).toBeInTheDocument();
  });

  it("EARS-8: the whole card is a single link to the event page", () => {
    render(<WebinarCard {...BASE} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", BASE.href);
    // The title is the accessible label of that (stretched) link, and the whole
    // card is the affordance (the link's `::after` overlays the card).
    expect(within(link).getByText(BASE.title)).toBeInTheDocument();
  });

  it("EARS-8: renders no specialty chip row when there are no specialties", () => {
    const { container } = render(<WebinarCard {...BASE} specialties={[]} />);
    // The two seed chips are gone; the title still renders.
    expect(screen.queryByText("Травматология")).toBeNull();
    expect(screen.getByText(BASE.title)).toBeInTheDocument();
    expect(container.querySelector("a")).not.toBeNull();
  });
});

describe("WebinarCard — geometry + tokens (EARS-14)", () => {
  it("EARS-14: the desktop split is the 196px time-plate grid on a bordered, raised card", () => {
    const { container } = render(<WebinarCard {...BASE} />);
    // The geometry lives on the card ROOT container (the canvas `div`, not the
    // stretched title link) — the card is no longer a whole-card anchor.
    const root = container.firstElementChild as HTMLElement;
    // 196px time column + 1fr content, only at the layout (>900px) breakpoint.
    expect(root.className).toContain("layout:grid-cols-[196px_1fr]");
    // 2px structural border + the 6px elevation cast, token-only.
    expect(root.className).toContain("layout:border-2");
    expect(root.className).toContain("layout:shadow-lg");
    expect(root.className).toContain("bg-card");
  });

  it("EARS-14: the time plate uses the tint surface and the 56px display time token", () => {
    render(<WebinarCard {...BASE} />);
    const time = screen.getByText("19:00");
    // 56px desktop time = text-4xl token (40px mobile = text-3xl).
    expect(time.className).toContain("text-4xl");
    expect(time.className).toContain("tabular-nums");
  });
});

describe("004 EARS-8 WebinarCard — registered variant (canvas `registered`)", () => {
  it("EARS-8: the registered variant surfaces the «Вы записаны» marker — success-hued ✓ + AA ink label", () => {
    render(<WebinarCard {...BASE} registered registeredLabel="Вы записаны" />);
    const marker = screen.getByText("Вы записаны");
    expect(marker).toBeInTheDocument();
    // The #270 AA remap: the LABEL is card-safe ink (canvas green.500 is 3.68:1
    // on the light card — sub-AA); only the decorative ✓ keeps the success hue.
    expect(marker.className).toContain("text-foreground");
    const glyph = marker.querySelector("[aria-hidden]");
    expect(glyph?.className).toContain("text-success");
    // An at-a-glance state signal, not decoration — mirrors the live signal.
    expect(marker.getAttribute("role")).toBe("status");
  });

  it("EARS-8: an unregistered card carries no registered marker", () => {
    render(<WebinarCard {...BASE} registeredLabel="Вы записаны" />);
    expect(screen.queryByText("Вы записаны")).toBeNull();
  });

  it("EARS-8: the marker never renders without its catalog label (no hardcoded copy)", () => {
    const { container } = render(<WebinarCard {...BASE} registered />);
    // No label prop → no marker element at all (copy comes from the catalog,
    // EARS-13 — the component ships no user-facing string of its own).
    expect(container.querySelector("[data-registered-marker]")).toBeNull();
  });
});

describe("WebinarCard — live variant (EARS-9)", () => {
  it("EARS-9: the live variant surfaces the «В эфире» signal", () => {
    render(<WebinarCard {...BASE} live liveLabel="В эфире" />);
    // The live label appears (desktop sticker / mobile inline tag share the copy).
    expect(screen.getAllByText("В эфире").length).toBeGreaterThan(0);
  });

  it("EARS-9: a scheduled card shows no live signal", () => {
    render(<WebinarCard {...BASE} liveLabel="В эфире" />);
    expect(screen.queryByText("В эфире")).toBeNull();
  });
});

describe("014 EARS-11 WebinarCard — archive variant", () => {
  it("EARS-11: the past canvas variant is muted and exposes an explicit recording CTA", () => {
    const { container } = render(
      <WebinarCard
        {...BASE}
        variant="past"
        recordingLabel="Запись готовится"
        ctaHref={BASE.href}
        ctaLabel="Смотреть запись ↗"
      />,
    );

    expect(container.firstElementChild?.className).toContain("opacity-80");
    expect(screen.getByText("Запись готовится")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Смотреть запись ↗" }),
    ).toHaveAttribute("href", BASE.href);
  });
});

/**
 * 006 EARS-6 — the «мои события» room-entry front door on the listing card. On a
 * registered + `live` event the card hosts a secondary room-entry CTA («Войти в
 * эфир», routing to `/webinars/:slug/room`) ALONGSIDE the whole-card link to the
 * event page. The canvas (`webinar-card.dc.html`) never nests that CTA inside the
 * card link — the card root is a container, the title is a stretched link, and the
 * CTA is a sibling — so the affordance is added without an anchor nested in an
 * anchor (an invalid, a11y-hostile structure). The CTA copy is caller-injected
 * (catalog-sourced, EARS-10) — the primitive ships no user-facing string.
 */
describe("006 EARS-6 WebinarCard — room-entry CTA slot (no nested anchor)", () => {
  const LIVE = { ...BASE, live: true, liveLabel: "В эфире" } as const;
  const ROOM = "/webinars/ahilles-plastika/room";

  it("EARS-6: renders the room-entry CTA linking to the room when ctaHref + ctaLabel are given", () => {
    render(<WebinarCard {...LIVE} ctaHref={ROOM} ctaLabel="Войти в эфир" />);
    const cta = screen.getByRole("link", { name: "Войти в эфир" });
    expect(cta).toHaveAttribute("href", ROOM);
  });

  it("EARS-6: the room CTA is a SIBLING of the event-page link — never an anchor nested inside another anchor", () => {
    const { container } = render(
      <WebinarCard {...LIVE} ctaHref={ROOM} ctaLabel="Войти в эфир" />,
    );
    // No anchor anywhere in the card is a descendant of another anchor.
    for (const anchor of Array.from(container.querySelectorAll("a"))) {
      expect(anchor.parentElement?.closest("a")).toBeNull();
    }
  });

  it("EARS-6: with a CTA the card exposes exactly two links — the event page and the room — both reachable", () => {
    render(<WebinarCard {...LIVE} ctaHref={ROOM} ctaLabel="Войти в эфир" />);
    const hrefs = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(hrefs).toHaveLength(2);
    expect(hrefs).toContain(BASE.href); // the stretched card link → event page
    expect(hrefs).toContain(ROOM); // the room-entry CTA
  });

  it("EARS-6: renders no CTA without its catalog label (no dead control, no hardcoded copy)", () => {
    render(<WebinarCard {...LIVE} ctaHref={ROOM} />);
    // Only the card's own event-page link — no CTA element without its label.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("EARS-6: a card given no ctaHref stays a single link (back-compat listing card)", () => {
    render(<WebinarCard {...BASE} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

/**
 * 019 EARS-2 — the shared card widened to the full doctor-feed format
 * vocabulary. This is the spec's Verification row 2: the route-independent
 * shared-card proof (all five formats distinguishable, sign-up count in every
 * state, offline city and seats, zero cost as «бесплатно для врача», no rouble
 * string). Route mounting and screen-local tree checks belong to #1516.
 */
const FORMAT_KICKERS = [
  "Вебинар",
  "Разбор",
  "Doctor Club",
  "Подкаст",
  "Конгресс",
] as const;

const FEED = {
  ...BASE,
  formatLabel: "Вебинар",
  venueLabel: "Онлайн",
  nmoLabel: "НМО · 2 ЗЕТ",
  pulCost: 120,
  pulCostLabel: "120 Pul",
  freeLabel: "бесплатно для врача",
  signUpCount: 128,
  signUpLabel: "коллег записались",
};

describe("019 EARS-2 WebinarCard — the five formats", () => {
  it("019 EARS-2.1: each of the five formats reads from the time-plate kicker, per the canvas card contract", () => {
    const kickers = new Set<string>();

    for (const kicker of FORMAT_KICKERS) {
      const { container } = render(
        <WebinarCard {...FEED} formatLabel={kicker} />,
      );
      const el = container.querySelector("[data-event-format-kicker]");
      expect(el, `no kicker rendered for «${kicker}»`).not.toBeNull();
      expect(el!.textContent).toBe(kicker);
      // The canvas card has no coloured format badge and no glyph vocabulary —
      // the format is the kicker, everything else is a text chip.
      expect(container.querySelector("[data-event-format]")).toBeNull();
      kickers.add(el!.textContent!);
      cleanup();
    }

    expect(kickers.size).toBe(5);
  });

  it("019 EARS-2.2: the format kicker never renders without its catalog label (no hardcoded copy)", () => {
    const { container } = render(<WebinarCard {...BASE} />);
    expect(container.querySelector("[data-event-format-kicker]")).toBeNull();
  });

  it("019 EARS-2.3: НМО renders as a chip only — never as the card's heading", () => {
    const { container } = render(<WebinarCard {...FEED} />);
    const chip = screen.getByText("НМО · 2 ЗЕТ");
    expect(chip.getAttribute("data-event-nmo")).toBe("");
    // It lives in the ONE chip row — not in a badge row of its own.
    expect(chip.closest("[data-event-chips]")).not.toBeNull();
    expect(container.querySelector("[data-nmo-badge]")).toBeNull();
    // The card's only heading is its title link, and it says nothing about НМО.
    expect(screen.getByRole("heading").textContent).toBe(BASE.title);
  });
});

describe("019 EARS-2 WebinarCard — cost, sign-ups, offline city and seats", () => {
  it("019 EARS-2.4: a zero Pul cost renders «бесплатно для врача» and no rouble string", () => {
    const { container } = render(<WebinarCard {...FEED} pulCost={0} />);
    expect(screen.getByText("бесплатно для врача")).toBeInTheDocument();
    expect(screen.queryByText("120 Pul")).toBeNull();
    expect(container.textContent).not.toMatch(/₽|руб/i);
  });

  it("019 EARS-2.5: a priced event reads in Pul and never in roubles", () => {
    const { container } = render(<WebinarCard {...FEED} />);
    expect(screen.getByText("120 Pul")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/₽|руб/i);
  });

  it("019 EARS-2.6: the sign-up count renders in EVERY card state", () => {
    const states = [
      { name: "normal", props: {} },
      { name: "live", props: { live: true, liveLabel: "В эфире" } },
      {
        name: "registered",
        props: { registered: true, registeredLabel: "Вы записаны" },
      },
      { name: "sold out", props: { seatsLeft: 0, soldOutLabel: "мест не осталось" } },
      {
        name: "past with a recording",
        props: {
          variant: "past" as const,
          recordingLabel: "Есть запись",
          ctaHref: BASE.href,
          ctaLabel: "Смотреть запись ↗",
        },
      },
    ];

    for (const state of states) {
      const { container } = render(<WebinarCard {...FEED} {...state.props} />);
      const count = container.querySelector("[data-signup-count]");
      expect(count, `sign-up count missing in the «${state.name}» state`)
        .not.toBeNull();
      expect(count!.textContent).toContain("128");
      cleanup();
    }
  });

  it("019 EARS-2.7: an offline event carries its city and its remaining seats", () => {
    const { container } = render(
      <WebinarCard
        {...FEED}
        formatLabel="Doctor Club"
        venueLabel="Офлайн"
        city="Казань"
        seatsLeft={12}
        seatsLeftLabel="мест осталось"
      />,
    );
    // The canvas venue chip carries the city inside it — «Офлайн · Казань».
    const venue = container.querySelector("[data-event-city]");
    expect(venue?.getAttribute("data-event-city")).toBe("Казань");
    expect(venue?.textContent).toBe("Офлайн · Казань");
    expect(container.querySelector("[data-event-seats]")?.textContent).toContain(
      "12",
    );
  });

  it("019 EARS-2.8: a hybrid congress spanning dates still carries its city and seats", () => {
    const { container } = render(
      <WebinarCard
        {...FEED}
        formatLabel="Конгресс"
        venueLabel="Гибрид"
        // The date SPAN rides the time-plate sub-label (canvas «14–15 ноября»).
        dateLabel="14–15 ноября"
        city="Москва"
        seatsLeft={40}
        seatsLeftLabel="мест осталось"
      />,
    );
    expect(screen.getByText("14–15 ноября")).toBeInTheDocument();
    expect(
      container.querySelector("[data-event-format-kicker]")?.textContent,
    ).toBe("Конгресс");
    expect(container.querySelector("[data-event-city]")?.textContent).toBe(
      "Гибрид · Москва",
    );
    expect(container.querySelector("[data-event-seats]")?.textContent).toContain(
      "40",
    );
  });

  it("019 EARS-2.9: zero remaining seats reads «мест не осталось» in the chip row, with no seat count", () => {
    const { container } = render(
      <WebinarCard
        {...FEED}
        formatLabel="Doctor Club"
        venueLabel="Офлайн"
        city="Казань"
        seatsLeft={0}
        seatsLeftLabel="мест осталось"
        soldOutLabel="мест не осталось"
      />,
    );
    const chip = screen.getByText("мест не осталось");
    expect(chip.getAttribute("data-sold-out")).toBe("");
    // It is a chip in the ONE row, not a standalone announced element.
    expect(chip.closest("[data-event-chips]")).not.toBeNull();
    expect(chip.getAttribute("role")).toBeNull();
    expect(container.querySelector("[data-event-seats]")).toBeNull();
    // A sold-out event stays readable — its event-page link is untouched.
    expect(screen.getByRole("link")).toHaveAttribute("href", BASE.href);
  });

  it("019 EARS-2.10: no rendered string states who finances the event", () => {
    const { container } = render(
      <WebinarCard
        {...FEED}
        formatLabel="Doctor Club"
        venueLabel="Офлайн"
        city="Казань"
        seatsLeft={5}
        seatsLeftLabel="мест осталось"
        registered
        registeredLabel="Вы записаны"
      />,
    );
    expect(container.textContent).not.toMatch(
      /спонсор|при поддержке|финанс|партнёр|партнер|инвестор/i,
    );
  });
});
