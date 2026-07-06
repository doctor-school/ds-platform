"use client";

import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";

import { cn } from "../lib/utils";

/**
 * One-time-code field for the email-OTP / SMS-OTP login flows (003 F3, EARS-6/7).
 * Built on `input-otp`: a single hidden input drives a row of visual slots, so
 * paste, autofill (`autocomplete="one-time-code"`), and mobile keyboards all
 * work while each digit renders as its own cell.
 */
const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName,
    )}
    className={cn("disabled:cursor-not-allowed", className)}
    {...props}
  />
));
InputOTP.displayName = "InputOTP";

const InputOTPGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
  // `w-full` so the slots (each `flex-1`) distribute the AVAILABLE width and the row
  // can never exceed its container — the #544 fix. On a wide card the slots cap at the
  // canvas 40px (`max-w-10`) and pack at the start (leftover space, same left-aligned
  // look as before); on a narrow card (login = 8 slots at 390px) they shrink to fit
  // instead of overflowing the card body.
  <div ref={ref} className={cn("flex w-full items-center", className)} {...props} />
));
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext);
  const slot = inputOTPContext.slots[index];
  const char = slot?.char;
  const hasFakeCaret = slot?.hasFakeCaret;
  const isActive = slot?.isActive;

  return (
    <div
      ref={ref}
      className={cn(
        // Neo-brutalist OTP slot (#512, source §07): a square cell capped at the
        // canvas 40px (`--otp-slot-size` = 2.5rem = `max-w-10`) with a hard 2px border,
        // tabular uppercase digits. `flex-1 aspect-square min-w-0` (#544) lets the cell
        // fill an equal share of the `w-full` group and stay square while SHRINKING below
        // 40px when the row would otherwise overflow a narrow card (login = 8 slots at
        // 390px); on a wide card it caps at 40px, so the 6-slot verify/reset rows are
        // unchanged. Shared edges via `border-y-2 border-r-2` + `first:border-l-2` so
        // neighbours don't double. Empty = `hairline`; FILLED switches to the ink
        // `border` (source "filled ⇒ border ink"); the ACTIVE slot takes the brand
        // `ring` border + the flush 3px `shadow-focus`. Token-only → light + `.dark`.
        "relative flex aspect-square min-w-0 max-w-10 flex-1 items-center justify-center border-y-2 border-r-2 first:border-l-2 text-sm font-bold uppercase tabular-nums text-foreground transition-all",
        char ? "border-border" : "border-hairline",
        isActive && "z-10 border-ring shadow-focus",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
});
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    <span aria-hidden className="text-muted-foreground">
      &ndash;
    </span>
  </div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
