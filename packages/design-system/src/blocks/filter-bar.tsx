"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { Badge } from "../primitives/badge";
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
 *
 * `moreFilters` (044 EARS-23, owner Stage-A pick F1, #2316) is the opt-in second
 * tier for a list with more facets than one row holds: a «Все фильтры» toggle at
 * the end of the control row — badged with how many of its filters are applied —
 * expands a panel INSIDE this same bar, never a popover or a second toolbar, so
 * every narrowing control and every chip stay in one region. The panel inherits
 * the bar's apply model; `FilterBarTextField` is its text control on the same
 * debounce as the search field. With the toggle, «Сбросить всё» sits beside the
 * chips it clears (the row end belongs to the toggle). A bar without the prop is
 * unchanged.
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

export interface FilterBarMoreFilters {
  /** The toggle's copy («Все фильтры»). */
  label: string;
  /** How many of the panel's filters are applied — badged on the toggle when > 0. */
  appliedCount: number;
  /** The badge's accessible wording («применено: 2») — the bare digit says nothing. */
  appliedCountLabel: (count: number) => string;
  /** The panel's heading — also its accessible group name. */
  heading: string;
  /** A line beside the heading (right-aligned ≥ sm). */
  hint?: string;
  /**
   * The panel controls, laid on a 4-column grid ≥ lg (2 ≥ sm, 1 below); a control
   * spanning two columns carries its own `lg:col-span-2`.
   */
  children: React.ReactNode;
  /** Open on mount. The open state is the bar's own, in-page. */
  defaultOpen?: boolean;
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
  /** Opt-in «Все фильтры» toggle + in-bar panel. */
  moreFilters?: FilterBarMoreFilters;
  className?: string;
}

/**
 * The instant model's text commit, shared by the search field and every
 * `FilterBarTextField`: a draft the operator owns, one commit after the
 * inactivity window, and a resync on an EXTERNAL value change only.
 */
function useInstantCommit({
  value,
  onCommit,
  debounceMs = 400,
  enabled = true,
}: {
  value: string;
  onCommit?: ((value: string) => void) | undefined;
  debounceMs?: number | undefined;
  enabled?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last value THIS control handed to the app. An arriving committed value
  // equal to it is our own echo, not an external change.
  const lastCommitted = React.useRef(value);
  // A debounce window is open: the field, not the list, owns the newest keystrokes.
  const [isPending, setIsPending] = React.useState(false);

  // The control follows the app's committed value when it changes from OUTSIDE
  // (reset-all, a URL restore, a server-corrected query) — never on the echo of
  // its own commit. An unconditional resync deletes in-flight typing: the commit
  // fires 400ms after a pause, and the parent's round trip lands while the
  // operator is already typing the next word, overwriting it under the cursor.
  // The debounce timer must call the callback of the LATEST render, never the
  // one captured at keystroke time: the parent rebuilds `onCommit` around its
  // current query, so a facet flipped inside the 400ms window would otherwise be
  // rolled back by a commit carrying the pre-toggle query.
  const commitRef = React.useRef(onCommit);
  commitRef.current = onCommit;

  React.useEffect(() => {
    if (value === lastCommitted.current) return;
    lastCommitted.current = value;
    setDraft(value);
    setIsPending(false);
  }, [value]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const change = (next: string) => {
    setDraft(next);
    if (!enabled) return;
    // The list must never re-query per keystroke — one commit after the
    // inactivity window. The control owns the cue for that window itself, so
    // the promise the block makes ("a busy cue in the field") holds for EVERY
    // consumer instead of depending on a caller remembering to drive `isBusy`.
    if (timer.current) clearTimeout(timer.current);
    setIsPending(true);
    timer.current = setTimeout(() => {
      lastCommitted.current = next;
      setIsPending(false);
      commitRef.current?.(next);
    }, debounceMs);
  };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setIsPending(false);
    lastCommitted.current = "";
    setDraft("");
  };

  return { draft, change, clear, isPending };
}

/** The in-field busy cue for a debounce window or a query in flight. */
function BusyCue({ label }: { label?: string | undefined }) {
  return (
    <span
      role="status"
      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-caption text-muted-foreground"
    >
      {label}
    </span>
  );
}

export interface FilterBarTextFieldProps {
  label: string;
  /** The committed value (blank = no filter). */
  value: string;
  /** Called once per inactivity window with the raw draft. */
  onCommit: (value: string) => void;
  placeholder?: string;
  /** Debounce window — the bar's 400ms by default. */
  debounceMs?: number;
  busyLabel?: string;
  /** e.g. `tel` / `email` for the on-screen keyboard. */
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  id?: string;
  className?: string;
}

/**
 * A text filter inside the `moreFilters` panel on the bar's instant model — the
 * same debounce, echo handling and busy cue as the search field.
 */
export function FilterBarTextField({
  label,
  value,
  onCommit,
  placeholder,
  debounceMs,
  busyLabel,
  inputMode,
  id,
  className,
}: FilterBarTextFieldProps) {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const { draft, change, isPending } = useInstantCommit({
    value,
    onCommit,
    debounceMs,
  });
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <div className="relative">
        <Input
          id={fieldId}
          type="text"
          value={draft}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-busy={isPending || undefined}
          onChange={(event) => change(event.target.value)}
        />
        {isPending ? <BusyCue label={busyLabel} /> : null}
      </div>
    </div>
  );
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
  moreFilters,
  className,
}: FilterBarProps) {
  const searchId = React.useId();
  const panelId = React.useId();
  const headingId = React.useId();
  const [panelOpen, setPanelOpen] = React.useState(
    moreFilters?.defaultOpen ?? false,
  );

  // A removed chip takes its button out of the DOM; the focus would fall to
  // <body> and a keyboard operator would lose their place. It moves to the next
  // chip, else the previous one, else the «Все фильтры» toggle, else the search
  // field — once the host has actually dropped the chip (its removal may land a
  // render later, e.g. through the address).
  const chipRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const pendingFocus = React.useRef<{
    removed: string;
    next: string | undefined;
    previous: string | undefined;
  } | null>(null);
  React.useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || applied.some((item) => item.id === pending.removed)) return;
    pendingFocus.current = null;
    const target =
      (pending.next && chipRefs.current.get(pending.next)) ||
      (pending.previous && chipRefs.current.get(pending.previous)) ||
      toggleRef.current ||
      searchRef.current;
    target?.focus();
  });
  const {
    draft,
    change: onSearchChange,
    clear: clearSearch,
    isPending,
  } = useInstantCommit({
    value: search?.value ?? "",
    onCommit: search?.onCommit,
    debounceMs: search?.debounceMs,
    enabled: applyMode === "instant" && Boolean(search),
  });

  const showBusy = isBusy || isPending;

  const isFiltered = applied.length > 0 || draft.length > 0;

  // Reset is offered only while something is applied.
  const resetControl =
    isFiltered && onResetAll ? (
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          clearSearch();
          onResetAll();
        }}
      >
        {resetLabel}
      </Button>
    ) : null;

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
                ref={searchRef}
                id={searchId}
                type="search"
                value={draft}
                placeholder={search.placeholder}
                aria-busy={showBusy || undefined}
                onChange={(event) => onSearchChange(event.target.value)}
              />
              {showBusy ? <BusyCue label={busyLabel} /> : null}
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

        {moreFilters ? (
          <Button
            ref={toggleRef}
            type="button"
            variant="secondary"
            aria-expanded={panelOpen}
            aria-controls={panelId}
            aria-label={
              moreFilters.appliedCount > 0
                ? `${moreFilters.label}, ${moreFilters.appliedCountLabel(moreFilters.appliedCount)}`
                : undefined
            }
            onClick={() => setPanelOpen((open) => !open)}
          >
            <SlidersIcon />
            {moreFilters.label}
            {moreFilters.appliedCount > 0 ? (
              <Badge variant="count" aria-hidden="true">
                {moreFilters.appliedCount}
              </Badge>
            ) : null}
            <CaretIcon open={panelOpen} />
          </Button>
        ) : null}

        {/* With the panel toggle the row end is the toggle's; reset then sits
            beside the chips it clears. */}
        {moreFilters ? null : resetControl}
      </form>

      {moreFilters ? (
        <div
          id={panelId}
          role="group"
          aria-labelledby={headingId}
          hidden={!panelOpen}
          className="grid grid-cols-1 gap-x-3 gap-y-3.5 border-t-2 border-hairline pt-3.5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="col-span-full flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <span
              id={headingId}
              className="text-sm font-extrabold text-foreground"
            >
              {moreFilters.heading}
            </span>
            {moreFilters.hint ? (
              <span className="text-caption text-muted-foreground">
                {moreFilters.hint}
              </span>
            ) : null}
          </div>
          {moreFilters.children}
        </div>
      ) : null}

      {applied.length > 0 || (moreFilters && resetControl) ? (
        <div className="flex flex-wrap items-center gap-2">
          {appliedLabel && applied.length > 0 ? (
            <span className="text-caption text-muted-foreground">
              {appliedLabel}
            </span>
          ) : null}
          {applied.map((item, index) => (
            <FilterChip
              key={item.id}
              ref={(node) => {
                if (node) chipRefs.current.set(item.id, node);
                else chipRefs.current.delete(item.id);
              }}
              selected
              onClick={() => {
                pendingFocus.current = {
                  removed: item.id,
                  next: applied[index + 1]?.id,
                  previous: applied[index - 1]?.id,
                };
                item.onRemove();
              }}
              aria-label={
                removeFilterLabel
                  ? `${removeFilterLabel}: ${item.label}`
                  : item.label
              }
            >
              {item.label} ✕
            </FilterChip>
          ))}
          {moreFilters ? resetControl : null}
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

/** The «Все фильтры» glyph — DS inline-icon convention (16-grid, square caps). */
function SlidersIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
    >
      <path d="M2 4h7M13 4h1M2 12h1M7 12h7" />
      <rect x="9" y="2" width="3" height="4" />
      <rect x="3" y="10" width="3" height="4" />
    </svg>
  );
}

/** The panel toggle's open/closed caret. */
function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="currentColor"
      className={cn("transition-transform", open && "rotate-180")}
    >
      <path d="M4 6h8l-4 5z" />
    </svg>
  );
}
