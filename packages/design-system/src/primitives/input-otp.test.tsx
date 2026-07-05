import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "./input-otp";

afterEach(cleanup);

/**
 * Neo-brutalist OTP-slot contract (#512): each slot is a square 2px-bordered
 * cell with tabular, uppercase glyphs; a FILLED slot carries the ink
 * (`border-input`) border while an empty one stays muted — so a partially-typed
 * code reads its progress by border weight.
 */
describe("InputOTPSlot neo-brutalist contract", () => {
  function renderSlots(value: string) {
    return render(
      <InputOTP maxLength={4} value={value} onChange={() => {}} aria-label="code">
        <InputOTPGroup>
          <InputOTPSlot index={0} data-testid="s0" />
          <InputOTPSlot index={1} data-testid="s1" />
        </InputOTPGroup>
      </InputOTP>,
    );
  }

  it("slots are square 2px cells with tabular uppercase glyphs", () => {
    const { getByTestId } = renderSlots("");
    const slot = getByTestId("s0");
    expect(slot).toHaveClass("rounded-none", "border-2", "uppercase", "tabular-nums");
  });

  it("a filled slot takes the ink border; an empty slot stays muted", () => {
    const { getByTestId } = renderSlots("1");
    // index 0 is filled ("1"), index 1 is empty.
    expect(getByTestId("s0")).toHaveClass("border-input");
    expect(getByTestId("s1")).toHaveClass("border-muted-2");
  });
});
