"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { FilterChip, filterChipVariants } from "../primitives/filter-chip";
import { Input } from "../primitives/input";
import { Link } from "../primitives/link";
import { Switch } from "../primitives/switch";
import { Combobox, type ComboboxOption } from "./combobox";

/**
 * `<EventsFilter>` (019 EARS-7 / EARS-13 as amended 2026-10-05, source
 * `design-source/events-facets.dc.html`) — the ONE shared facet panel of the
 * events feed on both storefronts. No screen owns a private copy (ADR-0013
 * A1: one canonical core, thin host projections; 019 LD-11 / EARS-18).
 *
 * THE FACET SET IS THE HOST'S, NOT THE PANEL'S. 019 «Differences between
 * storefronts» names the `filterSet` as one of the three permitted per-host
 * parameters, so `host` selects which facets render — never a fork:
 *   • `doctor`  — «Поиск по названию» (Input), «Специальность» (two scope
 *                 chips + a searchable Combobox + removable chips), «Формат»
 *                 and «Вид события» (multi-select FilterChips), «Город»
 *                 (Combobox + removable chips, offline-only hint),
 *                 «Направление» (Combobox + removable chips) and the «Только с
 *                 НМО» Switch. No free-by-Pul facet.
 *   • `academy` — «Проект», «Эксперт», «Тема»: three Combobox groups, each
 *                 with removable chips.
 * «Направление» is in the spec's doctor `filterSet` but not drawn on the
 * canvas; it takes the canvas's own Combobox + removable-chip pattern.
 *
 * The header states «Фильтры», and — only while something is applied — the
 * applied count and «Сбросить». `showHeader={false}` renders the bare body the
 * mobile sheet hosts under its own header (EARS-13 as amended).
 *
 * PRESENTATIONAL BY CONTRACT. Values in, the next `AppliedFacets` out. The
 * panel writes no URL and parses none; `resetHref` is how a URL-driven
 * consumer keeps its reset a real link (LD-1). The panel declares no width,
 * border or padding: the desktop sticky column or the mobile sheet places it.
 * A facet whose label or options the consumer omits is dropped entirely, so a
 * consumer mounting fewer facets breaks neither the panel nor the host grid.
 * All copy is app-supplied (no i18n in the package).
 */

export type EventsFilterHost = "doctor" | "academy";

export interface SpecialtyRef {
  id: string;
  label: string;
}

/**
 * Every facet value both hosts can carry, mirrored one-to-one into the URL by
 * the consumer. A host reads and counts only its own keys
 * (`countAppliedFacets`); the others stay at their defaults.
 */
export interface AppliedFacets {
  /** Doctor: name search (committed trimmed). */
  query: string;
  /** Doctor: default `mine-and-adjacent`; a picked list replaces the scope. */
  specialtyScope: "mine-and-adjacent" | "all" | SpecialtyRef[];
  /** Doctor: format ids (online / offline / hybrid) — repeatable. */
  format: string[];
  /** Doctor: event-kind dictionary slugs (012 LD-12) — repeatable. */
  kind: string[];
  /** Doctor: city ids — offline events only. */
  city: string[];
  /** Doctor: «Только с НМО». */
  nmoOnly: boolean;
  /** Doctor: direction ids — repeatable. */
  direction: string[];
  /** Academy: project ids — repeatable. */
  project: string[];
  /** Academy: expert ids — repeatable. */
  expert: string[];
  /** Academy: topic ids — repeatable. */
  topic: string[];
}

/** The default scope — the value «Сбросить» returns to. */
export function defaultAppliedFacets(): AppliedFacets {
  return {
    query: "",
    specialtyScope: "mine-and-adjacent",
    format: [],
    kind: [],
    city: [],
    nmoOnly: false,
    direction: [],
    project: [],
    expert: [],
    topic: [],
  };
}

/**
 * The applied count of one host's facet set — the «Применено: N» of the
 * header and the N of the mobile «Фильтры (N)» control, from ONE rule.
 * «Все специальности» counts once; each picked specialty counts once.
 */
