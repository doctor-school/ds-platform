"use client";

import * as React from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "../input";
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from "../form";

/**
 * Localized copy for the show-password toggle (003 EARS-38). RU defaults live in
 * the primitive — house style for this design system (`alert`, `alert-dialog`,
 * `badge` all ship RU defaults) — so every host, including the doctor storefront,
 * gets the affordance without per-app wiring; a localized host overrides them from
 * its message catalog (EARS-21).
 */
export type PasswordRevealLabels = {
  /** Visible text while the field is masked. */
  show: string;
  /** Visible text while the field is revealed. */
  hide: string;
  /** Accessible name while masked (defaults to `show`). */
  showAria?: string;
  /** Accessible name while revealed (defaults to `hide`). */
  hideAria?: string;
};

const DEFAULT_REVEAL_LABELS: Required<PasswordRevealLabels> = {
  show: "Показать",
  hide: "Скрыть",
  showAria: "Показать пароль",
  hideAria: "Скрыть пароль",
};

/**
 * The control row: the masked/plain `<Input>` plus the reveal toggle overlaid on
 * its right edge, per the owner canvas (`design-source/auth.dc.html`, `#d-register`
 * — a relative wrapper, the input reserving room on the right, a borderless text
 * button «Показать»/«Скрыть» in the accent at 12px/800).
 *
 * Split out of `PasswordField` because the toggle needs `useFormField()` for the
 * control id it points `aria-controls` at, and that hook only resolves BELOW the
 * `FormItem` that `PasswordField` itself renders.
 *
 * 003 EARS-38 invariants encoded here:
 *   • masked by default — `useState(false)`, local to this instance, so one field
 *     never leaks its revealed state to another and nothing survives a page load
 *     (no storage, no URL, no context);
 *   • rendering-only — the toggle mutates neither the RHF value nor anything else
 *     (no `onChange`, no submit, no copy, no log);
 *   • value + caret preserved — the selection is captured before the type swap and
 *     re-applied (with focus) in a layout effect, because swapping `type` resets
 *     the text-editing state of the control and drops the selection.
 */
function PasswordControl<T extends FieldValues>({
  field,
  purpose,
  placeholder,
  testId,
  revealLabels,
}: {
  field: ControllerRenderProps<T>;
  purpose: "new" | "current";
  placeholder?: string;
  testId?: string;
  revealLabels?: PasswordRevealLabels;
}) {
  const { formItemId } = useFormField();
  const [revealed, setRevealed] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const caretRef = React.useRef<{
    start: number | null;
    end: number | null;
    /** The field held focus when the toggle fired — only then is a caret live. */
    focused: boolean;
  } | null>(null);

  React.useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = caretRef.current;
    caretRef.current = null;
    // Only re-apply the caret when the field actually held it. Never STEAL focus:
    // a keyboard user activates the toggle from the toggle, and pulling focus into
    // the input would make the control impossible to press a second time.
    if (!input || !caret || !caret.focused) return;
    if (document.activeElement !== input) input.focus();
    try {
      input.setSelectionRange(caret.start ?? 0, caret.end ?? caret.start ?? 0);
    } catch {
      // `setSelectionRange` throws on input types that do not support selection;
      // both `password` and `text` do, so this is belt-and-braces only.
    }
  }, [revealed]);

  const labels = { ...DEFAULT_REVEAL_LABELS, ...revealLabels };
  const text = revealed ? labels.hide : labels.show;
  const accessibleName = revealed
    ? (labels.hideAria ?? labels.hide)
    : (labels.showAria ?? labels.show);

  return (
    <div className="relative">
      <FormControl>
        <Input
          type={revealed ? "text" : "password"}
          autoComplete={purpose === "new" ? "new-password" : "current-password"}
          data-testid={testId}
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...field}
          value={field.value ?? ""}
          // `pr-14` (56px) reserves the canvas right gutter for the 48px (`w-12`)
          // toggle so the typed value never runs under the control. Token-only —
          // arbitrary Tailwind values are lint-blocked (ADR-0013).
          className="pr-14"
          ref={(node: HTMLInputElement | null) => {
            inputRef.current = node;
            const rhfRef: unknown = field.ref;
            if (typeof rhfRef === "function") {
              (rhfRef as (n: HTMLInputElement | null) => void)(node);
            } else if (rhfRef && typeof rhfRef === "object") {
              (rhfRef as { current: HTMLInputElement | null }).current = node;
            }
          }}
        />
      </FormControl>
      <button
        type="button"
        // Deliberately not the `<Button>` primitive: the canvas control is a
        // borderless in-field text affordance with none of the button primitive
        // border/offset cast. It is still a real button — Enter/Space, tab order
        // right after the input, the shared `shadow-focus` ring token.
        aria-pressed={revealed}
        aria-controls={formItemId}
        aria-label={accessibleName}
        {...(testId ? { "data-testid": `${testId}-reveal` } : {})}
        // Pressing the toggle with a pointer must not pull focus out of the field:
        // suppressing the mousedown focus keeps the caret where the user left it,
        // which is what makes "caret preserved across a toggle" observable at all.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const input = inputRef.current;
          caretRef.current = input
            ? {
                start: input.selectionStart,
                end: input.selectionEnd,
                focused: document.activeElement === input,
              }
            : null;
          setRevealed((prev) => !prev);
        }}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center bg-transparent text-xs font-extrabold text-primary-action hover:underline focus-visible:shadow-focus focus-visible:outline-none"
      >
        {text}
      </button>
    </div>
  );
}

