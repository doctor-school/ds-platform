"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command as CommandPrimitive } from "cmdk";

import { cn } from "../lib/utils";
import { Button } from "../primitives/button";

/**
 * `<Combobox>` (#1578, owner Stage-A pick Б — field-shaped trigger + owned panel).
 *
 * ADOPTED from Kibo UI's `combobox` block (https://github.com/shadcnblocks/kibo),
 * MIT licence, reproduced verbatim from upstream `license.md`:
 *
 *   Copyright (c) 2023 — Present shadcnblocks
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of
 *   this software and associated documentation files (the "Software"), to deal in
 *   the Software without restriction, including without limitation the rights to
 *   use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 *   of the Software, and to permit persons to whom the Software is furnished to do
 *   so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * What was adopted: the packaged shadcn recipe (Radix Popover + `cmdk` Command) with
 * the trigger/search/list/empty composition and controlled-value handling already
 * wired — re-skinned to DS tokens on copy-in. Net-new runtime deps: `cmdk` and
 * `@radix-ui/react-popover`, both widening the Radix family already installed rather
 * than opening a new one. The official shadcn Combobox was rejected because it has
 * moved onto Base UI (a dependency family we do not have); Intent/Jolly pulls the
 * whole `react-aria-components` runtime; Origin UI is no longer a committable source
 * (ADR-0013 §4) — its collection was absorbed into the `cosscom/coss` monorepo, whose
 * default licence is AGPL-3.0 with `apps/origin/` carved back to MIT, so every copy
 * needs a per-directory provenance check against a collection that stopped moving.
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
  /**
   * Optional server-search bridge. When present, the app owns filtering and the
   * options are rendered exactly as returned by its bounded query.
   */
  onSearchChange?: (query: string) => void;
  /** True when another server page exists; renders an explicit operator action. */
  hasMore?: boolean;
  /** Fetch exactly the next page. Duplicate clicks are suppressed until it settles. */
  onLoadMore?: () => void | Promise<void>;
  /** Controlled loading state for a request owned by the app. */
  loadingMore?: boolean;
  /** Controlled error state; preserves current options and turns the action into retry. */
  loadMoreError?: boolean;
  loadMoreLabel?: string;
  loadingMoreLabel?: string;
  loadMoreErrorLabel?: string;
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
  /**
   * Field name when no visible `Label` is wired. Defaults to `placeholder`, so the
   * control is NEVER nameless — `role="combobox"` takes no name from its content.
   */
  "aria-label"?: string;
  className?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchLabel,
  searchPlaceholder,
  onSearchChange,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  loadMoreError = false,
  loadMoreLabel,
  loadingMoreLabel,
  loadMoreErrorLabel,
  emptyLabel,
  showSearch,
  countLabel,
  id,
  disabled = false,
  invalid = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [internalLoadingMore, setInternalLoadingMore] = React.useState(false);
  const loadMoreInFlight = React.useRef(false);
  const panelId = React.useId();
  const fieldNameId = React.useId();
  const valueId = React.useId();

  const selected = options.find((option) => option.value === value) ?? null;
  const withSearch = showSearch ?? options.length > 12;
  const isLoadingMore = loadingMore || internalLoadingMore;
  const paginationLabel = isLoadingMore
    ? loadingMoreLabel
    : loadMoreError
      ? loadMoreErrorLabel
      : loadMoreLabel;

  const shown = React.useMemo(() => {
    if (!query) return options.length;
    const needle = query.toLocaleLowerCase();
    return options.filter((option) =>
      option.label.toLocaleLowerCase().includes(needle),
    ).length;
  }, [options, query]);

  // `role="combobox"` takes NO name from its content, so the name is assembled by
  // reference: the field name (an external `Label`, else an sr-only span carrying
  // `aria-label ?? placeholder`) plus the chosen value — the value span joins only
  // once something is selected, otherwise the placeholder would be announced twice.
  const fieldNameOwnedHere = !ariaLabelledBy;
  const labelledBy = [ariaLabelledBy ?? fieldNameId, selected ? valueId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          onSearchChange?.("");
        }
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={panelId}
          aria-labelledby={labelledBy}
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
          {fieldNameOwnedHere ? (
            <span id={fieldNameId} className="sr-only">
              {ariaLabel ?? placeholder}
            </span>
          ) : null}
          <span id={valueId} className="truncate">
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
            shouldFilter={!onSearchChange}
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
                  onValueChange={(next) => {
                    setQuery(next);
                    onSearchChange?.(next);
                  }}
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
                  // cmdk types this as a plain `boolean`, so under
                  // `exactOptionalPropertyTypes` an absent flag has to become `false`
                  // rather than `undefined`.
                  disabled={option.disabled ?? false}
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
            {hasMore && onLoadMore && paginationLabel ? (
              <div
                role="status"
                aria-live="polite"
                className="border-t-2 border-border p-1"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  loading={isLoadingMore}
                  disabled={isLoadingMore}
                  onClick={() => {
                    if (loadMoreInFlight.current || loadingMore) return;
                    loadMoreInFlight.current = true;
                    setInternalLoadingMore(true);
                    void Promise.resolve(onLoadMore()).finally(() => {
                      loadMoreInFlight.current = false;
                      setInternalLoadingMore(false);
                    });
                  }}
                >
                  {paginationLabel}
                </Button>
              </div>
            ) : null}
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
