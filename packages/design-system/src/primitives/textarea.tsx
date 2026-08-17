import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Official shadcn/ui Textarea composition, owned and re-skinned to DS tokens,
 * with the optional character counter the 012 authoring forms need (Stage A
 * #1282: «Счётчики символов … показываем "осталось N символов", текст не
 * обрезаем»).
 *
 * Geometry and state language mirror `Input` and `NativeSelect`, so a form that
 * mixes the three reads as one control family.
 *
 * The counter is deliberately NOT a hard truncation. Two reasons: silently
 * dropping characters loses an operator's work with no signal, and the server
 * schema in `@ds/schemas` is the authority on the bound anyway — the counter's
 * job is to make the limit visible before submit. When the value exceeds
 * `maxLength` the count turns destructive and the control renders invalid, which
 * is a truthful "this will be refused", not a fake block.
 *
 * form-rhythm-ok: the `min-h-24` below is the TEXTAREA's own minimum height (a
 * multi-line control has to start taller than one row), not a reserved slot on a
 * form-message element. The guard's heuristic reads it as a message element only
 * because the same class string carries `disabled:text-muted-foreground`; the
 * counter span underneath reserves NO height and renders only when asked for.
 *
 * Accessibility: the counter is announced politely (`aria-live="polite"`), so a
 * screen-reader user hears the remaining budget as it changes rather than on
 * every keystroke, and it is wired to the textarea through `aria-describedby`.
 */
export interface TextareaProps
  extends React.ComponentPropsWithoutRef<"textarea"> {
  /**
   * Render the remaining-characters counter. Requires `maxLength`; without one
   * there is no budget to count against and the counter stays hidden.
   *
   * NOTE: pass the bound as `maxLength` for the counter, and let the SCHEMA
   * refuse an over-long value — the native attribute alone would truncate
   * typing, which this component's contract forbids.
   */
  showCounter?: boolean;
  /**
   * Localized counter renderer, e.g. `(left) => `осталось ${left}``. Copy stays
   * in the consumer's typed RU catalogue — the design system ships no strings.
   */
  formatCounter?: (remaining: number, used: number, max: number) => string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      showCounter,
      formatCounter,
      maxLength,
      value,
      defaultValue,
      onChange,
      id,
      "aria-describedby": describedBy,
      ...props
    },
    ref,
  ) => {
    const isControlled = value !== undefined;
    const [uncontrolled, setUncontrolled] = React.useState(
      () => String(defaultValue ?? "").length,
    );
    const used = isControlled ? String(value ?? "").length : uncontrolled;
    const counterVisible =
      Boolean(showCounter) && typeof maxLength === "number" && maxLength > 0;
    const remaining = counterVisible ? maxLength - used : 0;
    const over = counterVisible && remaining < 0;
    const generatedId = React.useId();
    const counterId = counterVisible
      ? `${id ?? generatedId}-counter`
      : undefined;

    return (
      <span className="flex w-full flex-col gap-1.5">
        <textarea
          ref={ref}
          id={id ?? (counterVisible ? generatedId : undefined)}
          value={value}
          defaultValue={defaultValue}
          // No `maxLength` on the element: the budget is shown, never enforced
          // by truncation (see the component note above).
          aria-describedby={
            [describedBy, counterId].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={over ? true : props["aria-invalid"]}
          onChange={(event) => {
            if (!isControlled) setUncontrolled(event.target.value.length);
            onChange?.(event);
          }}
          className={cn(
            "flex min-h-24 w-full border-2 border-hairline bg-background px-3.5 py-3 text-sm text-foreground transition-colors",
            "hover:border-ring active:border-primary-action active:bg-muted",
            "focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-muted disabled:text-muted-foreground disabled:hover:border-hairline disabled:active:border-hairline",
            "aria-invalid:border-destructive aria-invalid:bg-destructive-tint aria-invalid:hover:border-destructive aria-invalid:active:border-destructive aria-invalid:active:bg-destructive-tint",
            className,
          )}
          {...props}
        />
        {counterVisible ? (
          <span
            id={counterId}
            aria-live="polite"
            className={cn(
              "self-end text-xs",
              over ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {formatCounter
              ? formatCounter(remaining, used, maxLength)
              : `${used} / ${maxLength}`}
          </span>
        ) : null}
      </span>
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
