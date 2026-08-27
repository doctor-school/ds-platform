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
  /**
   * Verb-first prefix for each chip's accessible name («Убрать фильтр» →
   * "Убрать фильтр: Черновики"). Without it assistive tech announces the bare
   * value and nothing says the control REMOVES it (the visible ✕ sits inside the
   * same text node, and `role="button"` name-from-content flattens it away).
   */
  removeFilterLabel?: string;
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
  removeFilterLabel,
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
  // The last value THIS bar handed to the app. An arriving committed value equal
  // to it is our own echo, not an external change.
  const lastCommitted = React.useRef(search?.value ?? "");
  // A debounce window is open: the field, not the list, owns the newest keystrokes.
  const [isPending, setIsPending] = React.useState(false);

  // The bar follows the app's committed value when it changes from OUTSIDE
  // (reset-all, a URL restore, a server-corrected query) — never on the echo of
  // its own commit. An unconditional resync deletes in-flight typing: the commit
  // fires 400ms after a pause, and the parent's round trip lands while the
  // operator is already typing the next word, overwriting it under the cursor.
  // The debounce timer must call the callback of the LATEST render, never the
  // one captured at keystroke time: the parent rebuilds `onCommit` around its
  // current query, so a facet flipped inside the 400ms window would otherwise be
  // rolled back by a commit carrying the pre-toggle query.
  const commitRef = React.useRef(search?.onCommit);
  commitRef.current = search?.onCommit;

  const committed = search?.value ?? "";
  React.useEffect(() => {
    if (committed === lastCommitted.current) return;
    lastCommitted.current = committed;
    setDraft(committed);
    setIsPending(false);
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
    // re-query per keystroke — one commit after the inactivity window. The bar
    // owns the cue for that window itself, so the promise the block makes ("a
    // busy cue in the field") holds for EVERY consumer instead of depending on a
    // caller remembering to drive `isBusy`.
    if (timer.current) clearTimeout(timer.current);
    setIsPending(true);
    timer.current = setTimeout(() => {
      lastCommitted.current = value;
      setIsPending(false);
      commitRef.current?.(value);
    }, search.debounceMs ?? 400);
  };

  const showBusy = isBusy || isPending;

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
                aria-busy={showBusy || undefined}
                onChange={(event) => onSearchChange(event.target.value)}
              />
              {showBusy ? (
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
              setIsPending(false);
              lastCommitted.current = "";
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
              aria-label={
                removeFilterLabel
                  ? `${removeFilterLabel}: ${item.label}`
                  : item.label
              }
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
