import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthShell } from "./auth-shell";

/**
 * `<AuthShell>` (#1666 slice C) — the shared canvas brand-panel frame both
 * storefronts project. These assertions cover the BLOCK's contract only: the
 * three-zone panel, the 021 EARS-2 `returnContext` swap (which also widens the
 * split) and the copy-as-props rule. The app-level behaviours that stay in the
 * projections — the portal #675 authenticated-redirect guard, the EARS-17
 * SmartCaptcha disclosure, `next-intl` copy — keep their own oracles at
 * `apps/portal/components/auth-shell.test.tsx` and the doctor register e2e.
 */

/** Neutral, product-free copy — every rendered panel string must come from here. */
const copy = {
  eyebrow: "copy.eyebrow",
  headline: "copy.headline",
  subcopy: "copy.subcopy",
  footer: "copy.footer",
};

afterEach(cleanup);

describe("AuthShell", () => {
  it("renders the three panel zones — mark, value prop, footer — from props", () => {
    render(
      <AuthShell
        logo={<span data-testid="form-logo">logo</span>}
        panelMark={<span data-testid="panel-mark">mark</span>}
        copy={copy}
      >
        <div data-testid="auth-form">form</div>
      </AuthShell>,
    );

    const panel = screen.getByTestId("auth-brand-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("panel-mark")).toBeInTheDocument();
    expect(screen.getByTestId("form-logo")).toBeInTheDocument();
    expect(screen.getByTestId("auth-form")).toBeInTheDocument();
    for (const value of Object.values(copy)) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
  });

  it("hardcodes no copy of its own — the panel carries only the supplied strings", () => {
    const { container } = render(
      // The mark is an image in both hosts — it contributes no text, so the
      // panel's whole text content must be the four supplied strings and nothing
      // the package added of its own.
      <AuthShell
        logo={<span>logo</span>}
        panelMark={<img alt="" src="/mark.svg" />}
        copy={copy}
      >
        <div>form</div>
      </AuthShell>,
    );

    const panelText = screen.getByTestId("auth-brand-panel").textContent;
    expect(panelText).toBe(
      `${copy.eyebrow}${copy.headline}${copy.subcopy}${copy.footer}`,
    );
    expect(container.querySelector(".layout\\:grid-cols-2")).not.toBeNull();
  });

  it("021 EARS-2: returnContext replaces the value prop and widens the split", () => {
    const { container } = render(
      <AuthShell
        logo={<span>logo</span>}
        panelMark={<span>mark</span>}
        copy={copy}
        returnContext={<div data-testid="return-context">context</div>}
      >
        <div>form</div>
      </AuthShell>,
    );

    expect(screen.getByTestId("return-context")).toBeInTheDocument();
    // The value prop is replaced, never stacked above the context.
    expect(screen.queryByText(copy.headline)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.subcopy)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.eyebrow)).not.toBeInTheDocument();
    // …while the mark and the panel footer stay — they are not the middle zone.
    expect(screen.getByText(copy.footer)).toBeInTheDocument();
    expect(
      container.querySelector(".layout\\:grid-cols-\\[1\\.1fr_\\.9fr\\]"),
    ).not.toBeNull();
  });
});
