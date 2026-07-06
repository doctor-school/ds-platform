import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar } from "./avatar";

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
});
