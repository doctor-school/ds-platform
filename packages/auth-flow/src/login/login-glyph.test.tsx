// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthFlowLoginIcon } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { LoginGlyph } from "./login-glyph";

/**
 * `brand.loginIcon` — the sign-in card's glyph as a CLOSED enum of package-owned
 * drawings (#2027 PR 1.5, item 4a). The two hosts' marks are different drawings,
 * so each is moved verbatim: zero visual delta on either host.
 */
afterEach(cleanup);

function markup(icon: AuthFlowLoginIcon): string {
  const { container } = render(<LoginGlyph icon={icon} />);
  return container.innerHTML;
}

describe("LoginGlyph", () => {
  it("shield-check renders the Academy's lucide ShieldCheck with its current classes", () => {
    const { container } = render(<LoginGlyph icon="shield-check" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toBe(
      "lucide lucide-shield-check text-primary",
    );
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-linecap")).toBe("round");
  });

  it("shield-check-square renders the doctor SVG verbatim (square caps, currentColor)", () => {
    expect(markup("shield-check-square")).toBe(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">' +
        '<path d="M12 2 4 5v6c0 5 3.4 9.1 8 11 4.6-1.9 8-6 8-11V5l-8-3Z" stroke-width="2" stroke-linecap="square"></path>' +
        '<path d="m9 12 2 2 4-4" stroke-width="2" stroke-linecap="square"></path>' +
        "</svg>",
    );
  });

  it("each host config names its current glyph", () => {
    expect(ACADEMY_FIXTURE.brand.loginIcon).toBe("shield-check");
    expect(DOCTOR_FIXTURE.brand.loginIcon).toBe("shield-check-square");
  });

  it("an unknown glyph name is a type error", () => {
    // @ts-expect-error — the glyph set is closed; a free string is not a login icon.
    const unknown: AuthFlowLoginIcon = "shield";
    expect(unknown).toBe("shield");
  });
});
