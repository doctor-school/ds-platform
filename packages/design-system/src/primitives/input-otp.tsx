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
  // `gap-2` between cells so each slot carries its own 2px frame cleanly (no
  // doubled seams) and a filled cell's ink border reads distinct from its
  // muted-bordered empty neighbours.
  <div ref={ref} className={cn("flex items-center gap-2", className)} {...props} />
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
        // Neo-brutalist OTP cell (#512): a square 2px-bordered slot with tabular,
        // uppercase glyphs (a code renders as a fixed monospaced-width grid). A
        // FILLED cell takes the ink `border-input`; an empty one stays muted, so a
        // partially-typed code reads its progress by border weight. `h-10 w-10`
        // matches the `--otp-slot-size` token (2.5rem).
        "relative flex h-10 w-10 items-center justify-center rounded-none border-2 text-sm font-bold uppercase tabular-nums transition-all",
        char ? "border-input" : "border-muted-2",
        isActive && "z-10 border-input ring-2 ring-ring",
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
