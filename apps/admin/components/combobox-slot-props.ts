import type { ComponentPropsWithRef } from "react";

/**
 * What a form's `FormControl` slot hands its child — the trigger ref the form
 * focuses on an invalid submit, and the invalid state for assistive tech. A
 * selector that wraps the DS `Combobox` passes these through to its trigger, so
 * mounting it under `FormControl` behaves as the bare `Combobox` did.
 */
export type SlotProps = Pick<
  ComponentPropsWithRef<"button">,
  "ref" | "aria-invalid"
>;
