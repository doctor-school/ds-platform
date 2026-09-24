// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RegisterGlyph } from "./register-glyph";

/**
 * #2027 canvas `auth.dc.html:62` — the glyph is drawn in the tile's `accent`,
 * which the AuthCard tile already paints (`text-info`: #2D84F2 light, the
 * accent-dark value in dark). The glyph inherits it instead of pinning the
 * `primary` role, which stays #2D84F2 in the Academy dark theme.
 */
describe("RegisterGlyph", () => {
  it.each(["user-plus", "user-plus-square"] as const)(
    "#2027: the %s glyph inherits the tile accent rather than pinning a colour",
    (icon) => {
      const { container } = render(<RegisterGlyph icon={icon} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("class") ?? "").not.toMatch(/\btext-/);
    },
  );
});
