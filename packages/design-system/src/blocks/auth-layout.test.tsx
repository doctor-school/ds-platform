import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthLayout } from "./auth-layout";

afterEach(cleanup);

/**
 * `<AuthLayout>` (#237) is the split-screen auth chrome (shadcn `login-03`, re-skinned
 * to tokens) the four portal auth surfaces compose into: a centered form column plus a
 * brand panel. It is presentation-only — every visible string / asset is app-supplied
 * (i18n + brand assets stay in the app), so the harness passes plain test markers and
 * asserts on those, never on package-internal copy.
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

  it("renders the app-supplied logo (shown on every breakpoint, incl. mobile where the panel is hidden)", () => {
    render(
      <AuthLayout logo={<span>brand-logo</span>} aside={<p>brand-aside</p>}>
        <div>form</div>
      </AuthLayout>,
    );
    expect(screen.getByText("brand-logo")).toBeInTheDocument();
  });

  it("renders the brand panel aside content in a complementary landmark", () => {
    render(
      <AuthLayout logo={<span>logo</span>} aside={<p>brand-aside</p>}>
        <div>form</div>
      </AuthLayout>,
    );
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveTextContent("brand-aside");
    // The panel is the branded surface — token-driven brand fill, not a hardcoded color.
    expect(aside.className).toContain("bg-primary");
    expect(aside.className).toContain("text-primary-foreground");
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
