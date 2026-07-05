import { describe, expect, it } from "vitest";

import manifest from "./allowed-tokens.json";

/**
 * Contract harness for the layout & spatial-rhythm token layer (#514, canvas §09).
 *
 * The deliverable is a set of GENERATED tokens that must be consumable by any
 * surface: the container max-widths + fluid/mobile gutters, the mobile/desktop
 * layout breakpoint, and the semantic spacing ROLES (inset / stack / section /
 * control / inline / day-band) over the 4px scale. This test pins that the token
 * BUILD emits them into `allowed-tokens.json` — the SAME single source of truth
 * the lint guardrails (#234) and the showcase (#346) read — so a role/threshold
 * cannot silently drop out of the pipeline, and each role stays ALIASED to its
 * canvas §09 scale primitive rather than a forked one-off value.
 */
const cssVariables: string[] = manifest.cssVariables;
const themeKeys: string[] = manifest.themeKeys;
const references: Record<string, string> = manifest.references;
const spacingScalePx: number[] = manifest.spacingScalePx;
const breakpoints: { name: string; value: string }[] = manifest.breakpoints;

describe("layout container tokens", () => {
  it("enumerates the content/calendar widths + fluid/mobile gutters as consumable, protected vars", () => {
    for (const name of [
      "--layout-container-content",
      "--layout-container-calendar",
      "--layout-gutter",
      "--layout-gutter-mobile",
    ]) {
      expect(cssVariables).toContain(name);
    }
  });

  it("aliases the fixed mobile gutter to the 16px gutter endpoint (no forked value)", () => {
    expect(references["--layout-gutter-mobile"]).toBe("--layout-gutter-min");
  });
});

describe("layout breakpoint", () => {
  it("emits the desktop layout threshold (901px) as a @theme breakpoint", () => {
    // 56.3125rem = 901px — the mobile(≤900)/desktop(≥901) layout boundary; a
    // @theme key (drives the `desktop:` Tailwind variant), not a :root var.
    expect(themeKeys).toContain("--breakpoint-desktop");
    expect(
      breakpoints.find((b) => b.name === "--breakpoint-desktop")?.value,
    ).toBe("56.3125rem");
  });
});

describe("semantic spacing roles", () => {
  // The canvas §09 role → scale-primitive contract. Each role aliases a
  // `space.*` step; the manifest records the alias so a re-spacing is a red test.
  const ROLE_ALIAS: Record<string, string> = {
    "--space-inset-sm": "--space-4", // 16
    "--space-inset-md": "--space-5", // 20
    "--space-inset-lg": "--space-6", // 24
    "--space-inset-xl": "--space-7-5", // 30
    "--space-stack": "--space-7", // 28 (desktop; 0 on mobile)
    "--space-section-sm": "--space-11", // 44
    "--space-section-lg": "--space-12", // 48
    "--space-control-sm": "--space-2", // 8
    "--space-control-md": "--space-2-5", // 10
    "--space-control-lg": "--space-3", // 12
    "--space-inline-sm": "--space-1-5", // 6
    "--space-inline-md": "--space-2", // 8
    "--space-band": "--space-0", // 0 bleed
  };

  it("emits every role as a consumable :root var", () => {
    for (const name of Object.keys(ROLE_ALIAS)) {
      expect(cssVariables).toContain(name);
    }
  });

  it("aliases each role to its canvas §09 scale primitive (layering intact)", () => {
    for (const [role, primitive] of Object.entries(ROLE_ALIAS)) {
      expect(references[role]).toBe(primitive);
    }
  });

  it("carries the 30px and 44px scale steps the roles introduce (rhythmguard scale)", () => {
    // The effective spacing scale (the arbitrary-spacing gate) must admit the
    // role values, so a composition hits the rhythm without an arbitrary value.
    expect(spacingScalePx).toContain(30);
    expect(spacingScalePx).toContain(44);
  });
});
