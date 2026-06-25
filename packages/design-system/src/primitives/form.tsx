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
  const { error, formItemId } = useFormField();
  return (
    <Label
      ref={ref}
      className={cn(error && "text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
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
 * No-reflow validation slot (ADR-0013 §7 → "Form layout & validation contract").
 *
 * One persistent one-line slot (`min-h-5` = a single `text-sm`/`leading-5` 20px
 * line) that holds the field's **helper** (`FormDescription` styling) by default
 * and **swaps the error in place** (`FormMessage` styling) on validation failure.
 * The wrapper height is constant across the resting → helper → error states, so
 * the form NEVER reflows when an error appears or clears (defect #7), and because
 * the helper and the error share the one slot it is not an extra always-blank gap
 * line over every field (defect #1).
 *
 * Composition:
 *  - pass `children` (the localized helper) for a field with helper text — it
 *    renders as the muted description and is replaced in place by the destructive
 *    error when the field is invalid;
 *  - pass NO children for a validating field with no helper — the slot reserves
 *    the line silently (empty + `aria-hidden`) and shows only the error;
 *  - a field that can NEITHER validate NOR show a helper simply omits
 *    `<FormMessage/>` and stacks on the field-group rhythm — no reserved line.
 *
 * `aria-describedby` (set on `FormControl`) already points the control at both the
 * description id and the message id, so the helper↔error swap is announced. When
 * the error is showing the slot carries `role="alert"` so it is announced as an
 * error, and it drops `aria-hidden` only when it has real content.
 */
const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<"p">
>(({ className, children, ...props }, ref) => {
  const { error, formDescriptionId, formMessageId } = useFormField();
  const errorText = error ? String(error?.message ?? "") : "";
  const hasError = errorText.length > 0;
  // Helper (children) shows by default; the error swaps into the SAME slot in
  // place when present — the two never coexist, so the reserved height is constant.
  const body = hasError ? errorText : children;
  const hasBody = hasError || (children != null && children !== false);

  return (
    <p
      ref={ref}
      // The slot owns BOTH ids so `aria-describedby` resolves whichever content is
      // showing (the helper id when resting, the message id when erroring).
      id={hasError ? formMessageId : formDescriptionId}
      className={cn(
        "min-h-5 text-sm",
        hasError ? "font-medium text-destructive" : "text-muted-foreground",
        className,
      )}
      // Announce the error as an alert; an empty reserved line stays out of the
      // a11y tree until it carries real content.
      role={hasError ? "alert" : undefined}
      aria-hidden={hasBody ? undefined : true}
      {...props}
    >
      {body}
    </p>
  );
});
FormMessage.displayName = "FormMessage";

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
