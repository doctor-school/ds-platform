"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Controller, FormProvider, useFormContext } from "react-hook-form";
import type { ControllerProps, FieldPath, FieldValues } from "react-hook-form";

import { cn } from "../lib/utils";
import { Label } from "./label";

/**
 * shadcn/ui `<Form>` set — the canonical RHF binding (ADR-0004 §9). `<Form>` is
 * RHF's `FormProvider`; `<FormField>` is a typed `Controller`; the accessibility
 * wiring (`aria-describedby`, `aria-invalid`, id linkage) is derived once in
 * `useFormField` so every field is labelled and error-announced consistently.
 */
const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue,
);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(
  props: ControllerProps<TFieldValues, TName>,
) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue,
);

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

  if (!fieldContext.name) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

const FormItem = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => {
    const id = React.useId();
    return (
      <FormItemContext.Provider value={{ id }}>
        {/* `gap-2.5` (10px), not the standard doc's `space-y-1.5` (6px): the
            control's `interactiveBase` `focus-visible:ring-2 ring-offset-2`
            extends ~4px above the input, so a 6–8px label→control gap left the
            ring visually touching the label. 10px clears it with air to spare —
            live-proven on the dev stand (#227/#267 owner finding), and the
            standard (ADR-0013 §7 / README) is corrected to this value with the
            ring-clearance rationale so doc == shipped reality. */}
        <div
          ref={ref}
          className={cn("flex flex-col gap-2.5", className)}
          {...props}
        />
      </FormItemContext.Provider>
    );
  },
);
FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => {
  // K-3 (#333): the label stays NEUTRAL on error. Invalidity is carried by the
  // input border + the error message (NN/g: mark the field, not the text); a red
  // label stacked on a red message + red helper is the "red mush" the owner flagged.
  const { formItemId } = useFormField();
  return <Label ref={ref} className={className} htmlFor={formItemId} {...props} />;
});
FormLabel.displayName = "FormLabel";

const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();
  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={
        error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId
      }
      aria-invalid={!!error}
      {...props}
    />
  );
});
FormControl.displayName = "FormControl";

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<"p">
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField();
  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});
FormDescription.displayName = "FormDescription";

/**
 * Single source of the form message style (ADR-0013 §7). The error tone and the
 * helper tone live **here, once** — `FormMessage` (field-level) and `FormError`
 * (form-level submit/auth error) both compose these, so the error look is defined
 * in one place, never re-typed as a raw `text-xs text-destructive` `<p>` on each
 * page (the #333 Stage-B finding). Token-only.
 */
const FORM_MESSAGE_TEXT = "text-xs";
// Neo-brutalist error row (#512): 12/700 danger — the loud, bold error the
// language uses, led by a ⚠ marker. The helper stays quiet (muted, not bold).
const FORM_ERROR_TONE = "font-bold text-destructive";
const FORM_HELPER_TONE = "text-muted-foreground";

/**
 * Decorative danger marker for an error row (`⚠ `). `aria-hidden` so a screen
 * reader announces just the message text (the row already carries `role="alert"`),
 * not the emoji name.
 */
function ErrorMarker() {
  return <span aria-hidden="true">⚠ </span>;
}

/**
 * Inline validation message (ADR-0013 §7 → "Form layout & validation contract",
 * #333 redo of the slice-B standard — owner-picked **1A inline**).
 *
 * The message renders **on demand** directly under its control: it shows the
 * field's **helper** (muted) by default and **swaps the error in place**
 * (destructive) on validation failure. A field with **neither** a helper nor an
 * error renders **nothing at all** — no reserved blank line. This is the fix for
 * the slice-B over-spacing (K-1): the old `min-h-5` always-reserved line stacked
 * a permanent gap under every field. The cost of inline is a small, accepted
 * downward shift (~one 12px line) when an error appears — the Polaris / Primer /
 * shadcn / Radix default, validated on blur (`mode: onTouched`) so it never fires
 * mid-typing.
 *
 * The text is **small (`text-xs`) and NOT bold** (the slice-B bold/`text-sm`
 * error read "heavy"); the field's invalidity is carried by the input border +
 * this message, not a red label (K-3). It hugs its control via the `FormItem`
 * `gap-2.5`, and the form's `space-y-4` keeps it clearly closer to its own field
 * than to the next one (proximity / Gestalt — the message must not read as
 * attached to the following field's label).
 *
 * Composition:
 *  - pass `children` (the localized helper) for a field with helper text — muted
 *    by default, replaced in place by the destructive error when invalid;
 *  - pass NO children for a validating field with no helper — nothing renders
 *    until an error, then the error appears inline;
 *  - the element owns the helper id when resting and the message id (+ `role`
 *    `alert`) when erroring, so `aria-describedby` (set on `FormControl`) resolves
 *    whichever content is showing and the error is announced.
 */
const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<"p">
>(({ className, children, ...props }, ref) => {
  const { error, formDescriptionId, formMessageId } = useFormField();
  const errorText = error ? String(error?.message ?? "") : "";
  const hasError = errorText.length > 0;
  // Helper (children) shows by default; the error swaps into its place when
  // present — the two never coexist.
  const body = hasError ? errorText : children;
  const hasBody = hasError || (children != null && children !== false);

  // Inline (1A): a resting field with no message reserves no space at all.
  if (!hasBody) return null;

  return (
    <p
      ref={ref}
      // Owns the message id when erroring (so `aria-describedby` resolves it) and
      // the description id when showing the helper.
      id={hasError ? formMessageId : formDescriptionId}
      className={cn(
        FORM_MESSAGE_TEXT,
        hasError ? FORM_ERROR_TONE : FORM_HELPER_TONE,
        className,
      )}
      role={hasError ? "alert" : undefined}
      {...props}
    >
      {hasError ? <ErrorMarker /> : null}
      {body}
    </p>
  );
});
FormMessage.displayName = "FormMessage";

/**
 * Form-level error (ADR-0013 §7). The **single** primitive for a submit/auth
 * error that is not tied to one field — e.g. the EARS-16 generic login/register
 * outcome, a 429/5xx/network message. It owns the error style from the shared
 * source (same `text-xs text-destructive` as a `FormMessage` error) so the look
 * is defined in **one place**; pages render `<FormError>{error}</FormError>`
 * instead of hand-typing a raw `<p role="alert" className="…">` each time (the
 * #333 Stage-B finding — the error style must live in the design system, not be
 * duplicated per screen). Renders nothing when there is no message.
 */
const FormError = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<"p">
>(({ className, children, ...props }, ref) => {
  const hasBody = children != null && children !== false && children !== "";
  if (!hasBody) return null;
  return (
    <p
      ref={ref}
      role="alert"
      className={cn(FORM_MESSAGE_TEXT, FORM_ERROR_TONE, className)}
      {...props}
    >
      <ErrorMarker />
      {children}
    </p>
  );
});
FormError.displayName = "FormError";

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormError,
  FormField,
};
