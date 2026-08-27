"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command as CommandPrimitive } from "cmdk";

import { cn } from "../lib/utils";

/**
 * `<Combobox>` (#1578, owner Stage-A pick Б — field-shaped trigger + owned panel).
 *
 * ADOPTED from Kibo UI's `combobox` block (https://github.com/shadcnblocks/kibo, MIT)
 * — the packaged shadcn recipe (Radix Popover + `cmdk` Command) with the
 * trigger/search/list/empty composition and controlled-value handling already wired —
 * re-skinned to DS tokens on copy-in. Net-new runtime deps: `cmdk` and
 * `@radix-ui/react-popover`, both widening the Radix family already installed rather
 * than opening a new one. The official shadcn Combobox was rejected because it has
 * moved onto Base UI (a dependency family we do not have); Intent/Jolly pulls the
 * whole `react-aria-components` runtime; Origin UI is AGPL-3.0 and cannot be copied
 * into an `UNLICENSED` tree.
 *
 * WHEN THIS AND NOT `NativeSelect`: the native select stays the default. Rebuild only
 * on one of three triggers — the options need EXPLAINING (a native `<option>` cannot
 * carry a secondary line, and a hint under the label describes the field, not the
 * options), the list outgrows scanning (~12–15+, where typing beats scrolling), or the
 * vocabulary is managed DATA that grows. Below those triggers a search box over a list
 * that already fits on screen is a control asking to be used and offering nothing.
 *
 * THE CLOSED-VOCABULARY RULE (#1578): typing NEVER enters free text into the value.
 * The field is not an input — it is a trigger showing the chosen LABEL; the query box
 * lives inside the panel and only filters. A vocabulary a typo can extend is not a
 * vocabulary. And no option's rendered text is ever its slug, code or numeric id.
 *
 * The ARIA combobox pattern is the acceptance list, not a nice-to-have: the trigger is
 * `role="combobox"` with `aria-expanded` + `aria-controls` on the live panel; `cmdk`
 * owns `aria-activedescendant`, Up/Down movement and Enter to accept, Radix owns
 * Escape-to-close, focus return and viewport-edge-aware placement. The closed control
 * mirrors `NativeSelect` geometry EXACTLY (h-11, 2px border, square, same chevron
 * position) so a form mixing the two realizations reads as one column.
 *
 * Presentation only: every string is app-supplied (no i18n inside the package).
 */

export interface ComboboxOption {
  /** The stored value (slug / id) — NEVER rendered to the operator. */
  value: string;
  /** The RU label the operator reads and searches by. */
  label: string;
  /** The per-option explanation line — the reason this is not a native select. */
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** Currently selected value, or `null`/`undefined` when empty. */
  value?: string | null;
  /** Selection commit. Only ever called with a value FROM `options`. */
  onValueChange: (value: string) => void;
  /** Control copy while empty (app-supplied, localized). */
  placeholder: string;
  /** Accessible name for the panel's own query box. */
  searchLabel?: string;
  searchPlaceholder?: string;
  /** The no-match line («Ничего не найдено»). */
  emptyLabel: string;
  /**
   * Show the in-panel query box. Defaults to ON for a long book (>12 options) and
   * OFF for a short explained vocabulary, per the scanning threshold.
   */
  showSearch?: boolean;
  /** Optional «Найдено N из M» counter builder. */
  countLabel?: (shown: number, total: number) => string;
  id?: string;
  disabled?: boolean;
  /** Carries the invalid state on the control itself (K-3). */
  invalid?: boolean;
  /** Wired by `FormControl` / `Label`. */
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchLabel,
  searchPlaceholder,
  emptyLabel,
  showSearch,
  countLabel,
  id,
  disabled = false,
  invalid = false,
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const panelId = React.useId();

  const selected = options.find((option) => option.value === value) ?? null;
  const withSearch = showSearch ?? options.length > 12;

  const shown = React.useMemo(() => {
    if (!query) return options.length;
    const needle = query.toLocaleLowerCase();
    return options.filter((option) =>
      option.label.toLocaleLowerCase().includes(needle),
    ).length;
  }, [options, query]);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={panelId}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          {...aria}
          className={cn(
            // Pixel-identical to `NativeSelect`'s closed control.
            "relative flex h-11 w-full items-center border-2 bg-background px-3.5 py-3 pr-10 text-left text-sm transition-colors",
            selected
              ? "border-border text-foreground"
              : "border-hairline text-muted-foreground",
            "hover:border-ring active:border-primary-action active:bg-muted",
            "focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-muted disabled:text-muted-foreground",
            "aria-invalid:border-destructive aria-invalid:bg-destructive-tint",
            className,
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
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
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={panelId}
          align="start"
          sideOffset={4}
          // Radix flips/shifts the panel away from a viewport edge (Baymard).
          collisionPadding={8}
          // Panel width tracks the trigger through Radix's own CSS variable (an
          // inline style, so no arbitrary Tailwind value enters the class list).
          style={{ width: "var(--radix-popover-trigger-width)" }}
          className="z-50 border-2 border-border bg-card shadow-ghost"
        >
          <CommandPrimitive
            // Filtering is over the LABEL, never the stored value.
            filter={(itemValue, search) =>
              itemValue.toLocaleLowerCase().includes(search.toLocaleLowerCase())
                ? 1
                : 0
            }
          >
            {withSearch ? (
              <div className="border-b-2 border-border">
                <CommandPrimitive.Input
                  value={query}
                  onValueChange={setQuery}
                  aria-label={searchLabel}
                  placeholder={searchPlaceholder}
                  className="h-11 w-full bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
                />
              </div>
            ) : null}
            <CommandPrimitive.List className="max-h-72 overflow-y-auto p-1">
              <CommandPrimitive.Empty className="px-3.5 py-3 text-sm text-muted-foreground">
                {emptyLabel}
              </CommandPrimitive.Empty>
              {options.map((option) => (
                <CommandPrimitive.Item
                  key={option.value}
                  // cmdk matches on this string — the LABEL, so the operator
                  // searches by what they can read.
                  value={option.label}
                  disabled={option.disabled}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 px-3.5 py-2.5 text-sm text-foreground",
                    "data-[selected=true]:bg-tint data-[selected=true]:text-tint-foreground",
                    "data-[disabled=true]:pointer-events-none data-[disabled=true]:text-muted-2",
                  )}
                >
                  <span className="font-bold">
                    {option.label}
                    {option.value === value ? (
                      <span className="ml-2 text-primary-action">✓</span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="text-caption text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </CommandPrimitive.Item>
              ))}
            </CommandPrimitive.List>
            {countLabel ? (
              <p className="border-t-2 border-border px-3.5 py-2 text-caption text-muted-foreground">
                {countLabel(shown, options.length)}
              </p>
            ) : null}
          </CommandPrimitive>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
