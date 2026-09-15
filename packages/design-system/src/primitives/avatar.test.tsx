import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar } from "./avatar";
import { buttonVariants } from "./button";
import { HEADER_CHIP_SURFACE } from "./header-chip";

afterEach(cleanup);

/**
 * Neo-brutalist initials avatar (#513, source §05): a 40×40 SQUARE (radius 0),
 * centred initials 14px/800. Two tonal fills. Token-only, both themes.
 */
describe("Avatar (#513)", () => {
  it("is a 40px square with centred extrabold initials (default action fill)", () => {
    render(<Avatar>АС</Avatar>);
    const av = screen.getByText("АС");
    expect(av).toHaveClass(
      "size-10",
      "items-center",
      "justify-center",
      "text-sm",
      "font-extrabold",
      "bg-primary-action",
      "text-primary-foreground",
    );
    expect(av.className).not.toMatch(/\brounded-/);
  });

  it("tint variant swaps to the pale tint fill", () => {
    render(<Avatar variant="tint">МВ</Avatar>);
    expect(screen.getByText("МВ")).toHaveClass("bg-tint", "text-tint-foreground");
  });

  it("header variant is the white-on-header canvas chip, static (no press chain)", () => {
    render(<Avatar variant="header">ИП</Avatar>);
    const av = screen.getByText("ИП");
    expect(av).toHaveClass(
      "bg-header-foreground",
      "text-header-chip-foreground",
      "shadow-header-chip",
    );
    // The variant is for chips that are NOT links: no hover/press affordance
    // (020 EARS-4 forbids a dead one). The interactive chip is the Button
    // `on-primary` variant.
    expect(av.className).not.toMatch(/\b(hover|active):/);
  });

  it("the static header chip and the interactive one share one surface constant", () => {
    // #1145 lesson: the dark-safe `shadow-header-chip` cast is declared ONCE,
    // in HEADER_CHIP_SURFACE, and BOTH consumers compose it — the `header`
    // Avatar (static) and the `on-primary` Button (interactive, #2180).
    const interactive = buttonVariants({ variant: "on-primary" }).split(" ");
    for (const cls of HEADER_CHIP_SURFACE.split(" ")) {
      expect(interactive).toContain(cls);
    }
  });
});
