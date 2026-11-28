import { describe, expect, it } from "vitest";

import primitive from "../../tokens/primitive.json";
import dark from "../../tokens/semantic.dark.json";
import light from "../../tokens/semantic.json";
import allowed from "./allowed-tokens.json";

describe("DataTable pressed-state semantic token (#1578)", () => {
  it("maps tint-pressed to the owner-picked primitive in light and dark", () => {
    expect(light.color["tint-pressed"].$value).toBe("{color.blue.200}");
    expect(dark.color["tint-pressed"].$value).toBe("{color.blue.700}");
  });

  it("exposes tint-pressed through the generated CSS manifest", () => {
    expect(allowed.cssVariables).toContain("--color-tint-pressed");
    expect(allowed.themeKeys).toContain("--color-tint-pressed");
    expect(allowed.tokenPaths).toContain("color.tint-pressed");
    expect(allowed.references["--color-tint-pressed"]).toBe("--color-blue-200");
  });
});

describe("029 Academy home card casts (#4243)", () => {
  it("casts a card on the hero band in the band's navy in light and near-black in dark", () => {
    expect(light.color["hero-card-cast"].$value).toBe("{color.blue.800}");
    expect(dark.color["hero-card-cast"].$value).toBe("{color.neutral.950}");
    expect(allowed.cssVariables).toContain("--shadow-hero-card");
    expect(allowed.themeKeys).toContain("--shadow-hero-card");
    expect(primitive.shadow["hero-card"].$value).toBe(
      "6px 6px 0 var(--color-hero-card-cast)",
    );
  });

  it("casts a bordered panel at the lg offset in the ink border tone", () => {
    expect(allowed.cssVariables).toContain("--shadow-panel");
    expect(allowed.themeKeys).toContain("--shadow-panel");
    expect(primitive.shadow.panel.$value).toBe("6px 6px 0 var(--color-border)");
  });
});
