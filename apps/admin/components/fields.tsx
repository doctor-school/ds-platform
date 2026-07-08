"use client";

import * as React from "react";
import { cn, Label } from "@ds/design-system";

/**
 * Token-styled native `<select>` / `<textarea>`. The design-system registry has
 * NO select or textarea primitive today (adopt-before-bespoke, EARS-11: the
 * inventory came up empty for these two controls — recorded in the PR
 * `registry-research:` line), so these are native HTML controls carrying the SAME
 * token classes as the DS `<Input>` (`border-2 border-hairline bg-background …`),
 * not arbitrary Tailwind values — token-lint stays green. When a DS Select/Textarea
 * primitive lands, these swap for it with no call-site change.
 */
const CONTROL_CLASS =
  "flex w-full border-2 border-hairline bg-background px-3.5 py-3 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted aria-invalid:border-destructive aria-invalid:bg-destructive-tint";

export const TokenSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(CONTROL_CLASS, "h-11", className)} {...props} />
));
TokenSelect.displayName = "TokenSelect";

export const TokenTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(CONTROL_CLASS, "min-h-24", className)} {...props} />
));
TokenTextarea.displayName = "TokenTextarea";

/** A labelled field row — label + control + optional hint, on the DS grid rhythm. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
