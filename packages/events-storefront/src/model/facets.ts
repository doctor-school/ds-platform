import type {
  AppliedFacets,
  EventsFilterHost,
  EventsFilterLabels,
  EventsFilterOption,
  EventsFilterOptions,
  SpecialtyRef,
} from "@ds/design-system/blocks";
import {
  type RawQueryRecord,
  rawQueryBoolean,
  rawQueryList,
  rawQueryScalar,
} from "@ds/schemas";

import { FILTER_COPY } from "../copy/filter-copy";
import type { FeedFacetOptions } from "./feed";
import { FACET_KEYS, pageHref } from "./feed-url";

const SPECIALTY_MODES = ["mine-and-adjacent", "all"] as const;

/**
 * The URL's facets as the panel's `AppliedFacets` (gate rows 58, 59): the
 * panel is presentational, the URL is the state (019 LD-1). A picked
 * specialty is named from `specialtyLabel` (the specialty read), else by its id.
 */
export function appliedFacetsOf(
  raw: RawQueryRecord,
  specialtyLabel: (id: string) => string | undefined = () => undefined,
): AppliedFacets {
  const list = (key: string) => rawQueryList(raw[key]) ?? [];
  const specialty = list("specialty");
  const mode = specialty.length === 1 ? specialty[0] : undefined;
  const specialtyScope: AppliedFacets["specialtyScope"] =
    specialty.length === 0 || mode === "mine-and-adjacent"
      ? "mine-and-adjacent"
      : mode === "all"
        ? "all"
        : specialty
            .filter((id) => !(SPECIALTY_MODES as readonly string[]).includes(id))
            .map((id): SpecialtyRef => ({ id, label: specialtyLabel(id) ?? id }));
  return {
    query: rawQueryScalar(raw.q) ?? "",
    specialtyScope,
    format: list("format"),
    kind: list("kind"),
    city: list("city"),
    nmoOnly: rawQueryBoolean(raw.nmo) === true,
    direction: [],
    project: list("project"),
    expert: list("expert"),
    topic: list("topic"),
  };
}

/**
 * The page's query with the host set's facets replaced by `applied` (row 58):
 * the view, the month and the tense stay; the extent and the day reset — a new
 * facet is a new reading. Removing the last picked specialty returns the scope
 * to «Моя и смежные», the default (row 59).
 */
export function withAppliedFacets(
  raw: RawQueryRecord,
  applied: AppliedFacets,
  filterSet: EventsFilterHost,
): RawQueryRecord {
  const next: RawQueryRecord = { ...raw, day: undefined, from: undefined, to: undefined };
  for (const key of FACET_KEYS[filterSet]) next[key] = undefined;
  const set = (key: string, values: readonly string[]) => {
    if (values.length > 0) next[key] = [...values];
  };
  if (filterSet === "academy") {
    set("project", applied.project);
    set("expert", applied.expert);
    set("topic", applied.topic);
    return next;
  }
  set("format", applied.format);
  set("kind", applied.kind);
  set("city", applied.city);
  const scope = applied.specialtyScope;
  if (scope === "all") next.specialty = "all";
  else if (Array.isArray(scope)) set("specialty", scope.map((ref) => ref.id));
  if (applied.nmoOnly) next.nmo = "true";
  const q = applied.query.trim();
  if (q.length > 0) next.q = q;
  return next;
}

/** A specialty the doctor specialty combobox offers — its URL value and name. */
export interface SpecialtyChoice {
  readonly code: string;
  readonly name: string;
}

/**
 * The panel's options for the host's facet set (rows 58, 59, D9): the
 * Academy project / expert / topic and the doctor kind (and city) from the
 * feed read's own option block, the doctor format from its fixed value set,
 * the doctor specialties from the specialty book. A facet the read names no
 * option for is left out, so the panel drops it (a doctor city, while no
 * event carries one).
 */
export function filterOptionsOf(
  filterSet: EventsFilterHost,
  read: FeedFacetOptions,
  specialties: readonly SpecialtyChoice[],
): EventsFilterOptions {
  const named = (key: string): EventsFilterOption[] | undefined => {
    const list = read[key] ?? [];
    return list.length === 0
      ? undefined
      : list.map((option) => ({ id: option.slug, label: option.title }));
  };
  const options: EventsFilterOptions = {};
  const put = (key: keyof EventsFilterOptions, list?: EventsFilterOption[]) => {
    if (list !== undefined) options[key] = list;
  };
  if (filterSet === "academy") {
    put("project", named("project"));
    put("expert", named("expert"));
    put("topic", named("topic"));
    return options;
  }
  put(
    "format",
    Object.entries(FILTER_COPY.format).map(([id, label]) => ({ id, label })),
  );
  put("kind", named("kind"));
  put(
    "specialty",
    specialties.map((choice) => ({ id: choice.code, label: choice.name })),
  );
  put("city", named("city"));
  return options;
}

/**
 * The panel's labels for the host's set. A control whose value the data
 * cannot distinguish is not rendered: the switch «Только с НМО» appears only
 * when the feed read's option block names both НМО values with events — one
 * rule with the facets above (the option source decides presence). Today 007
 * carries no НМО flag (DEBT «PR for #1518»), so no read names it.
 */
export function filterLabelsOf(
  filterSet: EventsFilterHost,
  read: FeedFacetOptions,
): EventsFilterLabels {
  const labels: EventsFilterLabels = { ...FILTER_COPY[filterSet] };
  const nmo = (read.nmo ?? []).filter((option) => option.count > 0);
  if (filterSet === "doctor" && nmo.length >= 2) {
    labels.nmoOnly = FILTER_COPY.nmoOnly;
  }
  return labels;
}

/** «Сбросить» — the page with none of the host's facets (row 58). */
export function resetFacetsHref(
  listing: string,
  raw: RawQueryRecord,
  filterSet: EventsFilterHost,
): string {
  const next: RawQueryRecord = { ...raw, day: undefined, from: undefined, to: undefined };
  for (const key of FACET_KEYS[filterSet]) next[key] = undefined;
  return pageHref(listing, next);
}

/**
 * Whether the page's URL applies any facet of the host's set — read through
 * the codec, so a default (`specialty=mine-and-adjacent`) or malformed value
 * applies nothing.
 */
export function hasAppliedFacets(
  raw: RawQueryRecord,
  filterSet: EventsFilterHost,
): boolean {
  const cleared: RawQueryRecord = { ...raw };
  for (const key of FACET_KEYS[filterSet]) cleared[key] = undefined;
  return pageHref("/", raw) !== pageHref("/", cleared);
}
