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
    // The title is reachable inside that link (the card is the affordance).
    expect(within(link).getByText(BASE.title)).toBeInTheDocument();
  });

  it("EARS-8: renders no specialty chip row when there are no specialties", () => {
    const { container } = render(
      <WebinarCard {...BASE} specialties={[]} />,
    );
    // The two seed chips are gone; the title still renders.
    expect(screen.queryByText("Травматология")).toBeNull();
    expect(screen.getByText(BASE.title)).toBeInTheDocument();
    expect(container.querySelector("a")).not.toBeNull();
  });
});

describe("WebinarCard — geometry + tokens (EARS-14)", () => {
  it("EARS-14: the desktop split is the 196px time-plate grid on a bordered, raised card", () => {
    render(<WebinarCard {...BASE} />);
    const link = screen.getByRole("link");
    // 196px time column + 1fr content, only at the layout (>900px) breakpoint.
    expect(link.className).toContain("layout:grid-cols-[196px_1fr]");
    // 2px structural border + the 6px elevation cast, token-only.
    expect(link.className).toContain("layout:border-2");
    expect(link.className).toContain("layout:shadow-lg");
    expect(link.className).toContain("bg-card");
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
