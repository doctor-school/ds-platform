import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthShell } from "./auth-shell";

/**
 * 003 EARS-17 — the SmartCaptcha processing disclosure `<AuthShell>` renders
 * under the card on all four portal auth surfaces.
 *
 * The #675 signed-in guard used to be tested here too. It is no longer part of
 * this component: since #2027 PR 1.4 the decision is made SERVER-side, before
 * paint, in each route`s layout — proved by `app/auth-route-guard.test.tsx`
 * (wiring) and `packages/auth-flow/src/server/auth-route-guard.test.ts` (the
 * rule). What is left here is the disclosure and nothing else.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const copy: Record<string, string> = {
      captchaDisclosure: "Форма защищена Yandex SmartCaptcha.",
      captchaDisclosureLink: "Условия обработки данных.",
      captchaDisclosureLinkLabel:
        "Условия обработки данных Yandex SmartCaptcha (откроются в новой вкладке)",
    };
    return copy[key] ?? key;
  },
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe("EARS-17: AuthShell SmartCaptcha processing disclosure", () => {
  it.each(["login", "register", "verify", "reset"])(
    "renders one localized notice below the %s AuthCard when SmartCaptcha is configured",
    async (surface) => {
      vi.stubEnv("NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY", "configured-client-key");

      render(
        <AuthShell>
          <div data-testid={`${surface}-auth-card`}>{surface}</div>
        </AuthShell>,
      );

      await screen.findByTestId(`${surface}-auth-card`);
      const notices = screen.getAllByTestId("smartcaptcha-disclosure");
      expect(notices).toHaveLength(1);
      expect(notices[0]).toBeVisible();
      expect(notices[0]).toHaveTextContent(
        "Форма защищена Yandex SmartCaptcha. Условия обработки данных.",
      );

      const noticeLink = screen.getByRole("link", {
        name: "Условия обработки данных Yandex SmartCaptcha (откроются в новой вкладке)",
      });
      expect(noticeLink).toHaveAttribute(
        "href",
        "https://yandex.com/legal/smartcaptcha_notice/",
      );
      expect(noticeLink).toHaveAttribute("target", "_blank");
      expect(noticeLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(noticeLink).not.toHaveClass("underline");
      expect(noticeLink).toHaveClass("hover:underline");
    },
  );

  it("renders no processing notice when SmartCaptcha is not configured", async () => {
    render(
      <AuthShell>
        <div data-testid="auth-form">form</div>
      </AuthShell>,
    );

    await screen.findByTestId("auth-form");
    expect(
      screen.queryByTestId("smartcaptcha-disclosure"),
    ).not.toBeInTheDocument();
  });
});
