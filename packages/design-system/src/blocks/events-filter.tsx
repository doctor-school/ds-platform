"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { FilterChip } from "../primitives/filter-chip";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";

/**
 * `<EventsFilter>` (019 EARS-7, source `design-source/doctor-events.dc.html`,
 * fork F-019-1 Б — the sidebar panel) — the ONE shared facet panel every events
 * surface mounts. 019 mounts the full REQ-138 set; no screen owns a private
 * copy (ADR-0013 A1: one canonical core, thin host projections).
 *
 * THE CONTROL LANGUAGE IS THE CANVAS'S, NOT A CHOICE OF THIS UNIT (owner
 * Stage-B decision on #1522). Every list facet is a CLOSED labelled select —
 * a bordered button carrying the small-caps facet name over its CURRENT VALUE
 * with a chevron — which expands into the canvas option sheet (tinted, its own
 * heading + ✕, options as bordered buttons, the chosen ones carrying ✓) inline
 * beneath that button. Nothing is expanded by default: the sidebar column reads
 * as the panel's seven answers, not as its whole option book. НМО and «цена в
 * Pul» wear the same button and TOGGLE on a single click («Не важно» ↔ «✓
 * Только с НМО»), because a two-state facet has no book to open. The canvas
 * lays these in a horizontal grid; the sidebar fork (F-019-1 Б) stacks the same
 * controls vertically — the same language, one column wide.
 *
 * PRESENTATIONAL BY CONTRACT. Values in, the next `AppliedFacets` out. The
 * panel writes no URL and parses none: the query/URL codec is its own unit
 * (019 design §8 step 3), so the same panel serves a URL-driven storefront and
 * a state-driven consumer without carrying either's plumbing. `resetHref` is
 * how the URL-driven consumer keeps its reset a real link (LD-1) — the panel
 * only renders the href it is handed.
 *
 * THE THREE D-1 FILL STATES ARE A PROPERTY OF THE UNIT, NOT OF 019 —
 *   • `wave-1`       — view + tense only;
 *   • `intermediate` — + format, kind;
 *   • `full`         — + specialty, city, НМО, free-by-Pul, name search.
 * A lighter fill must stay a complete, correctly laid-out panel: a later
 * consumer (030/031) mounting fewer facets breaks neither the panel nor the
 * host grid. Hence the panel declares NO width and no grid placement of its
 * own — the host places it — and a facet whose option list the consumer omits
 * is dropped entirely rather than rendered as an empty labelled box.
 *
 * Unconditional obligations, at every fill (Baymard / NN/g, and the same
 * semantics `FilterBar` (#1578) carries for the operator toolbar): the applied
 * set is visible as REMOVABLE units — a bare «Фильтры (3)» does not satisfy it
 * — one reset returns to the default scope, and the applied count is stated.
 * The panel body is deliberately layout-agnostic so #1528 can host the same
 * body inside the mobile sheet instead of forking it. All copy is app-supplied
 * (no i18n in the package).
 */

export type EventsFilterFill = "wave-1" | "intermediate" | "full";

export interface SpecialtyRef {
  id: string;
  label: string;
}

/** The full REQ-138 facet set of LD-4, mirrored one-to-one into the URL by its consumer. */
export interface AppliedFacets {
  /** `webinar` | `online-meeting` | `offline-meetup` | `congress` | `podcast` — repeatable. */
  format: string[];
  /** Kind reference ids — repeatable. */
  kind: string[];
  /** Default is `mine-and-adjacent`; explicit ids narrow to named specialties. */
  specialtyScope: "mine-and-adjacent" | "all" | SpecialtyRef[];
  /** City reference ids — offline events only. */
  city: string[];
  nmoOnly: boolean;
  freeByPul: boolean;
  /** Name search. */
  query: string;
}

/** The D-1 panel state the unit declares to its host. */
export interface FacetPanelState {
  fill: EventsFilterFill;
  appliedCount: number;
  resetHref?: string;
}

