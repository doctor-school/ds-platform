import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthLayout } from "./auth-layout";

afterEach(cleanup);

/**
 * `<AuthLayout>` (#237, re-skinned to the neo-brutalist split-shell in #517) is the
 * split-screen auth chrome the four portal auth surfaces compose into: a centered form
 * column plus a brand panel. It is presentation-only — every visible string / asset is
 * app-supplied (i18n + brand assets stay in the app), so the harness passes plain test
 * markers and asserts on those, never on package-internal copy.
 *
 * The split collapses at the semantic `layout` breakpoint (`--breakpoint-layout` =
 * 901px, §09) — the token match for the canvas `≤900px` single-column fold — NOT the
 * generic `lg` (1024px). Below it the brand panel is hidden and the form fills the
 * screen; at `layout:` the two columns engage with the brand panel on the left.
 */
describe("<AuthLayout>", () => {
  it("renders the form slot (children) so a surface's AuthCard is shown", () => {
    render(
      <AuthLayout
        logo={<span>brand-logo</span>}
        aside={<p>brand-aside</p>}
      >
        <div data-testid="form-slot">the form</div>
      </AuthLayout>,
    );
    expect(screen.getByTestId("form-slot")).toHaveTextContent("the form");
  });

  it("hides the form-column logo at layout when a brand panel is present (one logo per viewport)", () => {
    // Desktop shows the brand-panel mark only; the form-top logo is `layout:hidden`, so
    // the two never both render (the #275 / #237 duplicate-logo-on-desktop fix). Below the
    // layout breakpoint the panel is hidden and this logo carries the brand.
    render(
      <AuthLayout logo={<span>brand-logo</span>} aside={<p>brand-aside</p>}>
        <div>form</div>
      </AuthLayout>,
    );
    const logoWrapper = screen.getByText("brand-logo").parentElement;
    expect(logoWrapper).toBeInTheDocument();
    expect(logoWrapper?.className).toContain("layout:hidden");
  });

  it("keeps the form-column logo on every breakpoint when there is no brand panel (form-only fallback)", () => {
    render(
      <AuthLayout logo={<span>brand-logo</span>}>
        <div>form</div>
      </AuthLayout>,
    );
    const logoWrapper = screen.getByText("brand-logo").parentElement;
    expect(logoWrapper?.className).not.toContain("layout:hidden");
  });

  it("renders the brand panel aside content in a complementary landmark", () => {
    render(
      <AuthLayout logo={<span>logo</span>} aside={<p>brand-aside</p>}>
        <div>form</div>
      </AuthLayout>,
    );
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveTextContent("brand-aside");
    // The panel is the branded surface — AA-safe token fill (primary-surface = blue.700,
    // white 8.14:1), not `primary` (blue.500, 3.69:1) and not a hardcoded color. The copy
    // MUST use the PAIRED `primary-surface-foreground` (white in BOTH themes): the
    // action-pair `primary-foreground` repoints to dark ink in `.dark` (where the action
    // fill lifts to light blue), which rendered the dark panel unreadable (#517 review).
    expect(aside.className).toContain("bg-primary-surface");
    expect(aside.className).toContain("text-primary-surface-foreground");
    expect(aside.className).not.toMatch(/text-primary-foreground(?:\s|"|$)/);
  });

  it("places the brand panel left and the form right at layout (recorded #237 column-order)", () => {
    // Deliberate-choice ledger: the column side is an explicit product-owner decision
    // (brand LEFT, form RIGHT), not the inherited login-03 default. The form stays first
    // in source order (a11y) and is flipped at `layout:` via order utilities.
    render(
      <AuthLayout logo={<span>logo</span>} aside={<p>brand-aside</p>}>
        <div data-testid="form-slot">form</div>
      </AuthLayout>,
    );
    expect(screen.getByRole("complementary").className).toContain("layout:order-1");
    const formColumn = screen.getByTestId("form-slot").closest("div.flex.flex-col");
    expect(formColumn?.className).toContain("layout:order-2");
  });

  it("omits the brand panel entirely when no aside is supplied (form-only fallback)", () => {
    render(
      <AuthLayout logo={<span>logo</span>}>
        <div>form</div>
      </AuthLayout>,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
