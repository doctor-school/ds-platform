import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { LoginScreen } from "@/components/login-screen";

/**
 * #1933 — what reaches the HTML of the doctor sign-in screen.
 *
 * Static server markup, not jsdom, for the reason `vitest.config.ts` states: the
 * doctor unit tier is node-only, and the assertions that belong HERE are
 * structural — the shared block is the thing rendered, the RU copy is the doctor
 * own, the footer links carry the arrival context, and the server landing
 * decision is published rather than recomputed. The BEHAVIOUR of the surface
 * (submit, the error the block renders, the OTP focus screen) is driven in the
 * real browser by `e2e/login.spec.ts`, which is where a sign-in defect actually
 * shows; duplicating it against a DOM mock would assert the mock.
 */
function render(props?: Partial<Parameters<typeof LoginScreen>[0]>) {
  return renderToStaticMarkup(
    <LoginScreen registerHref="/register" landing="/" {...props} />,
  );
}

describe("017 #1933: the doctor sign-in screen", () => {
  it("017 #1933.10: the screen is the SHARED LoginCard, with the doctor RU copy on it", () => {
    const html = render();

    // The block own test ids — proof the card is projected, not re-built here.
    expect(html).toContain('data-testid="password-login-form"');
    expect(html).toContain('data-testid="login-method-otp"');
    expect(html).toContain("Вход");
    expect(html).toContain("Почта или телефон");
    expect(html).toContain("Создать аккаунт");
  });

  it("017 #1989.14: password recovery stays on THIS host — «Забыли пароль» links to the storefront /reset", () => {
    const html = render();

    expect(html).toContain('href="/reset"');
    // The #1933 interim crossing is gone with the route that made it necessary.
    expect(html).not.toContain("academy.doctor.school");
  });

  it("017 #1933.11: the create-account link carries the validated arrival context onward", () => {
    const html = render({ registerHref: "/register?returnTo=%2Fwebinars%2Fabc" });

    expect(html).toContain('href="/register?returnTo=%2Fwebinars%2Fabc"');
  });

  it("017 #1933.12: the server landing decision is published on the screen, not recomputed", () => {
    const html = render({ landing: "/events" });

    expect(html).toContain('data-login-landing="/events"');
  });

  it("017 #1933.13: with no return context NOTHING stands in for it (honest-empty)", () => {
    expect(render()).not.toContain("login-return-context");
    expect(render({ returnContext: <p>эфир</p> })).toContain(
      "login-return-context",
    );
  });
});