export interface EventsFilterOption {
  /** Reference id written into the applied set (and, by the consumer, the URL). */
  id: string;
  /** Human-readable RU label — never a slug. */
  label: string;
}

export interface EventsFilterOptions {
  view?: EventsFilterOption[];
  tense?: EventsFilterOption[];
  format?: EventsFilterOption[];
  kind?: EventsFilterOption[];
  /** Named specialties offered beside «моя и смежные» / «все специальности». */
  specialty?: EventsFilterOption[];
  city?: EventsFilterOption[];
}

export interface EventsFilterLabels {
  /** Accessible name of the panel region. */
  panel: string;
  view?: string;
  tense?: string;
  format?: string;
  kind?: string;
  specialty?: string;
  specialtyMine?: string;
  specialtyAll?: string;
  city?: string;
  /** Why the city facet does not narrow online events. */
  cityHint?: string;
  /**
   * The value a list facet shows while nothing in it is applied («Все»). The
   * closed control always states a value — an empty select reads as broken.
   */
  anyValue?: string;
  /** The city facet's own empty value («Все города»). Falls back to `anyValue`. */
  cityAny?: string;
  /**
   * `nmoOnly` / `freeByPul` are the APPLIED values («Только с НМО») — they name
   * the chip in the applied row and the on-state of the toggle facet. The
   * facet's own caption («НМО») and its off value («Не важно») are these.
   */
  nmoOnly?: string;
  nmoFacet?: string;
  nmoOff?: string;
  freeByPul?: string;
  freeByPulFacet?: string;
  freeByPulOff?: string;
  /** Accessible name of the option sheet's close control. */
  closeOptions?: string;
  query?: string;
  queryPlaceholder?: string;
  /** Heading of the applied row («Фильтры:»). */
  applied: string;
  /** The stated applied count — the app owns its pluralization. */
  appliedCount: (count: number) => string;
  /**
   * Verb-first prefix for each applied chip's accessible name («Убрать фильтр»
   * → "Убрать фильтр: Вебинар"). Without it assistive tech announces the bare
   * value and nothing says the control REMOVES it.
   */
  removeFacet: string;
  reset: string;
}

export interface EventsFilterProps {
  /** Which of the three D-1 fill states this consumer mounts. */
  fill: EventsFilterFill;
  applied: AppliedFacets;
  /** `FacetPanelState.appliedCount` — stated to the reader, never merely implied. */
  appliedCount: number;
  options: EventsFilterOptions;
  labels: EventsFilterLabels;
  /** The next applied set. Every facet emits the WHOLE set, so facets combine. */
  onChange: (next: AppliedFacets) => void;
  /** Reset as a link (URL-driven consumer, LD-1). Takes precedence over `onReset`. */
  resetHref?: string;
  /** Reset as an action (state-driven consumer). */
  onReset?: () => void;
  /** `view` facet — wave-1 upward; omit the option list to drop the group. */
  view?: { value: string; onChange: (id: string) => void };
  /** `tense` facet — wave-1 upward. */
  tense?: { value: string; onChange: (id: string) => void };
  /** Debounce window for the name search. Default 400ms (NN/g inactivity timeout). */
  queryDebounceMs?: number;
  className?: string;
}

const FILL_RANK: Record<EventsFilterFill, number> = {
  "wave-1": 0,
  intermediate: 1,
  full: 2,
};

function toggle(values: string[], id: string): string[] {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id];
}

/**
 * ALL-SELECTED IS «ВСЕ» (owner decision on #1522). A multi-select facet whose
 * selected set covers its whole option list narrows nothing, so it collapses to
 * the EMPTY set at selection time: the closed control returns to «Все», the
 * chips disappear and the facet stops counting toward «Применено фильтров».
 * Omit-to-drop — the consumer therefore writes no URL parameter for it either.
 * The sheet gains no «Все» row: the collapse is a normalization of the value,
 * not a new control in the canvas language.
 */
function toggleFacet(
  values: string[],
  id: string,
  all: EventsFilterOption[] | undefined,
): string[] {
  const next = toggle(values, id);
  return all && all.length > 0 && next.length >= all.length ? [] : next;
}

