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
