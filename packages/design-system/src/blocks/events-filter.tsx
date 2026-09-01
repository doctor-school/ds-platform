"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { Checkbox } from "../primitives/checkbox";
import { FilterChip } from "../primitives/filter-chip";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";

/**
 * `<EventsFilter>` (019 EARS-7, source `design-source/doctor-events.dc.html`,
 * fork F-019-1 Б — the sidebar panel) — the ONE shared facet panel every events
 * surface mounts. 019 mounts the full REQ-138 set; no screen owns a private
 * copy (ADR-0013 A1: one canonical core, thin host projections).
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
  nmoOnly?: string;
  freeByPul?: string;
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

function FacetGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-caption font-semibold text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint ? (
        <p className="text-caption text-muted-foreground">{hint}</p>
      ) : null}
    </fieldset>
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
    timer.current = setTimeout(() => {
      lastCommitted.current = value;
      commitRef.current(value);
    }, queryDebounceMs);
  };

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

  return (
    <section
      aria-label={labels.panel}
      className={cn(
        // No width and no grid placement of its own: the host column (desktop
        // sidebar) or the #1528 sheet decides where this body sits.
        "flex flex-col gap-4 border-2 border-border bg-card p-4",
        className,
      )}
    >
      {isFiltered ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">
            {labels.appliedCount(appliedCount)}
          </p>
          <div
            role="group"
            aria-label={labels.applied}
            className="flex flex-wrap items-center gap-2"
          >
            {appliedChips.map((chip) => (
              <FilterChip
                key={chip.id}
                selected
                onClick={chip.onRemove}
                aria-label={`${labels.removeFacet}: ${chip.label}`}
              >
                {chip.label} ✕
              </FilterChip>
            ))}
          </div>
          {resetHref ? (
            <a
              href={resetHref}
              className="self-start text-caption font-semibold text-primary-action underline underline-offset-4"
            >
              {labels.reset}
            </a>
          ) : onReset ? (
            <button
              type="button"
              onClick={onReset}
              className="self-start text-caption font-semibold text-primary-action underline underline-offset-4"
            >
              {labels.reset}
            </button>
          ) : null}
        </div>
      ) : null}

      {options.view?.length && labels.view ? (
        <FacetGroup label={labels.view}>
          {options.view.map((option) => (
            <FilterChip
              key={option.id}
              selected={view?.value === option.id}
              onClick={() => view?.onChange(option.id)}
            >
              {option.label}
            </FilterChip>
          ))}
        </FacetGroup>
      ) : null}

      {options.tense?.length && labels.tense ? (
        <FacetGroup label={labels.tense}>
          {options.tense.map((option) => (
            <FilterChip
              key={option.id}
              selected={tense?.value === option.id}
              onClick={() => tense?.onChange(option.id)}
            >
              {option.label}
            </FilterChip>
          ))}
        </FacetGroup>
      ) : null}

      {showsFormatTier && options.format?.length && labels.format ? (
        <FacetGroup label={labels.format}>
          {options.format.map((option) => (
            <FilterChip
              key={option.id}
              selected={applied.format.includes(option.id)}
              onClick={() =>
                onChange({ ...applied, format: toggle(applied.format, option.id) })
              }
            >
              {option.label}
            </FilterChip>
          ))}
        </FacetGroup>
      ) : null}

      {showsFormatTier && options.kind?.length && labels.kind ? (
        <FacetGroup label={labels.kind}>
          {options.kind.map((option) => (
            <FilterChip
              key={option.id}
              selected={applied.kind.includes(option.id)}
              onClick={() =>
                onChange({ ...applied, kind: toggle(applied.kind, option.id) })
              }
            >
              {option.label}
            </FilterChip>
          ))}
        </FacetGroup>
      ) : null}

      {showsFullTier && labels.specialty && (labels.specialtyMine || labels.specialtyAll) ? (
        <FacetGroup label={labels.specialty}>
          {labels.specialtyMine ? (
            <FilterChip
              selected={scope === "mine-and-adjacent"}
              onClick={() =>
                onChange({ ...applied, specialtyScope: "mine-and-adjacent" })
              }
            >
              {labels.specialtyMine}
            </FilterChip>
          ) : null}
          {labels.specialtyAll ? (
            <FilterChip
              selected={scope === "all"}
              onClick={() => onChange({ ...applied, specialtyScope: "all" })}
            >
              {labels.specialtyAll}
            </FilterChip>
          ) : null}
          {options.specialty?.map((option) => {
            const selected = scopeIds.includes(option.id);
            return (
              <FilterChip
                key={option.id}
                selected={selected}
                onClick={() => {
                  const next = selected
                    ? scopeIds.filter((id) => id !== option.id)
                    : [...scopeIds, option.id];
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
              </FilterChip>
            );
          })}
        </FacetGroup>
      ) : null}

      {showsFullTier && options.city?.length && labels.city ? (
        <FacetGroup label={labels.city} hint={labels.cityHint}>
          {options.city.map((option) => (
            <FilterChip
              key={option.id}
              selected={applied.city.includes(option.id)}
              onClick={() =>
                onChange({ ...applied, city: toggle(applied.city, option.id) })
              }
            >
              {option.label}
            </FilterChip>
          ))}
        </FacetGroup>
      ) : null}

      {showsFullTier && (labels.nmoOnly || labels.freeByPul) ? (
        <div className="flex flex-col gap-2">
          {labels.nmoOnly ? (
            <Checkbox
              checked={applied.nmoOnly}
              onChange={(event) =>
                onChange({ ...applied, nmoOnly: event.target.checked })
              }
            >
              {labels.nmoOnly}
            </Checkbox>
          ) : null}
          {labels.freeByPul ? (
            <Checkbox
              checked={applied.freeByPul}
              onChange={(event) =>
                onChange({ ...applied, freeByPul: event.target.checked })
              }
            >
              {labels.freeByPul}
            </Checkbox>
          ) : null}
        </div>
      ) : null}

      {showsFullTier && labels.query ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={queryId}>{labels.query}</Label>
          <Input
            id={queryId}
            type="search"
            value={draft}
            placeholder={labels.queryPlaceholder}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
      ) : null}
    </section>
  );
}