/**
 * The canvas facet control: a bordered button stating «LABEL / current value».
 * Open switches the fill to `tint` and drops the raised shadow, exactly as the
 * source does — the control looks pressed while its sheet is out.
 */
const FacetButton = React.forwardRef<
  HTMLButtonElement,
  {
    label: string;
    value: string;
    active: boolean;
    caret: string;
    onClick: () => void;
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
  }
>(function FacetButton({ label, value, active, caret, onClick, ...aria }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      // The name is assembled explicitly: the label and the value are two
      // separate blocks, so the computed name would otherwise run them
      // together («ФорматВсе»). Both visible strings are kept, in reading
      // order, so the accessible name still contains the visible label.
      aria-label={`${label}: ${value}`}
      {...aria}
      className={cn(
        "flex w-full items-center justify-between gap-3 border-2 border-border px-4 py-3 text-left transition-all",
        "focus-visible:outline-none focus-visible:shadow-focus",
        aria["aria-expanded"]
          ? "bg-tint shadow-none"
          : "bg-card shadow-ghost hover:bg-tint",
      )}
    >
      <span className="min-w-0">
        <span className="block text-caption font-extrabold uppercase tracking-wider text-primary-action">
          {label}
        </span>
        <span
          className={cn(
            "block truncate text-sm font-extrabold",
            active ? "text-primary-action" : "text-foreground",
          )}
        >
          {value}
        </span>
      </span>
      {/*
        The chevron (and the ✕ of the two-state facets) carries its OWN token
        colour: with no colour class it inherits the document foreground, which
        in the dark theme is the same ink as the panel's own surface — the
        glyph disappears. It takes the same pair as the value line beside it,
        which is proven against both surfaces the control wears (`bg-card`
        closed, `bg-tint` open).
      */}
      <span
        aria-hidden="true"
        className={cn(
          "flex-none text-caption",
          active ? "text-primary-action" : "text-foreground",
        )}
      >
        {caret}
      </span>
    </button>
  );
});

/**
 * One option inside the sheet — the chosen ones filled and marked ✓. `FilterChip`
 * carries the whole selected/hover/pressed/focus state set already (ADR-0013 §7);
 * only the full-width sheet geometry is applied on top.
 */
function FacetOption({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <FilterChip
      selected={selected}
      onClick={onClick}
      className="w-full justify-between gap-2.5 px-3 py-2.5 text-left"
    >
      <span className="truncate">{children}</span>
      <span aria-hidden="true" className="flex-none">
        {selected ? "✓" : ""}
      </span>
    </FilterChip>
  );
}

/**
 * A list facet: the closed control plus, while open, the canvas option sheet
 * inline beneath it. The sheet is the labelled `group` — assistive tech reads
 * the options as the facet's set, and a closed facet contributes no group.
 */
