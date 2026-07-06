import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input } from "./input";
import { Label } from "./label";
import { Card, CardTitle } from "./card";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./input-otp";

afterEach(cleanup);

/**
 * Neo-brutalist re-skin contract (#512, fidelity SoT
 * `design-source/design-system.dc.html`). The rendered look is CSS proven live on
 * the dev stand; this pins the token-class contract jsdom can assert for the
 * non-clickable primitives that have no existing class test — square radius-0,
 * hard 2px borders, the flush 3px `shadow-focus` ring, and the hard offset cast.
 * Every assertion is token-only (no arbitrary values).
 */
describe("Input — hard 2px border, flush focus ring, danger-tint error (#512)", () => {
  it("rests on a 2px hairline border and focuses to the brand ring + flush shadow", () => {
    render(<Input aria-label="x" data-testid="inp" />);
    const inp = screen.getByTestId("inp");
    expect(inp).toHaveClass("border-2", "border-hairline", "bg-background");
    expect(inp).toHaveClass(
      "focus-visible:border-ring",
      "focus-visible:shadow-focus",
    );
    // Square — no rounded utility leaks a corner.
    expect(inp.className).not.toMatch(/\brounded-/);
    // No soft blur shadow at rest (neo-brutal is offset-only).
    expect(inp.className).not.toMatch(/\bshadow-sm\b/);
  });
});

describe("Label — 12px weight-700 (#512)", () => {
  it("is text-xs font-bold", () => {
    render(<Label data-testid="lbl">Email</Label>);
    expect(screen.getByTestId("lbl")).toHaveClass("text-xs", "font-bold");
  });
});

describe("Card — hard 2px border on the 6px elevation offset cast (#512)", () => {
  it("carries border-2 + border-border + shadow-lg, square", () => {
    render(<Card data-testid="card">body</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("border-2", "border-border", "shadow-lg");
    expect(card.className).not.toMatch(/\brounded-/);
  });

  it("titles at text-lg font-bold", () => {
    render(<CardTitle data-testid="t">Title</CardTitle>);
    expect(screen.getByTestId("t")).toHaveClass("text-lg", "font-bold");
  });
});

describe("Tabs — hard-bordered segment control (#512)", () => {
  it("the list is a single 2px-bordered container (no rounding, no muted pill)", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList data-testid="list">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByTestId("list");
    expect(list).toHaveClass("border-2", "border-border");
    expect(list.className).not.toMatch(/\brounded-/);
    expect(list.className).not.toMatch(/\bbg-muted\b/);
  });

  it("selected segment fills the accessible action colour (weight 800), divided by a 2px rule", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" data-testid="seg">
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const seg = screen.getByTestId("seg");
    expect(seg).toHaveClass(
      "data-[state=active]:bg-primary-action",
      "data-[state=active]:text-primary-foreground",
      "data-[state=active]:font-extrabold",
      "border-l-2",
      "first:border-l-0",
    );
    // Flush focus ring, not the generic ring-with-offset.
    expect(seg).toHaveClass("focus-visible:shadow-focus");
  });
});

describe("InputOTP slot — 40px square that may shrink to fit, 2px border, filled ⇒ ink (#512/#544)", () => {
  it("renders empty slots as 40px-preferred squares that may shrink (min-w-0); group content-sized + shrinkable", () => {
    render(
      <InputOTP maxLength={4} value="" onChange={() => {}} aria-label="code">
        <InputOTPGroup data-testid="group">
          <InputOTPSlot index={0} data-testid="slot0" />
          <InputOTPSlot index={1} />
        </InputOTPGroup>
      </InputOTP>,
    );
    // #544: the group stays CONTENT-sized (no `w-full` — multi-group compositions with
    // a separator keep their wide-layout geometry) but carries `min-w-0` so it may
    // shrink inside a narrow container; each slot keeps the preferred `w-10` square
    // (`aspect-square`, the approved #512 deviation from the canvas 42×52 wrap) plus
    // `min-w-0` so an 8-slot login row compresses to fit at 390px instead of
    // overflowing.
    const group = screen.getByTestId("group");
    expect(group).toHaveClass("min-w-0");
    expect(group.className.split(/\s+/)).not.toContain("w-full");
    const slot = screen.getByTestId("slot0");
    expect(slot).toHaveClass(
      "aspect-square",
      "w-10",
      "min-w-0",
      "border-y-2",
      "border-r-2",
      "border-hairline",
      "tabular-nums",
    );
    // Fixed height is gone — `aspect-square` keeps the cell square as it shrinks.
    expect(slot.className.split(/\s+/)).not.toContain("h-10");
    expect(slot.className).not.toMatch(/\brounded-/);
  });

  it("a filled slot switches to the ink structural border", () => {
    render(
      <InputOTP maxLength={4} value="7" onChange={() => {}} aria-label="code">
        <InputOTPGroup>
          <InputOTPSlot index={0} data-testid="filled" />
          <InputOTPSlot index={1} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(screen.getByTestId("filled")).toHaveClass("border-border");
  });
});
