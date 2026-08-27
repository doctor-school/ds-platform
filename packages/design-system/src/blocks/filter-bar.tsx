"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { FilterChip } from "../primitives/filter-chip";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";

/**
 * `<FilterBar>` (#1578, owner Stage-A pick В — instant apply + applied chips) — the
 * toolbar above an operator list that owns every control narrowing that list, the
 * applied-filter readout, the reset affordance and the result count.
 *
 * Adopted from official shadcn/ui's `DataTableToolbar` (the `tasks` example block,
 * MIT — Copyright (c) 2023 shadcn): its COMPOSITION and its reset/applied semantics —
 * a flex row of search + facets with a reset control rendered ONLY while filtered.
 * Its plumbing is deliberately not adopted: upstream binds to `@tanstack/react-table`
 * column state and its faceted filter pulls `cmdk` + Radix Popover + Checkbox, while
 * our filtering is server-side query state (`q` / `status` / flags) and our facet unit
 * is the owned `FilterChip`. So: adopt the shape, implement over our own query state.
 *
 * THE CONTRACT THAT MAKES IT A BLOCK — `applyMode` is REQUIRED and whole-bar:
 *   • `instant` — every control IS its own trigger; the text field debounces
 *     (`debounceMs`, default 400ms per NN/g's inactivity-timeout rule) and shows an
 *     in-field busy cue; NO submit control is rendered at all.
 *   • `batch` — nothing reaches the list until the submit control; the search draft is
 *     held by the bar and committed only on submit.
 * The mixed model — one control queued behind «Применить» while its neighbours fire
 * on change — is the #1578 Stage-B rejection, and a required whole-bar prop is what
 * makes it unbuildable rather than merely discouraged.
 *
 * Unconditional obligations, whichever model is chosen (Baymard / Carbon / NN/g):
 * the applied set is visible as REMOVABLE units (a bare «Фильтры (3)» does not
 * satisfy it), one clear-all returns to the default state, and the result count is
 * announced in a live region. All copy is app-supplied (no i18n in the package).
 */

export type FilterBarApplyMode = "instant" | "batch";

export interface AppliedFilter {
  /** Stable id (React key). */
  id: string;
  /** Human-readable RU label of the applied value — never a slug. */
  label: string;
  /** Remove just this one filter. */
  onRemove: () => void;
}

export interface FilterBarProps {
  /** REQUIRED, whole-bar. A surface cannot mix apply models by accident. */
  applyMode: FilterBarApplyMode;
  /** Accessible name of the toolbar region (app-supplied). */
  label: string;
  /** Free-text search. Omit for a facet-only bar. */
  search?: {
    value: string;
    /** Commit — debounced in `instant`, submit-gated in `batch`. */
    onCommit: (value: string) => void;
    label: string;
    placeholder?: string;
    /** Debounce window for `instant`. Default 400ms. */
    debounceMs?: number;
  };
  /** Facet controls — `NativeSelect`, `FilterChip`, `Switch`, `Combobox`. */
  children?: React.ReactNode;
  /** Everything currently applied, as removable units. */
  applied?: AppliedFilter[];
  /** Copy for the applied row («Выбрано:»). */
  appliedLabel?: string;
  /** Clear every filter in one action. */
  onResetAll?: () => void;
  /** Copy for the clear-all control («Сбросить всё»). */
  resetLabel: string;
  /** Result count line («найдено 12 из 214») — announced politely. */
  resultCount?: React.ReactNode;
  /** A query is in flight — the field carries the busy cue, never a frozen list. */
  isBusy?: boolean;
  /** Accessible copy for the busy cue. */
  busyLabel?: string;
  /** `batch` only — the submit control's copy. Ignored in `instant`. */
  submitLabel?: string;
  /** `batch` only — commit the whole draft. */
  onSubmit?: () => void;
  className?: string;
}

export function FilterBar({
  applyMode,
  label,
  search,
  children,
  applied = [],
  appliedLabel,
  onResetAll,
  resetLabel,
  resultCount,
  isBusy = false,
  busyLabel,
  submitLabel,
  onSubmit,
  className,
}: FilterBarProps) {
  const searchId = React.useId();
  const [draft, setDraft] = React.useState(search?.value ?? "");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // The bar follows the app's committed value when it changes from outside
  // (reset-all, a URL restore) without fighting the operator mid-typing.
  const committed = search?.value ?? "";
  React.useEffect(() => {
    setDraft(committed);
  }, [committed]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onSearchChange = (value: string) => {
    setDraft(value);
    if (applyMode !== "instant" || !search) return;
    // Instant model: the field is its own trigger, but the list must never
    // re-query per keystroke — one commit after the inactivity window.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      search.onCommit(value);
    }, search.debounceMs ?? 400);
  };

  const isFiltered = applied.length > 0 || draft.length > 0;

  return (
    <section
      aria-label={label}
      className={cn("flex flex-col gap-3 border-2 border-border bg-card p-4", className)}
    >
      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (applyMode === "batch") {
            search?.onCommit(draft);
            onSubmit?.();
          }
        }}
      >
        {search ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={searchId}>{search.label}</Label>
            <div className="relative">
              <Input
                id={searchId}
                type="search"
                value={draft}
                placeholder={search.placeholder}
                aria-busy={isBusy || undefined}
                onChange={(event) => onSearchChange(event.target.value)}
              />
              {isBusy ? (
                <span
                  role="status"
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-caption text-muted-foreground"
                >
                  {busyLabel}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {children}

        {/* The submit control exists ONLY in the batch model — its presence in an
            instant bar is the mixed model this prop rules out. */}
        {applyMode === "batch" ? (
          <Button type="submit" variant="secondary">
            {submitLabel}
          </Button>
        ) : null}

        {/* Reset is offered only while something is applied. */}
        {isFiltered && onResetAll ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              setDraft("");
              onResetAll();
            }}
          >
            {resetLabel}
          </Button>
        ) : null}
      </form>

      {applied.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {appliedLabel ? (
            <span className="text-caption text-muted-foreground">
              {appliedLabel}
            </span>
          ) : null}
          {applied.map((item) => (
            <FilterChip
              key={item.id}
              selected
              onClick={item.onRemove}
              aria-label={item.label}
            >
              {item.label} ✕
            </FilterChip>
          ))}
        </div>
      ) : null}

      {resultCount ? (
        <p
          role="status"
          aria-live="polite"
          className="text-caption text-muted-foreground"
        >
          {resultCount}
        </p>
      ) : null}
    </section>
  );
}
