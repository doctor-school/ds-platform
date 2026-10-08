import type {
  AppliedFacets,
  EventsFilterHost,
  SpecialtyRef,
} from "@ds/design-system/blocks";
import {
  type RawQueryRecord,
  rawQueryBoolean,
  rawQueryList,
  rawQueryScalar,
} from "@ds/schemas";

import { FACET_KEYS } from "./feed-url";

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