export function countAppliedFacets(
  applied: AppliedFacets,
  host: EventsFilterHost,
): number {
  if (host === "academy") {
    return (
      applied.project.length + applied.expert.length + applied.topic.length
    );
  }
  const scope = applied.specialtyScope;
  return (
    applied.format.length +
    applied.kind.length +
    applied.city.length +
    applied.direction.length +
    (Array.isArray(scope) ? scope.length : scope === "all" ? 1 : 0) +
    (applied.nmoOnly ? 1 : 0) +
    (applied.query.trim().length > 0 ? 1 : 0)
  );
}

/** The D-1 panel state the unit declares to its host. */
export interface FacetPanelState {
  host: EventsFilterHost;
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
  format?: EventsFilterOption[];
  kind?: EventsFilterOption[];
  /** Named specialties the specialty combobox offers. */
  specialty?: EventsFilterOption[];
  city?: EventsFilterOption[];
  direction?: EventsFilterOption[];
  project?: EventsFilterOption[];
  expert?: EventsFilterOption[];
  topic?: EventsFilterOption[];
}

/** The facets realised as a Combobox + removable chips. */
export type EventsFilterComboFacet =
  "specialty" | "city" | "direction" | "project" | "expert" | "topic";

/** Copy of one Combobox facet group. */
export interface EventsFilterComboLabels {
  /** The group caption («Город»). */
  label: string;
  /** The combobox copy while nothing is picked («Любой город»). */
  placeholder: string;
  /** The combobox copy once something is picked («Добавить город»). */
  addPlaceholder: string;
  searchPlaceholder?: string;
  /** A line under the caption («Только для офлайн-событий»). */
  hint?: string;
}

/** The host's server-search / paging bridge for one Combobox facet. */
export interface EventsFilterComboPaging {
  onSearchChange?: (query: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
  loadingMore?: boolean;
  loadMoreError?: boolean;
}

export interface EventsFilterLabels {
  /** Accessible name of the panel region. */
  panel: string;
  /** The header title («Фильтры»). */
  title: string;
  /** The stated applied count («Применено: N») — the app owns its pluralization. */
  appliedCount: (count: number) => string;
  reset: string;
  /** Verb prefix of a removable chip's accessible name («Убрать» → «Убрать: Казань»). */
  removeFacet: string;
  /** Strings every Combobox facet shares. */
  combobox: {
    emptyLabel: string;
    searchLabel?: string;
    countLabel?: (shown: number, total: number) => string;
    loadMoreLabel?: string;
    loadingMoreLabel?: string;
    loadMoreErrorLabel?: string;
  };
  /** Doctor facets — omit a label to drop the facet. */
  query?: { label: string; placeholder?: string };
  specialty?: EventsFilterComboLabels & { mine: string; all: string };
  format?: string;
  kind?: string;
  city?: EventsFilterComboLabels;
  nmoOnly?: string;
  direction?: EventsFilterComboLabels;
  /** Academy facets. */
  project?: EventsFilterComboLabels;
  expert?: EventsFilterComboLabels;
  topic?: EventsFilterComboLabels;
}

export interface EventsFilterProps {
  /** Which storefront's facet set renders (019 `filterSet`). */
  host: EventsFilterHost;
  applied: AppliedFacets;
  options: EventsFilterOptions;
  labels: EventsFilterLabels;
  /** The next applied set. Every facet emits the WHOLE set, so facets combine. */
  onChange: (next: AppliedFacets) => void;
  /** Reset as a link (URL-driven consumer, LD-1). Takes precedence over `onReset`. */
  resetHref?: string;
  /** Reset as an action (state-driven consumer). */
  onReset?: () => void;
  /** Render the «Фильтры» header. `false` for the mobile sheet body. Default `true`. */
  showHeader?: boolean;
  /** Server-search / paging bridge per Combobox facet (the city book is paged). */
  paging?: Partial<Record<EventsFilterComboFacet, EventsFilterComboPaging>>;
  /** Debounce window for the name search. Default 400ms (NN/g inactivity timeout). */
  queryDebounceMs?: number;
  className?: string;
}

function toggle(values: string[], id: string): string[] {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id];
}

