import { describe, expect, it } from "vitest";

import { cn } from "./utils";
import { buttonVariants } from "../primitives/button";

/**
 * `cn()` must not misclassify our custom token font-size utilities (`text-2xs`,
 * `text-caption`, `text-body-compact`) as text COLOURS — otherwise tailwind-merge
 * drops the foreground colour when a size + a colour co-occur, which stripped the
 * `text-primary-foreground` off filled `sm` buttons and regressed WCAG contrast
 * (#512 review of #528). See the `extendTailwindMerge` config in `./utils.ts`.
 */
describe("cn() keeps a custom font-size AND a text colour (no group collision)", () => {
  it("does not drop the colour when a custom size follows it", () => {
    const out = cn("text-primary-foreground", "text-caption");
    expect(out).toContain("text-primary-foreground");
    expect(out).toContain("text-caption");
  });

  it("still resolves a real same-group conflict (two colours → last wins)", () => {
    const out = cn("text-primary-foreground", "text-destructive-foreground");
    expect(out).toContain("text-destructive-foreground");
    expect(out).not.toContain("text-primary-foreground");
  });

  it("still resolves a real font-size conflict (two sizes → last wins)", () => {
    const out = cn("text-sm", "text-caption");
    expect(out).toContain("text-caption");
    expect(out).not.toMatch(/(?:^|\s)text-sm(?:\s|$)/);
  });

  it.each(["2xs", "caption", "body-compact", "eyebrow", "title-lg"])(
    "keeps text-%s alongside a colour",
    (size) => {
      const out = cn("text-destructive-foreground", `text-${size}`);
      expect(out).toContain("text-destructive-foreground");
      expect(out).toContain(`text-${size}`);
    },
  );

  /**
   * The #1052/#1065 regression: the month-grid pill composes `text-eyebrow`
   * (11px) BEFORE its state colour (`text-tint-foreground` / the live pair) —
   * with `eyebrow` unregistered, tailwind-merge classified it as a COLOUR and
   * dropped it, so every composed pill fell back to the inherited 16px.
   */
  it("keeps text-eyebrow when a colour follows it (month-grid pill order)", () => {
    const out = cn("text-eyebrow", "text-tint-foreground");
    expect(out).toContain("text-eyebrow");
    expect(out).toContain("text-tint-foreground");
  });
});

/**
 * The regression itself: a filled `sm` button emits BOTH the accessible
 * foreground colour and the `text-caption` size — the colour is not stripped by
 * `cn()`'s merge, so contrast (white on blue.700 = 8.14:1) holds at `sm`.
 */
describe("sm filled buttons keep their accessible foreground colour", () => {
  it("default sm still carries text-primary-foreground + text-caption", () => {
    const cls = buttonVariants({ variant: "default", size: "sm" });
    expect(cls).toContain("text-primary-foreground");
    expect(cls).toContain("text-caption");
  });

  it("destructive sm still carries text-destructive-foreground + text-caption", () => {
    const cls = buttonVariants({ variant: "destructive", size: "sm" });
    expect(cls).toContain("text-destructive-foreground");
    expect(cls).toContain("text-caption");
  });
});
