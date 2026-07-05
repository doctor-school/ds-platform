import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert, AlertTitle, AlertDescription, alertVariants } from "./alert";

afterEach(cleanup);

/**
 * Alert / callout — info / success / warn / danger. Neo-brutalist 2px border +
 * tinted surface + a leading status icon. Tests pin the role, the per-variant
 * token classes, and that the decorative icon is hidden from the a11y tree.
 */
describe("Alert", () => {
  it("has role=alert and renders title + description", () => {
    render(
      <Alert variant="info">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>The webinar starts in 10 minutes.</AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(
      screen.getByText("The webinar starts in 10 minutes."),
    ).toBeInTheDocument();
  });

  it("renders a decorative status icon hidden from assistive tech", () => {
    const { container } = render(<Alert variant="danger">Boom</Alert>);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("maps each variant to its status token, with a 2px border and no arbitrary values", () => {
    const cases: Record<string, RegExp> = {
      info: /border-primary-action/,
      success: /border-success/,
      warn: /border-warning/,
      danger: /border-destructive/,
    };
    for (const [variant, re] of Object.entries(cases)) {
      const cls = alertVariants({
        variant: variant as "info" | "success" | "warn" | "danger",
      });
      expect(cls).toMatch(re);
      expect(cls).toMatch(/border-2/);
      expect(cls).not.toMatch(/\[#/);
    }
  });
});
