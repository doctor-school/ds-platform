// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthFlowHostConfig } from "../host-config";
import { resolveAuthFlowCopy } from "../copy";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { AuthShell } from "./auth-shell";

/**
 * Row 47 — ONE chromeless auth frame for both hosts (#2027 PR 1.5), and
 * 003 EARS-17 — the SmartCaptcha processing disclosure under the card (moved
 * from `apps/portal/components/auth-shell.test.tsx`).
 *
 * Every host difference is a config value: the wordmark (with an optional dark
 * variant), the panel mark, the brand copy and the disclosure copy. The notice
 * renders exactly where the host states a site key — the same condition the
 * challenge itself runs on, so a host that challenges always discloses.
 */

afterEach(() => {
  cleanup();
});

const HOSTS = [
  ["academy", ACADEMY_FIXTURE],
  ["doctor", DOCTOR_FIXTURE],
] as const;

function withSiteKey(
  config: AuthFlowHostConfig,
  siteKey: string | undefined,
): AuthFlowHostConfig {
  return { ...config, botProtection: { siteKey } };
}

describe.each(HOSTS)("AuthShell on the %s host", (_host, config) => {
  it.each(["login", "register", "verify", "reset"])(
    "003 EARS-17: renders one localized notice below the %s AuthCard when SmartCaptcha is configured",
    async (surface) => {
      render(
        <AuthShell config={withSiteKey(config, "configured-client-key")}>
          <div data-testid={`${surface}-auth-card`}>{surface}</div>
        </AuthShell>,
      );

      await screen.findByTestId(`${surface}-auth-card`);
      const notices = screen.getAllByTestId("smartcaptcha-disclosure");
      expect(notices).toHaveLength(1);
      expect(notices[0]).toBeVisible();
      const disclosure = resolveAuthFlowCopy(config).botProtectionDisclosure;
      expect(notices[0]).toHaveTextContent(
        `${disclosure.notice} ${disclosure.link}`,
      );

      const noticeLink = screen.getByRole("link", {
        name: disclosure.linkLabel,
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

  it("#2027: the processing notice reads as the canvas faint line under the card (canvas 289)", async () => {
    render(
      <AuthShell config={withSiteKey(config, "configured-client-key")}>
        <div data-testid="auth-form">form</div>
      </AuthShell>,
    );

    const notice = await screen.findByTestId("smartcaptcha-disclosure");
    expect(notice).toHaveClass(
      "mt-3.5",
      "text-xs",
      "leading-normal",
      "text-faint",
    );
    expect(notice.className).not.toMatch(/text-center|text-muted-foreground/);
  });

  it("003 EARS-17: renders no processing notice when SmartCaptcha is not configured", async () => {
    render(
      <AuthShell config={withSiteKey(config, undefined)}>
        <div data-testid="auth-form">form</div>
      </AuthShell>,
    );

    await screen.findByTestId("auth-form");
    expect(
      screen.queryByTestId("smartcaptcha-disclosure"),
    ).not.toBeInTheDocument();
  });

  it("row 47: renders the host wordmark, panel mark and brand copy from config", () => {
    render(
      <AuthShell config={config}>
        <div>form</div>
      </AuthShell>,
    );

    const wordmark = screen.getByTestId("auth-wordmark");
    expect(wordmark).toHaveAttribute("src", config.brand.wordmark.src);
    expect(wordmark).toHaveAttribute("alt", config.brand.wordmark.alt);
    expect(screen.getByTestId("auth-panel-wordmark")).toHaveAttribute(
      "alt",
      "",
    );
    expect(
      screen.getByText(resolveAuthFlowCopy(config).brand.headline),
    ).toBeInTheDocument();
    expect(
      screen.getByText(resolveAuthFlowCopy(config).brand.subcopy),
    ).toBeInTheDocument();
    expect(
      screen.getByText(resolveAuthFlowCopy(config).brand.footer),
    ).toBeInTheDocument();
  });

  it("row 47: the return-context block takes the value prop's place when supplied", () => {
    render(
      <AuthShell
        config={config}
        returnContext={<div data-testid="return-context">ctx</div>}
      >
        <div>form</div>
      </AuthShell>,
    );

    expect(screen.getByTestId("return-context")).toBeInTheDocument();
    expect(
      screen.queryByText(resolveAuthFlowCopy(config).brand.subcopy),
    ).not.toBeInTheDocument();
  });
});

describe("row 47: the dark-theme wordmark is a host value", () => {
  it("doctor: swaps a white lockup in on the dark page — exactly one mark visible per theme", () => {
    render(
      <AuthShell config={DOCTOR_FIXTURE}>
        <div>form</div>
      </AuthShell>,
    );

    expect(screen.getByTestId("auth-wordmark")).toHaveClass("dark:hidden");
    const dark = screen.getByTestId("auth-wordmark-dark");
    expect(dark).toHaveAttribute("src", DOCTOR_FIXTURE.brand.wordmark.darkSrc);
    expect(dark).toHaveAttribute("alt", DOCTOR_FIXTURE.brand.wordmark.alt);
    expect(dark).toHaveClass("hidden", "dark:block");
  });

  it("academy: states no dark variant, so one lockup renders with no theme swap", () => {
    render(
      <AuthShell config={ACADEMY_FIXTURE}>
        <div>form</div>
      </AuthShell>,
    );

    expect(screen.queryByTestId("auth-wordmark-dark")).not.toBeInTheDocument();
    expect(screen.getByTestId("auth-wordmark")).not.toHaveClass("dark:hidden");
  });
});
