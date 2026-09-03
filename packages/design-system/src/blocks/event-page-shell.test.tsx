import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventPageHero, EventPageShell } from "./event-page-shell";

afterEach(cleanup);

describe("<EventPageShell>", () => {
  it("020 EARS-1: the shared shell shall lay the canvas grid out with ONE right column and no host-owned layout", () => {
    render(
      <EventPageShell
        hero={<div data-testid="hero-slot" />}
        aside={<div data-testid="aside-slot" />}
      >
        <div data-testid="flow-slot" />
      </EventPageShell>,
    );

    const main = screen.getByTestId("event-page-main");
    // The canvas grid: `1fr 360px` at gap 48 above the `layout` breakpoint,
    // one column below it, lifted -80px into the poster band.
    expect(main.className).toContain("layout:grid-cols-[1fr_360px]");
    expect(main.className).toContain("layout:gap-12");
    expect(main.className).toContain("grid-cols-1");
    expect(main.className).toContain("-mt-20");
    expect(main.className).toContain("max-w-content");
    expect(screen.getByTestId("hero-slot")).toBeInTheDocument();
    expect(screen.getByTestId("aside-slot")).toBeInTheDocument();
    expect(screen.getByTestId("flow-slot")).toBeInTheDocument();
  });

  it("020 EARS-19: the sign-up column shall read FIRST on the narrow canvas and second on the wide one", () => {
    render(<EventPageShell aside={<div />}>flow</EventPageShell>);

    const aside = screen.getByTestId("event-page-aside");
    expect(aside.className).toContain("order-first");
    expect(aside.className).toContain("layout:order-none");
  });

  it("020 EARS-1: the hero shall render host copy and slots without inventing any of its own", () => {
    render(
      <EventPageHero
        breadcrumb={<a href="/events">События</a>}
        kicker="Школа ортобиологии · Вебинар · Онлайн"
        title="PRP при гонартрозе"
        dateLine="28 августа, 19:00 (МСК) · 90 минут"
        chips={["Травматология и ортопедия", "НМО 2 балла"]}
        statusPlate={<span>Скоро · через 5 дней</span>}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "PRP при гонартрозе" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("28 августа, 19:00 (МСК) · 90 минут"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "События" })).toBeInTheDocument();
    expect(screen.getByTestId("event-page-hero-chips").children).toHaveLength(2);
    expect(screen.getByText("Скоро · через 5 дней")).toBeInTheDocument();
  });

  it("020 EARS-1: the hero shall omit the breadcrumb, chip row and status plate a host does not supply", () => {
    render(<EventPageHero kicker="k" title="t" dateLine="d" />);

    expect(screen.queryByTestId("event-page-hero-breadcrumb")).toBeNull();
    expect(screen.queryByTestId("event-page-hero-chips")).toBeNull();
    expect(screen.queryByTestId("event-page-hero-status")).toBeNull();
  });
});
