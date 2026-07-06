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
  <div ref={ref} className={cn("flex items-center", className)} {...props} />
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
        // Neo-brutalist OTP slot (#512, source §07): a 40px square cell
        // (`--otp-slot-size` = 2.5rem = h-10/w-10) with a hard 2px border, tabular
        // uppercase digits. Shared edges via `border-y-2 border-r-2` + `first:border-l-2`
        // so neighbours don't double. Empty = `hairline`; FILLED switches to the ink
        // `border` (source "filled ⇒ border ink"); the ACTIVE slot takes the brand
        // `ring` border + the flush 3px `shadow-focus`. Token-only → light + `.dark`.
        "relative flex h-10 w-10 items-center justify-center border-y-2 border-r-2 first:border-l-2 text-sm font-bold uppercase tabular-nums text-foreground transition-all",
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
