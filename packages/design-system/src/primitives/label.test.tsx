import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Label } from "./label";

afterEach(cleanup);

/**
 * Neo-brutalist label contract (#512): the field label is 12/700
 * (`text-xs font-bold`), the compact bold caption the language uses over every
 * control, and it still dims with its paired (`peer`) disabled input.
 */
describe("Label neo-brutalist contract", () => {
  it("is a 12/700 caption that dims with a disabled peer input", () => {
    render(<Label data-testid="lbl">Email</Label>);
    const lbl = screen.getByTestId("lbl");
    expect(lbl).toHaveClass("text-xs", "font-bold");
    expect(lbl).toHaveClass("peer-disabled:opacity-70");
  });
});