/**
 * `<PasswordField>` (#197) — the semantic password primitive. `type="password"` is
 * the resting state (003 EARS-38 defaults to masked); the call site chooses the
 * autocomplete posture via `purpose`:
 *   • `purpose="new"`  → `autoComplete="new-password"` (registration / reset
 *     creation). The composing form pairs this with the `NewPasswordFieldSchema`
 *     fragment (the 003 EARS-36 length-only baseline), and the policy hint is
 *     shown by default (when a `policyHint` string is supplied).
 *   • `purpose="current"` → `autoComplete="current-password"` (login). Paired with
 *     the permissive `CurrentPasswordFieldSchema` (min 8) so a legacy credential
 *     still authenticates (#147); no policy hint (it is a login, not a creation).
 *
 * The widget does not pick the resolver fragment — the form composes that — but it
 * guarantees the autocomplete + policy-hint pairing is always consistent with the
 * purpose, which is the per-call wiring this primitive removes.
 *
 * Every password surface (register, reset-complete, password login) carries the
 * show-password toggle from HERE (003 EARS-38, design §15.5) — one primitive, not
 * three hand-rolled variants.
 *
 * i18n contract (#235): no copy lives here — the app supplies `label` and the
 * `policyHint` text (rendered only for `purpose="new"` unless overridden). The one
 * exception is the RU default copy of the reveal toggle, overridable per host via
 * `revealLabels`.
 */
export function PasswordField<T extends FieldValues>({
  field,
  purpose,
  label,
  placeholder,
  policyHint,
  showPolicy,
  revealLabels,
  testId,
}: {
  field: ControllerRenderProps<T>;
  /** `new` (creation) or `current` (login) — drives `autoComplete` + the hint. */
  purpose: "new" | "current";
  /** Field label (app-supplied, localized). */
  label: string;
  /** Optional placeholder (app-supplied, localized) forwarded to the input. */
  placeholder?: string;
  /** Localized password-policy hint copy (app-supplied); shown when policy is on. */
  policyHint?: string;
  /**
   * Show the password-policy hint. Defaults to `true` for `purpose="new"` (the
   * creation surfaces show the length baseline) and `false` for `current`. The
   * hint only renders when both `showPolicy` resolves true AND a `policyHint` string
   * is supplied.
   */
  showPolicy?: boolean;
  /** Localized override for the reveal toggle copy (003 EARS-38 / EARS-21). */
  revealLabels?: PasswordRevealLabels;
  /**
   * Optional `data-testid` for the input (the e2e relies on stable test ids); the
   * reveal toggle carries the same id suffixed with `-reveal`.
   */
  testId?: string;
}) {
  const withPolicy = showPolicy ?? purpose === "new";
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <PasswordControl
        field={field}
        purpose={purpose}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(testId !== undefined ? { testId } : {})}
        {...(revealLabels !== undefined ? { revealLabels } : {})}
      />
      {/* Inline message (ADR-0013 §7, #333): the policy hint is the FormMessage's
          helper `children` (muted by default), swapped IN PLACE by the destructive
          error — one element, one id. Rendering a separate <FormDescription> would
          duplicate `formDescriptionId`. `purpose="current"` (login, no policy)
          passes no children → nothing renders until an error (no reserved line). */}
      <FormMessage>{withPolicy && policyHint ? policyHint : undefined}</FormMessage>
    </FormItem>
  );
}
