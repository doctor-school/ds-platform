// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { CalendarShell } from "./calendar-shell";

afterEach(cleanup);

/**
 * 004 owner verdict #3 on #1052 — the STATIC discovery shell shared by the
 * «Неделя» and «Месяц» panes. The component contract: it renders the poster hero
 * (h1 + subtitle + tagline), a toolbar slot, and the pane children, all inside the
 * wide `calendar` content column (1240px) so both panes share one geometry. The
 * pixel-parity across a view round-trip is the Playwright static-shell pin.
 */
describe("<CalendarShell>", () => {
  it("verdict #3: renders the hero copy, the toolbar slot, and the children", () => {
    render(
      <CalendarShell
        title="Июль 2026"
        subtitle="12 эфиров · 4 школы · время — МСК"
        taglineTop="Врачи учат"
        taglineBottom="Врачи учат врачей"
        toolbar={<div data-testid="toolbar-slot">controls</div>}
      >
        <div data-testid="pane-body">pane</div>
      </CalendarShell>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Июль 2026",
    );
    expect(
      screen.getByText("12 эфиров · 4 школы · время — МСК"),
    ).toBeInTheDocument();
    expect(screen.getByText("Врачи учат врачей")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-slot")).toBeInTheDocument();
    expect(screen.getByTestId("pane-body")).toBeInTheDocument();
  });

  it("verdict #3: places the toolbar + children in the wide calendar content column", () => {
    const { container } = render(
      <CalendarShell
        title="Июль 2026"
        subtitle="sub"
        taglineTop="a"
        taglineBottom="b"
        toolbar={<div data-testid="toolbar-slot">controls</div>}
      >
        <div data-testid="pane-body">pane</div>
      </CalendarShell>,
    );
    // The body column is the `calendar` Container (1240px content), not the
    // default 1104px — so the «Неделя ⇄ Месяц» round-trip never jumps the edges.
    const body = screen.getByTestId("pane-body").closest('[class*="max-w-calendar"]');
    expect(body).not.toBeNull();
    expect(body).toContainElement(screen.getByTestId("toolbar-slot"));
    // No default-width column is used for the shared shell.
    expect(container.querySelector('[class*="max-w-content"]')).toBeNull();
  });
});
