import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthCard } from "./auth-card";

afterEach(cleanup);

/**
 * `<AuthCard>` (#235, re-skinned to the neo-brutalist language in #517). The block is
 * presentation-only — every visible string / the icon is app-supplied — so the harness
 * passes plain test markers and asserts on the STRUCTURE the surfaces depend on, never
 * on pixels: the icon renders inside a tinted badge tile above the title, the title and
 * description render, and the optional footer/description slots collapse when omitted.
 */
describe("<AuthCard>", () => {
  it("renders the app-supplied title, description and body (children)", () => {
    render(
      <AuthCard title="Sign in" description="Enter your details">
        <div data-testid="body">the form</div>
      </AuthCard>,
    );
    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText("Enter your details")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toHaveTextContent("the form");
  });

  // Canvas 56-61 (#2027): an OPERATION error — the command the door just ran
  // failed — stands above the card title, where it is read before the form is
  // re-read. Field-level messages stay at their field.
  it("renders the app's error banner above the title", () => {
    render(
      <AuthCard
        title="Sign in"
        errorBanner={<div data-testid="banner">it failed</div>}
      >
        <div>form</div>
      </AuthCard>,
    );

    const banner = screen.getByTestId("banner");
    const title = screen.getByText("Sign in");
    expect(
      banner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("#2027: a footer-less card closes on the canvas 36px inset under its content", () => {
    render(
      <AuthCard title="Sign in">
        <div data-testid="body">form</div>
      </AuthCard>,
    );
    expect(screen.getByTestId("body").parentElement).toHaveClass("layout:pb-9");
  });

  it("draws no banner region when the app passes none", () => {
    render(
      <AuthCard title="Sign in">
        <div>form</div>
      </AuthCard>,
    );

    expect(screen.queryByTestId("banner")).toBeNull();
  });

  it("wraps the icon in a tinted badge tile (neo-brutalist auth-card, #517)", () => {
    // The re-skin promotes the inline icon into a square, tint-filled badge tile above
    // the title (canvas `auth-card` badge: tint surface + accent glyph). It paints from
    // the `tint` surface + `info` accent token pairing, never a hardcoded colour; the
    // exact kegel/tone the canvas fixes is asserted by the `#2027:` tile spec below.
    render(
      <AuthCard title="Sign in" icon={<span data-testid="glyph">◆</span>}>
        <div>form</div>
      </AuthCard>,
    );
    const tile = screen.getByTestId("glyph").parentElement;
    expect(tile).toBeInTheDocument();
    expect(tile?.className).toContain("bg-tint");
    expect(tile?.className).toContain("text-info");
  });

  // ── Render parity with the owner's canvas (#2027, auth.dc.html 52-64) ───────
  // Owner rule 2026-09-22: parity is the RENDERING — frame, weights, colours,
  // spacing — and the canvas beats the spec. These three assertions pin the auth
  // FAMILY chrome; the global `Card` primitive is deliberately untouched, the
  // 36px inset lives here.

  it("#2027: the auth card pads to the canvas 36px inset from the layout breakpoint (canvas 52)", () => {
    // Canvas 52 pads the card `clamp(24px,4vw,36px)`: 24px on a phone, reaching
    // 36px exactly at the ~900px `layout` threshold. The family expresses that as
    // the base `p-6` the primitive already draws plus a `layout:` 36px step, and
    // it never re-pads the edge the next region owns (header keeps its 24px
    // bottom gap, content and footer keep their zero top).
    render(
      <AuthCard title="Sign in" footer={<span>foot</span>}>
        <div data-testid="body">form</div>
      </AuthCard>,
    );

    const header = screen.getByText("Sign in").parentElement;
    expect(header).toHaveClass("layout:px-9", "layout:pt-9");
    expect(header?.className ?? "").not.toMatch(/layout:p-9/);

    const content = screen.getByTestId("body").parentElement;
    // With a footer the footer owns the bottom inset (see the canvas-212 test).
    expect(content).toHaveClass("layout:px-9");
    expect(content?.className ?? "").not.toMatch(/layout:p-9/);

    const footer = screen.getByText("foot").parentElement;
    expect(footer).toHaveClass("layout:px-9", "layout:pb-9");
  });

  it("#2027: the badge tile is the canvas 52px tile carrying the ACCENT glyph (canvas 62)", () => {
    // Canvas 62: a 52×52 tint tile, the glyph in `accent` (#2D84F2 = the `info`
    // role), 20px of air under it. The darker `tint-foreground` pairing was the
    // pre-canvas default and reads as a different blue on the screen.
    render(
      <AuthCard title="Sign in" icon={<span data-testid="glyph">◆</span>}>
        <div>form</div>
      </AuthCard>,
    );

    const tile = screen.getByTestId("glyph").parentElement;
    expect(tile).toHaveClass("size-13", "bg-tint", "text-info", "mb-5");
    expect(tile?.className ?? "").not.toMatch(/text-tint-foreground/);
  });

  it("#2027: the screen title and its sub-copy carry the canvas kegel and leading (canvas 63-64)", () => {
    // Canvas 63: 26px/800, −.025em, leading 1.15 — a screen title, not the page
    // h2 (`text-2xl` 28px on Tailwind's 1.333 default leading overshot both).
    // Canvas 64: the sub-copy runs on 1.55.
    render(
      <AuthCard title="Sign in" description="Enter your details">
        <div>form</div>
      </AuthCard>,
    );

    const title = screen.getByText("Sign in");
    expect(title).toHaveClass(
      "text-title-xl",
      "font-extrabold",
      "tracking-tight",
      "leading-title",
    );
    expect(title.className).not.toMatch(/text-2xl/);

    expect(screen.getByText("Enter your details")).toHaveClass("leading-prose");
  });

  it("#2027: the footer speaks at the canvas 13px caption (canvas 232)", () => {
    // The «Уже есть аккаунт? Войти» line is a caption under the card body, not
    // body copy: the canvas sets it a rung below the form text.
    render(
      <AuthCard title="Sign in" footer={<span>foot</span>}>
        <div>form</div>
      </AuthCard>,
    );

    const footer = screen.getByText("foot").parentElement;
    expect(footer).toHaveClass("text-caption");
    expect(footer?.className ?? "").not.toMatch(/text-sm/);
  });

  it("omits the badge tile entirely when no icon is supplied", () => {
    render(
      <AuthCard title="Reset password">
        <div data-testid="body">form</div>
      </AuthCard>,
    );
    // No tint-filled tile leaks in when the icon slot is empty.
    const tile = document.querySelector(".bg-tint");
    expect(tile).toBeNull();
  });

  it("renders the footer slot only when supplied", () => {
    const { rerender } = render(
      <AuthCard title="Sign in" footer={<a href="#">Create account</a>}>
        <div>form</div>
      </AuthCard>,
    );
    expect(screen.getByText("Create account")).toBeInTheDocument();

    rerender(
      <AuthCard title="Sign in">
        <div>form</div>
      </AuthCard>,
    );
    expect(screen.queryByText("Create account")).not.toBeInTheDocument();
  });

  it("#2027: the title and its sub-copy stand the canvas 10px apart (canvas 63-64)", () => {
    render(
      <AuthCard title="Sign in" description="Enter your details">
        <div>form</div>
      </AuthCard>,
    );
    const header = screen.getByText("Sign in").parentElement;
    expect(header).toHaveClass("space-y-2.5");
    expect(header?.className ?? "").not.toMatch(/space-y-1\.5/);
  });

  it("#2027: the badge glyph is the canvas 26px mark (canvas 62)", () => {
    render(
      <AuthCard title="Sign in" icon={<span data-testid="glyph">◆</span>}>
        <div>form</div>
      </AuthCard>,
    );
    const tile = screen.getByTestId("glyph").parentElement;
    expect(tile).toHaveClass("[&_svg]:size-6.5");
    expect(tile?.className ?? "").not.toMatch(/\[&_svg\]:size-6(?!\.)/);
  });

  it("#2027: the footer line stands the canvas 24px under the form, not a stacked 36px (canvas 212)", () => {
    render(
      <AuthCard title="Sign in" footer={<span>foot</span>}>
        <div data-testid="body">form</div>
      </AuthCard>,
    );
    const content = screen.getByTestId("body").parentElement;
    expect(content).toHaveClass("layout:px-9");
    expect(content?.className ?? "").not.toMatch(/layout:pb-9/);
  });
});
