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
 * What the feed read says about the default specialty scope (019 LD-9): with
 * `defaultScopeEmpty` — reported on every read, whatever scope the URL names —
 * this visitor's default is «Все специальности».
 */
export interface SpecialtyDefault {
  readonly defaultScopeEmpty?: boolean;
}

/** The specialty scope this visitor reads with nothing applied (019 LD-9). */
export function defaultSpecialtyScopeOf({
  defaultScopeEmpty = false,
}: SpecialtyDefault = {}): "mine-and-adjacent" | "all" {
  return defaultScopeEmpty ? "all" : "mine-and-adjacent";
}

/** Which specialty scope the page applies — the key of a scoped head subline. */
export type SpecialtyScopeKind = "mineAndAdjacent" | "all" | "picked";

/**
 * The specialty scope the page applies (019 LD-9, #2871): a URL naming no
 * scope reads as the visitor's default — «Все специальности» when their
 * «Моя и смежные» is empty — an explicit scope as itself, and picked
 * specialties as `picked`. The head subline follows it.
 */
export function specialtyScopeKindOf(
  raw: RawQueryRecord,
  specialtyDefault: SpecialtyDefault = {},
): SpecialtyScopeKind {
  const { specialtyScope } = appliedFacetsOf(
    raw,
    undefined,
    specialtyDefault,
  );
  if (specialtyScope === "all") return "all";
  if (specialtyScope === "mine-and-adjacent") return "mineAndAdjacent";
  return "picked";
}

/**
 * The URL's facets as the panel's `AppliedFacets` (gate rows 58, 59): the
 * panel is presentational, the URL is the state (019 LD-1). A picked
 * specialty is named from `specialtyLabel` (the specialty read), else by its id.
 * A URL naming no scope reads as the default — «Моя и смежные», or
 * «Все специальности» when the doctor's «Моя и смежные» is empty (LD-9).
 */
export function appliedFacetsOf(
  raw: RawQueryRecord,
  specialtyLabel: (id: string) => string | undefined = () => undefined,
  { defaultScopeEmpty = false }: SpecialtyDefault = {},
): AppliedFacets {
  const list = (key: string) => rawQueryList(raw[key]) ?? [];
  const specialty = list("specialty");
  const mode = specialty.length === 1 ? specialty[0] : undefined;
  const specialtyScope: AppliedFacets["specialtyScope"] =
    specialty.length === 0
      ? defaultScopeEmpty
        ? "all"
        : "mine-and-adjacent"
      : mode === "mine-and-adjacent"
        ? "mine-and-adjacent"
        : mode === "all"
        ? "all"
        : specialty
            .filter((id) => !(SPECIALTY_MODES as readonly string[]).includes(id))
            .map((id): SpecialtyRef => ({ id, label: specialtyLabel(id) ?? id }));
  return {
    query: rawQueryScalar(raw.q) ?? "",
    specialtyScope,
    // The format set is fixed: a value outside it (a hand-edited URL) names
    // no format, so it is not applied — never a chip or a count (EARS-7).
    format: list("format").filter((id) => Object.hasOwn(FILTER_COPY.format, id)),
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
 * to the visitor's default scope (row 59, LD-9), which is left unwritten:
 * «Моя и смежные», or «Все специальности» when the doctor's «Моя и смежные»
 * is empty — then «Моя и смежные» is written and kept across later facet clicks,
 * so the fall-back does not take it back (LD-9).
 */
export function withAppliedFacets(
  raw: RawQueryRecord,
  applied: AppliedFacets,
  filterSet: EventsFilterHost,
  { defaultScopeEmpty = false }: SpecialtyDefault = {},
): RawQueryRecord {
  const next: RawQueryRecord = {
    ...raw,
    day: undefined,
    from: undefined,
    to: undefined,
    count: undefined,
  };
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
  if (scope === "all") {
    if (!defaultScopeEmpty) next.specialty = "all";
  } else if (scope === "mine-and-adjacent") {
    if (defaultScopeEmpty) next.specialty = "mine-and-adjacent";
  } else if (Array.isArray(scope)) set("specialty", scope.map((ref) => ref.id));
  if (applied.nmoOnly) next.nmo = "true";
  const q = applied.query.trim();
  if (q.length > 0) next.q = q;
  return next;
}

/**
 * An event kind's URL value and name, as the public kind dictionary serves it
 * — a published or a retired kind (012 EARS-28, Amendment — 2026-10-13).
 */
export interface KindTitle {
  readonly slug: string;
  readonly title: string;
}

/**
 * The page's query with every applied kind the dictionary does not carry
 * dropped — a slug that names no published or retired kind (never existed, a
 * draft, deleted) is not applied, like a format outside the fixed set: no
 * read, no chip, no count (019 EARS-7). A retired kind stays applied. A failed
 * dictionary read (`null`) drops nothing, so a transient failure never loses
 * an applied kind.
 */
export function withKnownKinds(
  raw: RawQueryRecord,
  kinds: readonly KindTitle[] | null,
): RawQueryRecord {
  const applied = rawQueryList(raw.kind) ?? [];
  if (kinds === null || applied.length === 0) return raw;
  const known = applied.filter((slug) => kinds.some((kind) => kind.slug === slug));
  if (known.length === applied.length) return raw;
  const { kind: _dropped, ...rest } = raw;
  return known.length === 0 ? rest : { ...rest, kind: known };
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
 * event carries one). The kind dictionary names an applied kind the read does
 * not offer under this reading (a retired kind with no event in it), so its
 * chip keeps its title (019 EARS-7).
 */
export function filterOptionsOf(
  filterSet: EventsFilterHost,
  read: FeedFacetOptions,
  specialties: readonly SpecialtyChoice[],
  kinds: readonly KindTitle[] = [],
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
  if (kinds.length > 0) {
    options.appliedNames = {
      kind: kinds.map((kind) => ({ id: kind.slug, label: kind.title })),
    };
  }
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
  const next: RawQueryRecord = {
    ...raw,
    day: undefined,
    from: undefined,
    to: undefined,
    count: undefined,
  };
  for (const key of FACET_KEYS[filterSet]) next[key] = undefined;
  return pageHref(listing, next);
}

/**
 * Whether the page's URL applies any facet of the host's set — read through
 * the codec, so a malformed value applies nothing, and neither does an
 * explicit default scope of this visitor (019 LD-9): «Моя и смежные», or
 * «Все специальности» when the doctor's «Моя и смежные» is empty.
 */
export function hasAppliedFacets(
  raw: RawQueryRecord,
  filterSet: EventsFilterHost,
  scopeDefault: SpecialtyDefault = {},
): boolean {
  const applied: RawQueryRecord = { ...raw };
  const specialty = rawQueryList(raw.specialty);
  if (specialty?.length === 1 && specialty[0] === defaultSpecialtyScopeOf(scopeDefault)) {
    applied.specialty = undefined;
  }
  const cleared: RawQueryRecord = { ...raw };
  for (const key of FACET_KEYS[filterSet]) cleared[key] = undefined;
  return pageHref("/", applied) !== pageHref("/", cleared);
}
