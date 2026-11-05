import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusPage } from "./status-page";

afterEach(cleanup);

/**
 * `<StatusPage>` (#2478) — the platform's ONE error page (canvas
 * `design-source/sign-in-refusal.dc.html`): a centred heading, one line and
 * the actions. Every error or absence case is a state of it with its own copy.
 */
describe("<StatusPage>", () => {
  it("renders the heading as the page h1, the line under it and the actions", () => {
    render(
      <StatusPage
        title="Заголовок состояния"
        text="Строка состояния."
        actions={<a href="/">Действие</a>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Заголовок состояния",
    );
    expect(screen.getByText("Строка состояния.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Действие" })).toHaveAttribute("href", "/");
  });

  it("lays the actions out in a row on wide screens unless asked to stack them", () => {
    const { rerender } = render(
      <StatusPage title="t" text="x" actions={<a href="/">a</a>} />,
    );
    const actions = () => screen.getByRole("link").parentElement!;
    expect(actions().className).toContain("lg:flex-row");
    rerender(<StatusPage title="t" text="x" actionsLayout="stack" actions={<a href="/">a</a>} />);
    expect(actions().className).not.toContain("lg:flex-row");
  });
});
