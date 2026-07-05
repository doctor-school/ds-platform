import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar, AvatarFallback, avatarVariants } from "./avatar";

afterEach(cleanup);

/**
 * Avatar — Radix-avatar-backed initials chip. Two tonal variants (`solid` =
 * btn-bg, `tint`). The fallback initials render synchronously (no image), so
 * jsdom can assert the text + the accessible name.
 */
describe("Avatar", () => {
  it("renders fallback initials with an accessible label", () => {
    render(
      <Avatar aria-label="Dr. Anna Ivanova">
        <AvatarFallback>AI</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByLabelText("Dr. Anna Ivanova")).toBeInTheDocument();
  });

  it("solid variant uses the primary-action fill, tint variant the tint surface", () => {
    expect(avatarVariants({ variant: "solid" })).toMatch(/bg-primary-action/);
    expect(avatarVariants({ variant: "tint" })).toMatch(/bg-tint/);
  });

  it("is a square neo-brutalist frame with a hard border, no arbitrary values", () => {
    const cls = avatarVariants({ variant: "solid" });
    expect(cls).toMatch(/border-2/);
    expect(cls).not.toMatch(/\[#/);
  });
});