function FacetSelect({
  label,
  value,
  active,
  hint,
  open,
  onOpenChange,
  closeLabel,
  triggerRef,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  hint?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeLabel: string;
  /** Registers the trigger so the panel can return focus to it on close. */
  triggerRef: (node: HTMLButtonElement | null) => void;
  children: React.ReactNode;
}) {
  const sheetId = React.useId();
  return (
    <div className="flex flex-col">
      <FacetButton
        ref={triggerRef}
        label={label}
        value={value}
        active={active}
        caret={open ? "▲" : "▼"}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={sheetId}
      />
      {open ? (
        <div
          id={sheetId}
          role="group"
          aria-label={label}
          className="flex flex-col gap-2 border-2 border-t-0 border-border bg-tint p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-caption font-extrabold uppercase tracking-wider text-tint-foreground">
              {label}
            </span>
            <button
              type="button"
              aria-label={closeLabel}
              onClick={() => onOpenChange(false)}
              className="flex-none px-1 text-sm text-tint-foreground focus-visible:outline-none focus-visible:shadow-focus"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-2">{children}</div>
          {hint ? (
            <p className="text-caption font-semibold text-tint-foreground">
              {hint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function EventsFilter({
  fill,
  applied,
  appliedCount,
  options,
  labels,
  onChange,
  resetHref,
  onReset,
  view,
  tense,
  queryDebounceMs = 400,
  className,
}: EventsFilterProps) {
  const queryId = React.useId();
  // ONE sheet at a time, as the canvas does: opening a facet closes the
  // previous one, so the column never grows into the wall of options the
  // closed controls exist to prevent.
  const [openFacet, setOpenFacet] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const appliedRowRef = React.useRef<HTMLDivElement | null>(null);
  const resetRef = React.useRef<HTMLElement | null>(null);
  // The live trigger element per facet key — the sheet is inline, so the only
  // stable focus anchor after it unmounts is the button that opened it.
  const triggers = React.useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = React.useRef<{ key: string; force: boolean } | null>(
    null,
  );
  // Which applied chip was just removed; the row re-renders without it, so the
  // focus target is resolved from the NEW row, not from the removed node.
  const chipReturn = React.useRef<number | null>(null);
  const rank = FILL_RANK[fill];
  const showsFormatTier = rank >= FILL_RANK.intermediate;
  const showsFullTier = rank >= FILL_RANK.full;

  // The search field owns the keystrokes; the consumer receives ONE commit per
  // typing pause. The timer must call the callback of the LATEST render — the
  // consumer rebuilds `onChange` around its current applied set, so a facet
  // toggled inside the window would otherwise be rolled back by a commit
  // carrying the pre-toggle set.
  const [draft, setDraft] = React.useState(applied.query);
  const lastCommitted = React.useRef(applied.query);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = React.useRef<(value: string) => void>(() => {});
  commitRef.current = (value: string) => onChange({ ...applied, query: value });

  // Follow the consumer's committed value when it changes from OUTSIDE (a
  // reset, a URL restore, the applied chip removed) — never on our own echo,
  // which would delete in-flight typing.
  React.useEffect(() => {
    if (applied.query === lastCommitted.current) return;
    lastCommitted.current = applied.query;
    setDraft(applied.query);
  }, [applied.query]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onQueryChange = (value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    // The COMMITTED query is trimmed: a whitespace-only field is no query at
    // all (no chip, no count, no URL parameter), and « вебинар » must not
    // search for a different string than «вебинар». The draft keeps the raw
    // keystrokes, so the caret and in-word spaces survive typing.
    const committed = value.trim();
    timer.current = setTimeout(() => {
      lastCommitted.current = committed;
      commitRef.current(committed);
    }, queryDebounceMs);
  };

  /**
   * Closing a sheet must never drop focus to `<body>`: the ✕ and the option
   * buttons unmount with the sheet, so focus is restored to the trigger. An
   * outside click that lands on another focusable element keeps ITS focus —
   * only a focus that has fallen to the document is recovered — while Escape
   * always returns to the trigger (`force`), as the disclosure pattern requires.
   */
  const closeFacet = React.useCallback((key: string, force = false) => {
    restoreFocus.current = { key, force };
    setOpenFacet((current) => (current === key ? null : current));
  }, []);

  React.useLayoutEffect(() => {
    const pending = restoreFocus.current;
    if (!pending || openFacet !== null) return;
    restoreFocus.current = null;
    const trigger = triggers.current.get(pending.key);
    if (!trigger) return;
    const active = document.activeElement;
    if (pending.force || !active || active === document.body) trigger.focus();
  }, [openFacet]);

  // Escape and a click outside the panel close the open sheet — the standard
  // disclosure contract, beside the trigger and the sheet's own ✕.
  React.useEffect(() => {
    if (openFacet === null) return;
    const key = openFacet;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeFacet(key, true);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      closeFacet(key);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openFacet, closeFacet]);

  // Removing an applied chip moves focus along the row (the next chip, else the
  // last one), and when the row itself disappears to the reset control or the
  // panel region — never to `<body>`.
  React.useLayoutEffect(() => {
    const index = chipReturn.current;
    if (index === null) return;
    chipReturn.current = null;
    const chips = appliedRowRef.current
      ? Array.from(
          appliedRowRef.current.querySelectorAll<HTMLButtonElement>("button"),
        )
      : [];
    const next = chips[Math.min(index, chips.length - 1)];
    if (next) {
      next.focus();
      return;
    }
    (resetRef.current ?? panelRef.current)?.focus();
  });

  const scope = applied.specialtyScope;
  const scopeIds = Array.isArray(scope) ? scope.map((ref) => ref.id) : [];

  // Every applied facet as its own removable unit — the obligation the bare
  // count does not satisfy.
  const appliedChips: { id: string; label: string; onRemove: () => void }[] = [];
  for (const id of applied.format) {
    const option = options.format?.find((item) => item.id === id);
    appliedChips.push({
      id: `format:${id}`,
      label: option?.label ?? id,
      onRemove: () => onChange({ ...applied, format: toggle(applied.format, id) }),
    });
  }
  for (const id of applied.kind) {
    const option = options.kind?.find((item) => item.id === id);
    appliedChips.push({
      id: `kind:${id}`,
      label: option?.label ?? id,
      onRemove: () => onChange({ ...applied, kind: toggle(applied.kind, id) }),
    });
  }
  if (scope === "all" && labels.specialtyAll) {
    appliedChips.push({
      id: "specialty:all",
      label: labels.specialtyAll,
      onRemove: () =>
        onChange({ ...applied, specialtyScope: "mine-and-adjacent" }),
    });
  }
  if (Array.isArray(scope)) {
    for (const ref of scope) {
      appliedChips.push({
        id: `specialty:${ref.id}`,
        label: ref.label,
        onRemove: () => {
          const rest = scope.filter((item) => item.id !== ref.id);
          onChange({
            ...applied,
            specialtyScope: rest.length > 0 ? rest : "mine-and-adjacent",
          });
        },
      });
    }
  }
  for (const id of applied.city) {
    const option = options.city?.find((item) => item.id === id);
    appliedChips.push({
      id: `city:${id}`,
      label: option?.label ?? id,
      onRemove: () => onChange({ ...applied, city: toggle(applied.city, id) }),
    });
  }
  if (applied.nmoOnly && labels.nmoOnly) {
    appliedChips.push({
      id: "nmo",
      label: labels.nmoOnly,
      onRemove: () => onChange({ ...applied, nmoOnly: false }),
    });
  }
  if (applied.freeByPul && labels.freeByPul) {
    appliedChips.push({
      id: "free",
      label: labels.freeByPul,
      onRemove: () => onChange({ ...applied, freeByPul: false }),
    });
  }
  if (applied.query.trim().length > 0) {
    appliedChips.push({
      id: "query",
      label: applied.query,
      onRemove: () => {
        if (timer.current) clearTimeout(timer.current);
        lastCommitted.current = "";
        setDraft("");
        onChange({ ...applied, query: "" });
      },
    });
  }

  const isFiltered = appliedChips.length > 0;

  const anyValue = labels.anyValue ?? "";
  const closeLabel = labels.closeOptions ?? labels.applied;
  const sheet = (key: string) => ({
    open: openFacet === key,
    onOpenChange: (next: boolean) => {
      if (next) setOpenFacet(key);
      else closeFacet(key);
    },
    closeLabel,
    triggerRef: (node: HTMLButtonElement | null) => {
      if (node) triggers.current.set(key, node);
      else triggers.current.delete(key);
    },
  });
  const named = (ids: string[], list: EventsFilterOption[] | undefined) =>
    ids.map((id) => list?.find((item) => item.id === id)?.label ?? id).join(", ");

  const specialtyValue =
    scope === "all"
      ? (labels.specialtyAll ?? anyValue)
      : Array.isArray(scope)
        ? scope.map((ref) => ref.label).join(", ")
        : (labels.specialtyMine ?? anyValue);

  return (
    <section
      aria-label={labels.panel}
      ref={panelRef}
      // Programmatic focus target only (never in the tab order): the landing
      // place when the last applied chip removes the whole applied row.
      tabIndex={-1}
      className={cn(
        // No width and no grid placement of its own: the host column (desktop
        // sidebar) or the #1528 sheet decides where this body sits.
        "flex flex-col gap-3 border-2 border-border bg-card p-4",
        "focus:outline-none",
        className,
      )}
    >
      {options.view?.length && labels.view ? (
        <FacetSelect
          label={labels.view}
          value={
            options.view.find((option) => option.id === view?.value)?.label ??
            anyValue
          }
          // A control paints APPLIED only when its facet actually contributes
          // to the applied set — a chip and a unit of the stated count. `view`
          // and `tense` are always-present single selects that contribute
          // neither, so at every value they read as the neutral default does.
          active={false}
          {...sheet("view")}
        >
          {options.view.map((option) => (
            <FacetOption
              key={option.id}
              selected={view?.value === option.id}
              onClick={() => {
                view?.onChange(option.id);
                closeFacet("view");
              }}
            >
              {option.label}
            </FacetOption>
          ))}
        </FacetSelect>
      ) : null}

      {options.tense?.length && labels.tense ? (
        <FacetSelect
          label={labels.tense}
          value={
            options.tense.find((option) => option.id === tense?.value)?.label ??
            anyValue
          }
          active={false}
          {...sheet("tense")}
        >
          {options.tense.map((option) => (
            <FacetOption
              key={option.id}
              selected={tense?.value === option.id}
              onClick={() => {
                tense?.onChange(option.id);
                closeFacet("tense");
              }}
            >
              {option.label}
            </FacetOption>
          ))}
        </FacetSelect>
      ) : null}

      {showsFormatTier && options.format?.length && labels.format ? (
        <FacetSelect
          label={labels.format}
          value={
            applied.format.length > 0
              ? named(applied.format, options.format)
              : anyValue
          }
          active={applied.format.length > 0}
          {...sheet("format")}
        >
          {options.format.map((option) => (
            <FacetOption
              key={option.id}
              selected={applied.format.includes(option.id)}
              onClick={() =>
                onChange({
                  ...applied,
                  format: toggleFacet(applied.format, option.id, options.format),
                })
              }
            >
              {option.label}
            </FacetOption>
          ))}
        </FacetSelect>
      ) : null}

      {showsFormatTier && options.kind?.length && labels.kind ? (
        <FacetSelect
          label={labels.kind}
          value={
            applied.kind.length > 0 ? named(applied.kind, options.kind) : anyValue
          }
          active={applied.kind.length > 0}
          {...sheet("kind")}
        >
          {options.kind.map((option) => (
            <FacetOption
              key={option.id}
              selected={applied.kind.includes(option.id)}
              onClick={() =>
                onChange({
                  ...applied,
                  kind: toggleFacet(applied.kind, option.id, options.kind),
                })
              }
            >
              {option.label}
            </FacetOption>
          ))}
        </FacetSelect>
      ) : null}

      {showsFullTier &&
      labels.specialty &&
      (labels.specialtyMine || labels.specialtyAll) ? (
        <FacetSelect
          label={labels.specialty}
          value={specialtyValue}
          active={scope !== "mine-and-adjacent"}
          {...sheet("specialty")}
        >
          {labels.specialtyMine ? (
            <FacetOption
              selected={scope === "mine-and-adjacent"}
              onClick={() =>
                onChange({ ...applied, specialtyScope: "mine-and-adjacent" })
              }
            >
              {labels.specialtyMine}
            </FacetOption>
          ) : null}
          {labels.specialtyAll ? (
            <FacetOption
              selected={scope === "all"}
              onClick={() => onChange({ ...applied, specialtyScope: "all" })}
            >
              {labels.specialtyAll}
            </FacetOption>
          ) : null}
          {options.specialty?.map((option) => {
            const selected = scopeIds.includes(option.id);
            return (
              <FacetOption
                key={option.id}
                selected={selected}
                onClick={() => {
                  // Naming every offered specialty narrows nothing beyond the
                  // default scope, so the same all-selected normalization
                  // returns the facet to «моя и смежные».
                  const next = toggleFacet(
                    scopeIds,
                    option.id,
                    options.specialty,
                  );
                  const refs = next.map((id) => {
                    const known =
                      options.specialty?.find((item) => item.id === id) ??
                      (Array.isArray(scope)
                        ? scope.find((item) => item.id === id)
                        : undefined);
                    return { id, label: known?.label ?? id };
                  });
                  onChange({
                    ...applied,
                    specialtyScope: refs.length > 0 ? refs : "mine-and-adjacent",
                  });
                }}
              >
                {option.label}
              </FacetOption>
            );
          })}
        </FacetSelect>
      ) : null}

      {showsFullTier && options.city?.length && labels.city ? (
        <FacetSelect
          label={labels.city}
          value={
            applied.city.length > 0
              ? named(applied.city, options.city)
              : (labels.cityAny ?? anyValue)
          }
          active={applied.city.length > 0}
          hint={labels.cityHint}
          {...sheet("city")}
        >
          {options.city.map((option) => (
            <FacetOption
              key={option.id}
              selected={applied.city.includes(option.id)}
              onClick={() =>
                onChange({
                  ...applied,
                  city: toggleFacet(applied.city, option.id, options.city),
                })
              }
            >
              {option.label}
            </FacetOption>
          ))}
        </FacetSelect>
      ) : null}

      {/* Two-state facets: the same control, no sheet — one click flips it. */}
      {showsFullTier && labels.nmoOnly ? (
        <FacetButton
          label={labels.nmoFacet ?? labels.nmoOnly}
          value={
            applied.nmoOnly
              ? `✓ ${labels.nmoOnly}`
              : (labels.nmoOff ?? anyValue)
          }
          active={applied.nmoOnly}
          caret={applied.nmoOnly ? "✕" : ""}
          onClick={() => onChange({ ...applied, nmoOnly: !applied.nmoOnly })}
        />
      ) : null}

      {showsFullTier && labels.freeByPul ? (
        <FacetButton
          label={labels.freeByPulFacet ?? labels.freeByPul}
          value={
            applied.freeByPul
              ? `✓ ${labels.freeByPul}`
              : (labels.freeByPulOff ?? anyValue)
          }
          active={applied.freeByPul}
          caret={applied.freeByPul ? "✕" : ""}
          onClick={() => onChange({ ...applied, freeByPul: !applied.freeByPul })}
        />
      ) : null}

      {showsFullTier && labels.query ? (
        <div className="flex flex-col gap-1.5">
          {/*
            `Label` carries weight and size but no colour of its own, so on the
            panel's own surface it must be told which ink to use — otherwise it
            inherits the document foreground and vanishes in the dark theme.
          */}
          <Label htmlFor={queryId} className="text-foreground">
            {labels.query}
          </Label>
          <Input
            id={queryId}
            type="search"
            value={draft}
            placeholder={labels.queryPlaceholder}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
      ) : null}

      {isFiltered ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">
            {labels.appliedCount(appliedCount)}
          </p>
          <div
            ref={appliedRowRef}
            role="group"
            aria-label={labels.applied}
            className="flex flex-wrap items-center gap-2"
          >
            {appliedChips.map((chip, index) => (
              <FilterChip
                key={chip.id}
                selected
                onClick={() => {
                  chipReturn.current = index;
                  chip.onRemove();
                }}
                aria-label={`${labels.removeFacet}: ${chip.label}`}
              >
                {chip.label} ✕
              </FilterChip>
            ))}
          </div>
          {resetHref ? (
            <a
              ref={(node) => {
                resetRef.current = node;
              }}
              href={resetHref}
              className="self-start text-caption font-semibold text-primary-action underline underline-offset-4"
            >
              {labels.reset}
            </a>
          ) : onReset ? (
            <button
              ref={(node) => {
                resetRef.current = node;
              }}
              type="button"
              onClick={onReset}
              className="self-start text-caption font-semibold text-primary-action underline underline-offset-4"
            >
              {labels.reset}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
