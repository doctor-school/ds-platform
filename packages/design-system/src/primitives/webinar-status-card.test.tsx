import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WebinarStatusCard } from "./webinar-status-card";

afterEach(cleanup);

/**
 * Neo-brutalist event-page status card (004 EARS-4, source
 * `design-source/webinar-page.dc.html`). The lifecycle affordance the public
 * event page swaps per state: the webinar-card time-plate geometry + a head/sub
 * signal + a single primary-CTA slot. Off-scale canvas geometry (196px time
 * column, 56px time, 2px border, 6px cast) lives here in the design-system SoT.
 * jsdom pins the time-plate content contract, the live signal, and the CTA-slot
 * present/absent swap (the `ended` render carries NO CTA — no dead link).
 */
const BASE = {
  timeLabel: "Начало",
  time: "19:00",
  timeSub: "16 июля · МСК · 90 мин",
  head: "Регистрация открыта",
  sub: "Бесплатно. Пришлём ссылку на почту.",
};

describe("004 EARS-4 WebinarStatusCard — time plate + signal", () => {
  it("EARS-4: when the page renders the status card, the system shall show the time plate — label, time, and the МСК sub-label", () => {
    render(<WebinarStatusCard {...BASE} />);
    expect(screen.getByText("Начало")).toBeInTheDocument();
    expect(screen.getByText("19:00")).toBeInTheDocument();
    expect(screen.getByText("16 июля · МСК · 90 мин")).toBeInTheDocument();
    expect(screen.getByText("Регистрация открыта")).toBeInTheDocument();
  });

  it("EARS-4: when the event is live, the system shall surface the «В эфире» live signal", () => {
    render(
      <WebinarStatusCard
        {...BASE}
        live
        liveLabel="В эфире"
        head="Эфир уже идёт"
      />,
    );
    expect(screen.getByText("В эфире")).toBeInTheDocument();
  });

  it("EARS-4: when the event is not live, the system shall show no live signal", () => {
    render(<WebinarStatusCard {...BASE} liveLabel="В эфире" />);
    expect(screen.queryByText("В эфире")).toBeNull();
  });
});

describe("004 EARS-4 WebinarStatusCard — CTA slot swap", () => {
  it("EARS-4: when a participation CTA is provided, the system shall render it in the card", () => {
    render(
      <WebinarStatusCard {...BASE}>
        <a href="/register?returnTo=/webinars/x">Участвовать</a>
      </WebinarStatusCard>,
    );
    const cta = screen.getByRole("link", { name: "Участвовать" });
    expect(cta).toHaveAttribute("href", "/register?returnTo=/webinars/x");
  });

  it("EARS-4: when the ended render passes no CTA, the system shall render no participation link (no dead CTA)", () => {
    render(
      <WebinarStatusCard {...BASE} timeLabel="Прошёл" head="Эфир завершён" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("004 EARS-14 WebinarStatusCard — geometry + tokens", () => {
  it("EARS-14: the desktop split is the 196px time-plate grid on a bordered, raised card", () => {
    const { container } = render(<WebinarStatusCard {...BASE} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("layout:grid-cols-[196px_1fr]");
    expect(card.className).toContain("layout:border-2");
    expect(card.className).toContain("layout:shadow-lg");
    expect(card.className).toContain("bg-card");
  });

  it("EARS-14: the time plate uses the tint surface and the 56px display time token", () => {
    render(<WebinarStatusCard {...BASE} />);
    const time = screen.getByText("19:00");
    expect(time.className).toContain("layout:text-4xl");
    expect(time.className).toContain("tabular-nums");
  });
});
