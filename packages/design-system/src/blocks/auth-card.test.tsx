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
    // the AA-safe `tint` / `tint-foreground` token pairing, never a hardcoded colour.
    render(
      <AuthCard title="Sign in" icon={<span data-testid="glyph">◆</span>}>
        <div>form</div>
      </AuthCard>,
    );
    const tile = screen.getByTestId("glyph").parentElement;
    expect(tile).toBeInTheDocument();
    expect(tile?.className).toContain("bg-tint");
    expect(tile?.className).toContain("text-tint-foreground");
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
});
