import { describe, expect, it } from "vitest";

import globals from "./globals.css?raw";

describe("theme root color-scheme (#2434)", () => {
  // Native controls — the date picker indicator, scrollbars, autofill, the
  // checkbox/radio/select chrome — draw from the UA `color-scheme`, not from
  // the tokens. Without it a `.dark` page keeps the light-scheme glyphs: a dark
  // calendar icon on the near-black field.
  it("declares color-scheme light at :root and dark under .dark", () => {
    const root = /(?:^|[\s}]):root\s*\{([^}]*)\}/.exec(globals)?.[1];
    const dark = /(?:^|[\s}])\.dark\s*\{([^}]*)\}/.exec(globals)?.[1];
    expect(root).toMatch(/color-scheme:\s*light\s*;/);
    expect(dark).toMatch(/color-scheme:\s*dark\s*;/);
  });
});

describe("embedded frames keep the UA color-scheme (#2434)", () => {
  // CSS Color Adjust 1 §2.4: when the iframe element's color scheme and the
  // embedded document's root color scheme differ, the UA paints an opaque
  // Canvas backdrop instead of a transparent one. A `.dark` page would hand
  // `dark` to every third-party frame (the SmartCaptcha challenge is a light
  // document), so the frame turned into a solid light box over the page.
  it("resets iframe color-scheme to normal in the base layer", () => {
    const iframe = /(?:^|[\s}])iframe\s*\{([^}]*)\}/.exec(globals)?.[1];
    expect(iframe).toMatch(/color-scheme:\s*normal\s*;/);
  });
});
