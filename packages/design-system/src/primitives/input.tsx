import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/** True when a field value counts as "filled" — mirrors the OTP slot's `char`
 * has-value signal (#529, source §07). `0`/`false` are legitimate values, only
 * `null`/`undefined`/`""` are empty. */
function hasValue(v: unknown): boolean {
  return v != null && v !== "";
}

/**
 * Neo-brutalist text input (#512, re-skin from `design-source/ds-foundation.dc.html`,
 * §07 field states). Square, a hard 2px border: `hairline` at rest → the ink
 * `border` once **filled** (#529, source §07 `Filled` cell) → the brand `ring`
 * (blue.300) on focus with the flush 3px focus ring (`shadow-focus`, no offset gap —
 * the source's `border-color:#6BB1F7; box-shadow:0 0 0 3px …`).
 *
 * The filled cue is a JS has-value signal (mirroring the OTP slot's `char ?
 * border-border : border-hairline`), NOT a pure-CSS `:placeholder-shown` rule — a
 * placeholder-less input is never `:placeholder-shown`, so CSS would misfire. It is
 * seeded from `value`/`defaultValue` and tracked on change, so it is correct for
 * controlled (derived from `value` each render) AND uncontrolled (state seeded from
 * `defaultValue`, updated on input) usage. The resting border is a BASE class the
 * higher-specificity state variants (`focus-visible:`, `disabled:`, `aria-invalid:`)
 * still override, so focus/disabled/error win over the filled ink border unchanged.
 *
 * Invalidity is carried on the control itself (K-3, #333): a destructive border +
 * the pale `destructive-tint` fill (source `dangerTint`), set by `FormControl`'s
 * `aria-invalid`. The success cell (source §07) is the mirror — a green `success`
 * border + pale `success-tint` fill, keyed on `data-success` threaded by the field
 * composite. Disabled dims to the muted track. Token-only → light + `.dark`.
 *
 * `variant="header"` is the SAME control on the invariant navy band of
 * `design-source/ds-shell.dc.html` (line 24 / line 62): a transparent field with
 * the translucent white hairline, white 600-weight type, a white placeholder and
 * a solid-white border on focus. It lives here, not at the storefront call site,
 * so both storefronts get the band field from one definition (#2180, ADR-0013 §6).
 */
const inputVariants = cva("", {
  variants: {
    variant: {
      default: "",
      header:
        "border-header-hairline bg-transparent font-semibold text-header-foreground placeholder:text-header-foreground focus-visible:border-header-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface InputProps
  extends React.ComponentProps<"input">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, type, variant, value, defaultValue, onChange, ...props },
    ref,
  ) => {
    const isControlled = value !== undefined;
    const [uncontrolledFilled, setUncontrolledFilled] = React.useState(() =>
      hasValue(defaultValue),
    );
    const filled = isControlled ? hasValue(value) : uncontrolledFilled;
    return (
      <input
        type={type}
        value={value}
        defaultValue={defaultValue}
        data-filled={filled ? "true" : undefined}
        onChange={(e) => {
          if (!isControlled) setUncontrolledFilled(hasValue(e.target.value));
          onChange?.(e);
        }}
        className={cn(
          "flex h-11 w-full border-2 bg-card px-3.5 py-3 text-sm text-foreground transition-colors",
          // Resting border: ink once filled, hairline when empty (base class — the
          // state variants below have higher specificity and still win).
          filled ? "border-border" : "border-hairline",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-muted disabled:text-muted-foreground",
          "data-[success=true]:border-success data-[success=true]:bg-success-tint",
          "aria-invalid:border-destructive aria-invalid:bg-destructive-tint",
          // The surface variant emits LAST of the primitive's own classes, so it
          // wins the resting border, background, ink and focus border over the
          // base; a positional utility from the call site still wins over it.
          inputVariants({ variant }),
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input, inputVariants };
