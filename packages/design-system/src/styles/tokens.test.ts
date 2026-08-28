import { describe, expect, it } from "vitest";

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
