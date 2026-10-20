import * as React from "react";

import { cn } from "../lib/utils";

/** True when a native select has moved beyond its empty placeholder option. */
function hasValue(value: unknown): boolean {
  return value != null && value !== "";
}

/** The text a node renders, flattened — an `<option>`'s label. */
function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

/** The label of the `<option>` whose value is `value`, searched through groups and fragments. */
function optionText(children: React.ReactNode, value: unknown): string {
  for (const child of React.Children.toArray(children)) {
    if (
      !React.isValidElement<{ value?: unknown; children?: React.ReactNode }>(
        child,
      )
    ) {
      continue;
    }
    if (child.type === "option") {
      const optionValue =
        child.props.value !== undefined
          ? child.props.value
          : nodeText(child.props.children);
      if (String(optionValue) === String(value)) {
        return nodeText(child.props.children);
      }
      continue;
    }
    const nested = optionText(child.props.children, value);
    if (nested) return nested;
  }
  return "";
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export type NativeSelectProps = React.ComponentPropsWithoutRef<"select"> & {
  /**
   * Show the chosen option in full on a line that wraps, instead of the
   * browser's single clipped line. A native `<select>` cannot wrap its own
   * value, so the visible box becomes a pointer-inert, `aria-hidden` mirror of
   * the selected option and the real select is laid transparently over it —
   * keyboard, type-ahead, form submission and the mobile picker stay native.
   * For a control whose option labels are product copy that can outgrow a
   * narrow column (#2838).
   */
  wrapValue?: boolean;
};

/** The control's box: Input's outer geometry (2px border, 14px inset, text-sm). */
const BOX =
  "w-full border-2 bg-card px-3.5 py-2.5 pr-10 text-sm transition-colors";

/**
 * Official shadcn/ui NativeSelect composition, owned and re-skinned to DS tokens.
 *
 * The browser keeps the actual `<select>` so keyboard navigation, type-ahead,
 * form submission, and mobile pickers remain platform-native. The wrapper only
 * positions a quiet, pointer-inert chevron; the control mirrors `Input`'s outer
 * geometry (44px, 2px border, 14px inset) and its filled / focus-visible /
 * invalid / disabled state language.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  (
    { className, value, defaultValue, onChange, children, wrapValue, ...props },
    ref,
  ) => {
    const isControlled = value !== undefined;
    const [uncontrolledFilled, setUncontrolledFilled] = React.useState(() =>
      hasValue(defaultValue),
    );
    const filled = isControlled ? hasValue(value) : uncontrolledFilled;

    const selectRef = React.useRef<HTMLSelectElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLSelectElement | null) => {
        selectRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    const [shownText, setShownText] = React.useState(() =>
      wrapValue
        ? optionText(children, isControlled ? value : defaultValue)
        : "",
    );
    // The DOM is the truth for which option is selected (a controlled value, a
    // browser default of the first option, a form reset) — mirror it after
    // every render; an unchanged label bails out of the state update.
    useIsomorphicLayoutEffect(() => {
      if (!wrapValue) return;
      const text = selectRef.current?.selectedOptions[0]?.text ?? "";
      setShownText((previous) => (previous === text ? previous : text));
    });

    const stateClasses = filled
      ? "border-border text-foreground"
      : "border-hairline text-muted-foreground";

    return (
      <span className="relative block w-full">
        <select
          ref={setRefs}
          value={value}
          defaultValue={defaultValue}
          data-filled={filled ? "true" : undefined}
          onChange={(event) => {
            if (!isControlled) {
              setUncontrolledFilled(hasValue(event.target.value));
            }
            if (wrapValue) {
              setShownText(event.target.selectedOptions[0]?.text ?? "");
            }
            onChange?.(event);
          }}
          className={cn(
            // `py-2.5`, not Input's `py-3`: a native select clips its value to the
            // content box instead of centring the line, so 44px − 2×2px border −
            // 2×10px leaves exactly one 20px text-sm line and descenders render.
            "flex h-11 appearance-none",
            BOX,
            stateClasses,
            "hover:border-ring active:border-primary-action active:bg-muted",
            "focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-muted disabled:text-muted-foreground disabled:hover:border-hairline disabled:active:border-hairline",
            "aria-invalid:border-destructive-text aria-invalid:bg-destructive-tint aria-invalid:hover:border-destructive-text aria-invalid:active:border-destructive-text aria-invalid:active:bg-destructive-tint",
            // wrapValue: the select keeps every behaviour but paints nothing; the
            // mirror below is what the eye reads, and it sets the height.
            wrapValue &&
              "peer absolute inset-0 h-full cursor-pointer opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {/* form-rhythm-ok: `min-h-11` is the control's own height on the wrapValue mirror, not a reserved message slot. */}
        {wrapValue ? (
          <span
            aria-hidden="true"
            data-slot="native-select-value"
            className={cn(
              "pointer-events-none flex min-h-11 items-center whitespace-normal break-words",
              BOX,
              stateClasses,
              "peer-hover:border-ring peer-active:border-primary-action peer-active:bg-muted",
              "peer-focus-visible:border-ring peer-focus-visible:shadow-focus",
              "peer-disabled:border-hairline peer-disabled:bg-muted peer-disabled:text-muted-foreground",
              "peer-aria-invalid:border-destructive-text peer-aria-invalid:bg-destructive-tint",
            )}
          >
            {shownText}
          </span>
        ) : null}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    );
  },
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