/** The canvas facet caption: sm, 800, uppercase, `micro` tracking. */
function FacetCaption({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sm font-extrabold uppercase tracking-micro">
      {children}
    </span>
  );
}

interface PickedChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/**
 * A Combobox facet group: caption (+ hint), the Combobox offering only the
 * values not yet picked, and the picked values as removable chips. Removing a
 * chip moves focus to the next chip, else to the group's combobox — never to
 * the document.
 */
function ComboFacet({
  facet,
  labels,
  shared,
  options,
  picked,
  onPick,
  paging,
  removeFacet,
  children,
}: {
  facet: EventsFilterComboFacet;
  labels: EventsFilterComboLabels;
  shared: EventsFilterLabels["combobox"];
  options: EventsFilterOption[];
  picked: PickedChip[];
  onPick: (id: string) => void;
  paging: EventsFilterComboPaging | undefined;
  removeFacet: string;
  /** Extra controls between the caption and the combobox (the specialty scope chips). */
  children?: React.ReactNode;
}) {
  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const chipReturn = React.useRef<number | null>(null);
  const hintId = React.useId();

  React.useLayoutEffect(() => {
    const index = chipReturn.current;
    if (index === null || !groupRef.current) return;
    chipReturn.current = null;
    const chips = Array.from(
      groupRef.current.querySelectorAll<HTMLButtonElement>("[data-facet-chip]"),
    );
    const next = chips[Math.min(index, chips.length - 1)];
    if (next) {
      next.focus();
      return;
    }
    groupRef.current.querySelector<HTMLElement>("[role='combobox']")?.focus();
  });

  const pickedIds = new Set(picked.map((chip) => chip.id));
  const offered: ComboboxOption[] = options
    .filter((option) => !pickedIds.has(option.id))
    .map((option) => ({ value: option.id, label: option.label }));

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={labels.label}
      data-facet={facet}
      className="flex flex-col gap-3"
    >
      {labels.hint ? (
        <div className="flex flex-col gap-1">
          <FacetCaption>{labels.label}</FacetCaption>
          <span id={hintId} className="text-sm text-muted-foreground">
            {labels.hint}
          </span>
        </div>
      ) : (
        <FacetCaption>{labels.label}</FacetCaption>
      )}
      {children}
      <Combobox
        options={offered}
        value={null}
        onValueChange={onPick}
        placeholder={
          picked.length > 0 ? labels.addPlaceholder : labels.placeholder
        }
        showSearch
        emptyLabel={shared.emptyLabel}
        {...(labels.hint ? { "aria-describedby": hintId } : {})}
        {...(labels.searchPlaceholder
          ? { searchPlaceholder: labels.searchPlaceholder }
          : {})}
        {...(shared.searchLabel ? { searchLabel: shared.searchLabel } : {})}
        {...(shared.countLabel ? { countLabel: shared.countLabel } : {})}
        {...(shared.loadMoreLabel
          ? { loadMoreLabel: shared.loadMoreLabel }
          : {})}
        {...(shared.loadingMoreLabel
          ? { loadingMoreLabel: shared.loadingMoreLabel }
          : {})}
        {...(shared.loadMoreErrorLabel
          ? { loadMoreErrorLabel: shared.loadMoreErrorLabel }
          : {})}
        {...(paging ?? {})}
      />
      {picked.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {picked.map((chip, index) => (
            // A remove action, not a toggle: the selected chip's look (the
            // canvas draws a selected FilterChip) without `aria-pressed`, so
            // a screen reader hears «Убрать: X», never «X, pressed».
            <button
              key={chip.id}
              type="button"
              data-facet-chip=""
              className={filterChipVariants({ selected: true })}
              aria-label={`${removeFacet}: ${chip.label}`}
              onClick={() => {
                chipReturn.current = index;
                chip.onRemove();
              }}
            >
              {/* The canvas sets the cross off the label («label  ✕»); in the
                  flex chip a text space collapses, so the gap is a token. */}
              <span className="inline-flex items-center gap-1.5">
                <span>{chip.label}</span>
                <span aria-hidden="true">✕</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A multi-select chip facet («Формат», «Вид события»). */
function ChipFacet({
  label,
  options,
  values,
  onToggle,
}: {
  label: string;
  options: EventsFilterOption[];
  values: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-3">
      <FacetCaption>{label}</FacetCaption>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <FilterChip
            key={option.id}
            selected={values.includes(option.id)}
            onClick={() => onToggle(option.id)}
          >
            {option.label}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}

export function EventsFilter({
  host,
  applied,
  options,
  labels,
  onChange,
  resetHref,
  onReset,
  showHeader = true,
  paging,
  queryDebounceMs = 400,
  className,
}: EventsFilterProps) {
  const queryId = React.useId();
  const panelRef = React.useRef<HTMLElement | null>(null);
  // «Сбросить» lives in the header and unmounts with the applied state it
  // clears, so the focus target is resolved after that render.
  const resetReturn = React.useRef(false);

  // The search field owns the keystrokes; the consumer receives ONE commit per
  // typing pause. The timer calls the callback of the LATEST render — the
  // consumer rebuilds `onChange` around its current applied set, so a facet
  // toggled inside the window is not rolled back by a stale commit.
  const [draft, setDraft] = React.useState(applied.query);
  const lastCommitted = React.useRef(applied.query);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = React.useRef<(value: string) => void>(() => {});
  commitRef.current = (value: string) => onChange({ ...applied, query: value });

  // Follow the consumer's committed value when it changes from OUTSIDE (a
  // reset, a URL restore) — never on our own echo, which would delete
  // in-flight typing.
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

  // «Сбросить» drops an uncommitted query too: the pending commit would
  // otherwise re-apply a just-typed query on top of the reset.
  const cancelPendingQuery = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    lastCommitted.current = "";
    setDraft("");
  };

  const onQueryChange = (value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    // The COMMITTED query is trimmed: a whitespace-only field is no query at
    // all, and « PRP » searches the same string as «PRP».
    const committed = value.trim();
    timer.current = setTimeout(() => {
      lastCommitted.current = committed;
      commitRef.current(committed);
    }, queryDebounceMs);
  };

  React.useLayoutEffect(() => {
    if (!resetReturn.current) return;
    resetReturn.current = false;
    panelRef.current?.focus();
  });

  const appliedCount = countAppliedFacets(applied, host);
  const hasApplied = appliedCount > 0;

  const nameOf = (list: EventsFilterOption[] | undefined, id: string) =>
    list?.find((item) => item.id === id)?.label ?? id;

  /** A Combobox facet over one repeatable id list of the applied set. */
  const listFacet = (
    facet: "city" | "direction" | "project" | "expert" | "topic",
  ) => {
    const facetLabels = labels[facet];
    const list = options[facet];
    if (!facetLabels || !list || list.length === 0) return null;
    const values = applied[facet];
    return (
      <ComboFacet
        key={facet}
        facet={facet}
        labels={facetLabels}
        shared={labels.combobox}
        options={list}
        // A chip names its value by the host's option label; an applied id
        // the host gives no option for (a stale URL value) shows no chip
        // rather than a raw id — the host keeps picked values in `options`.
        picked={values.flatMap((id) => {
          const option = list.find((item) => item.id === id);
          return option
            ? [
                {
                  id,
                  label: option.label,
                  onRemove: () =>
                    onChange({
                      ...applied,
                      [facet]: values.filter((v) => v !== id),
                    }),
                },
              ]
            : [];
        })}
        onPick={(id) => onChange({ ...applied, [facet]: [...values, id] })}
        paging={paging?.[facet]}
        removeFacet={labels.removeFacet}
      />
    );
  };

  const chipFacet = (facet: "format" | "kind") => {
    const label = labels[facet];
    const list = options[facet];
    if (!label || !list || list.length === 0) return null;
    return (
      <ChipFacet
        label={label}
        options={list}
        values={applied[facet]}
        onToggle={(id) =>
          onChange({ ...applied, [facet]: toggle(applied[facet], id) })
        }
      />
    );
  };

  const specialtyFacet = () => {
    const specialty = labels.specialty;
    if (!specialty) return null;
    const scope = applied.specialtyScope;
    const picked = Array.isArray(scope) ? scope : [];
    const list = options.specialty ?? [];
    return (
      <ComboFacet
        facet="specialty"
        labels={specialty}
        shared={labels.combobox}
        options={list}
        picked={picked.map((ref) => ({
          id: ref.id,
          label: ref.label,
          onRemove: () => {
            const rest = picked.filter((item) => item.id !== ref.id);
            onChange({
              ...applied,
              specialtyScope: rest.length > 0 ? rest : "mine-and-adjacent",
            });
          },
        }))}
        onPick={(id) =>
          onChange({
            ...applied,
            specialtyScope: [...picked, { id, label: nameOf(list, id) }],
          })
        }
        paging={paging?.specialty}
        removeFacet={labels.removeFacet}
      >
        <div className="flex flex-wrap gap-2">
          <FilterChip
            selected={scope === "mine-and-adjacent"}
            onClick={() =>
              onChange({ ...applied, specialtyScope: "mine-and-adjacent" })
            }
          >
            {specialty.mine}
          </FilterChip>
          <FilterChip
            selected={scope === "all"}
            onClick={() => onChange({ ...applied, specialtyScope: "all" })}
          >
            {specialty.all}
          </FilterChip>
        </div>
      </ComboFacet>
    );
  };

  const resetLabel = labels.reset;
  const header = showHeader ? (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-lg font-extrabold">{labels.title}</h2>
        {hasApplied ? (
          <span className="text-sm font-bold text-muted-foreground">
            {labels.appliedCount(appliedCount)}
          </span>
        ) : null}
      </div>
      {hasApplied ? (
        resetHref ? (
          <Link href={resetHref} size="sm" onClick={cancelPendingQuery}>
            {resetLabel}
          </Link>
        ) : onReset ? (
          <Link asChild size="sm">
            <button
              type="button"
              onClick={() => {
                cancelPendingQuery();
                resetReturn.current = true;
                onReset();
              }}
            >
              {resetLabel}
            </button>
          </Link>
        ) : null
      ) : null}
    </div>
  ) : null;

  return (
    <section
      ref={panelRef}
      aria-label={labels.panel}
      // Programmatic focus target only (never in the tab order): where focus
      // lands when «Сбросить» unmounts with the applied state it cleared.
      tabIndex={-1}
      data-host={host}
      className={cn(
        "flex flex-col gap-8 text-foreground focus:outline-none",
        className,
      )}
    >
      {header}
      {host === "doctor" ? (
        <div className="flex flex-col gap-8">
          {labels.query ? (
            <div className="flex flex-col gap-3">
              <label
                htmlFor={queryId}
                className="text-sm font-extrabold uppercase tracking-micro"
              >
                {labels.query.label}
              </label>
              <Input
                id={queryId}
                type="search"
                value={draft}
                onChange={(event) => onQueryChange(event.target.value)}
                {...(labels.query.placeholder
                  ? { placeholder: labels.query.placeholder }
                  : {})}
              />
            </div>
          ) : null}
          {specialtyFacet()}
          {chipFacet("format")}
          {chipFacet("kind")}
          {listFacet("city")}
          {listFacet("direction")}
          {labels.nmoOnly ? (
            <Switch
              className="font-bold"
              checked={applied.nmoOnly}
              onChange={(event) =>
                onChange({ ...applied, nmoOnly: event.target.checked })
              }
            >
              {labels.nmoOnly}
            </Switch>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {listFacet("project")}
          {listFacet("expert")}
          {listFacet("topic")}
        </div>
      )}
    </section>
  );
}
