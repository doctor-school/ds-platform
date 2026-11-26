// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ACADEMY_AUTH_FLOW } from "../hosts";
import { BotProtectionDisclosure, SMARTCAPTCHA_NOTICE_URL } from "./index";

const PROTECTED = { ...ACADEMY_AUTH_FLOW, botProtection: { siteKey: "key" } };

/**
 * 003 EARS-17 / 033 EARS-7 — one disclosure definition for every protected
 * form; a form on the invariant brand surface takes the `on-primary` tone
 * instead of restyling a host copy.
 */
describe("BotProtectionDisclosure", () => {
  afterEach(cleanup);

  it("EARS-17: draws nothing without a site key", () => {
    render(<BotProtectionDisclosure config={ACADEMY_AUTH_FLOW} />);
    expect(screen.queryByTestId("smartcaptcha-disclosure")).toBeNull();
  });

  it("EARS-17: the default tone links the vendor notice in the brand ink", () => {
    render(<BotProtectionDisclosure config={PROTECTED} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", SMARTCAPTCHA_NOTICE_URL);
    expect(link).toHaveClass("text-primary-action");
    expect(screen.getByTestId("smartcaptcha-disclosure")).toHaveClass(
      "text-faint",
    );
  });

  it("EARS-17: the on-primary tone reads on the brand surface with an underlined link", () => {
    render(<BotProtectionDisclosure config={PROTECTED} tone="on-primary" />);
    const notice = screen.getByTestId("smartcaptcha-disclosure");
    expect(notice).toHaveClass("text-primary-surface-foreground");
    expect(notice).not.toHaveClass("text-faint");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", SMARTCAPTCHA_NOTICE_URL);
    expect(link).toHaveClass("text-primary-surface-foreground", "underline");
  });
});
