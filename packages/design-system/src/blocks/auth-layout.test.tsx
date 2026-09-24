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
      <AuthLayout logo={<span>brand-logo</span>} aside={<p>brand-aside</p>}>
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
    expect(screen.getByRole("complementary").className).toContain(
      "layout:order-1",
    );
    const formColumn = screen
      .getByTestId("form-slot")
      .closest("div.flex.flex-col");
    expect(formColumn?.className).toContain("layout:order-2");
  });

  it("#2027 P1: splits the shell .95fr 1.05fr by default and pads the panel to the canvas clamp", () => {
    // design-source/auth.dc.html: `shellCols = '.95fr 1.05fr'` (the panel is the
    // first visual track, 684px at 1440) and the panel's own padding
    // `clamp(40px,4vw,64px)` — the `panel` spacing role.
    const { container } = render(
      <AuthLayout logo={<span>logo</span>} aside={<p>brand-aside</p>}>
        <div>form</div>
      </AuthLayout>,
    );
    const shell = container.firstElementChild;
    expect(shell?.className).toContain("layout:grid-cols-[.95fr_1.05fr]");
    expect(shell?.className).not.toContain("layout:grid-cols-2");
    const panel = container.querySelector("aside");
    expect(panel?.className.split(" ")).toContain("p-panel");
    expect(panel?.className.split(" ")).not.toContain("p-12");
  });

  it('widens the brand panel to 1.1fr .9fr with split="wide-aside" (021 return context)', () => {
    // The canvas widens the split exactly when the panel stops carrying a value
    // prop and starts carrying content the visitor came for (`shellCols =
    // gateCardOnPanel ? '1.1fr .9fr'`, design-source/auth.dc.html). The ratio is a
    // property of the layout, so it is a prop of the one block that owns the
    // split — never an app-local grid fork.
    const { container } = render(
      <AuthLayout
        logo={<span>logo</span>}
        aside={<p>brand-aside</p>}
        split="wide-aside"
      >
        <div>form</div>
      </AuthLayout>,
    );
    const shell = container.firstElementChild;
    expect(shell?.className).toContain("layout:grid-cols-[1.1fr_.9fr]");
    expect(shell?.className).not.toContain("layout:grid-cols-[.95fr_1.05fr]");
  });

  it("omits the brand panel entirely when no aside is supplied (form-only fallback)", () => {
    render(
      <AuthLayout logo={<span>logo</span>}>
        <div>form</div>
      </AuthLayout>,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("#2027: the form column caps the logo and the card at the canvas 440px (canvas 53)", () => {
    render(
      <AuthLayout logo={<span data-testid="logo">brand-logo</span>}>
        <div data-testid="form-slot">the form</div>
      </AuthLayout>,
    );
    expect(screen.getByTestId("form-slot").parentElement).toHaveClass(
      "max-w-auth",
    );
    expect(screen.getByTestId("logo").parentElement).toHaveClass("max-w-auth");
    expect(
      screen.getByTestId("form-slot").parentElement?.className ?? "",
    ).not.toMatch(/max-w-md/);
  });
});
