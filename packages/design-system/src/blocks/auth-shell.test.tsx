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
    expect(
      container.querySelector(".layout\\:grid-cols-\\[\\.95fr_1\\.05fr\\]"),
    ).not.toBeNull();
  });

  it("#2027: a panel with no sub-copy renders no sub-copy node (owner 2026-09-24)", () => {
    const { eyebrow, headline, footer } = copy;
    render(
      <AuthShell
        logo={<span>logo</span>}
        panelMark={<img alt="" src="/mark.svg" />}
        copy={{ eyebrow, headline, footer }}
      >
        <div>form</div>
      </AuthShell>,
    );

    const valueProp = screen.getByText(headline).parentElement;
    // Eyebrow + headline only — an absent line is absent, never an empty <p>.
    expect(valueProp?.children).toHaveLength(2);
    expect(screen.getByTestId("auth-brand-panel").textContent).toBe(
      `${eyebrow}${headline}${footer}`,
    );
  });

  it("#2027 P1: the value prop takes the canvas measures (auth.dc.html 309/310/312/316)", () => {
    render(
      <AuthShell logo={<span>logo</span>} panelMark={<span>mark</span>} copy={copy}>
        <div>form</div>
      </AuthShell>,
    );
    const classes = (text: string) => screen.getByText(text).className.split(" ");

    // Eyebrow — 11px / 800 / #D3E8FD (blue.100) / .14em / uppercase.
    const eyebrow = classes(copy.eyebrow);
    expect(eyebrow).toEqual(
      expect.arrayContaining([
        "text-eyebrow",
        "font-extrabold",
        "uppercase",
        "tracking-eyebrow",
        "text-primary-surface-soft",
      ]),
    );
    expect(eyebrow).not.toContain("tracking-micro");
    expect(eyebrow).not.toContain("text-primary-surface-muted");

    // Headline — clamp(30px,3.4vw,46px) / 800 / lh 1.05 / -.035em / 16ch, plain wrap.
    const headline = classes(copy.headline);
    expect(headline).toEqual(
      expect.arrayContaining([
        "text-panel-headline",
        "font-extrabold",
        "leading-display",
        "tracking-display",
        "max-w-panel-headline",
      ]),
    );
    for (const off of ["text-4xl", "leading-tight", "tracking-tight", "max-w-lg", "text-balance"]) {
      expect(headline).not.toContain(off);
    }

    // Sub-copy (doctor) — 17px / 400 / lh 1.55 / #D3E8FD / 38ch.
    const subcopy = classes(copy.subcopy);
    expect(subcopy).toEqual(
      expect.arrayContaining([
        "text-lead",
        "leading-prose",
        "text-primary-surface-soft",
        "max-w-panel-lead",
      ]),
    );
    for (const off of ["text-base", "font-medium", "leading-relaxed", "max-w-md"]) {
      expect(subcopy).not.toContain(off);
    }

    // Footer — 13px / 600 / white @ 85%.
    const footer = classes(copy.footer);
    expect(footer).toEqual(
      expect.arrayContaining(["text-caption", "font-semibold", "text-primary-surface-footer"]),
    );
    expect(footer).not.toContain("text-sm");
    expect(footer).not.toContain("text-primary-surface-muted");
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
