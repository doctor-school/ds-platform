import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert, alertVariants } from "./alert";

afterEach(cleanup);

/**
 * Neo-brutalist alert / callout (#513, source §08). Four semantic variants: a 2px
 * border in the semantic colour on a tint surface, a leading icon in the semantic
 * colour, ink body copy. `role=status` (info/success) vs `role=alert` (warn/danger).
 * The danger variant paints the invariant `live` red (source keeps #C81E1E in both
 * themes), not the theme-flipping `destructive`. Token-only, both themes.
 */
describe("Alert — variant token contract (#513)", () => {
  it("info: brand-accent border on the tint surface", () => {
    expect(alertVariants({ variant: "info" })).toMatch(/border-info/);
    expect(alertVariants({ variant: "info" })).toMatch(/bg-tint/);
  });
  it("success: green border on the success tint", () => {
    expect(alertVariants({ variant: "success" })).toMatch(/border-success/);
    expect(alertVariants({ variant: "success" })).toMatch(/bg-success-tint/);
  });
  it("warn: amber border on the warning tint", () => {
    expect(alertVariants({ variant: "warn" })).toMatch(/border-warning/);
    expect(alertVariants({ variant: "warn" })).toMatch(/bg-warning-tint/);
  });
  it("danger: invariant live-red border on the danger tint (not destructive)", () => {
    const cls = alertVariants({ variant: "danger" });
    expect(cls).toMatch(/border-live/);
    expect(cls).toMatch(/bg-destructive-tint/);
    expect(cls).not.toMatch(/border-destructive\b/);
  });
  it("every variant is a hard 2px square frame with ink body copy", () => {
    for (const variant of ["info", "success", "warn", "danger"] as const) {
      const cls = alertVariants({ variant });
      expect(cls).toMatch(/border-2/);
      expect(cls).not.toMatch(/\brounded-/);
    }
  });
});

describe("Alert — a11y role + leading icon (#513)", () => {
  it("info/success announce politely (role=status)", () => {
    render(<Alert variant="success">Вы записаны на эфир.</Alert>);
    const el = screen.getByRole("status");
    expect(el).toHaveTextContent("Вы записаны на эфир.");
    // Icon is decorative — hidden from the a11y tree.
    expect(el.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("warn/danger announce assertively (role=alert), icon in the semantic colour", () => {
    render(<Alert variant="danger">Не удалось подключиться.</Alert>);
    const el = screen.getByRole("alert");
    const icon = el.querySelector('[aria-hidden="true"]');
    expect(icon).toHaveClass("text-live");
  });

  it("supports a bold lead-in inside the body", () => {
    render(
      <Alert variant="info">
        <b>Инфо.</b> Эфир начнётся через 15 минут.
      </Alert>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Инфо. Эфир начнётся через 15 минут.");
  });
});
