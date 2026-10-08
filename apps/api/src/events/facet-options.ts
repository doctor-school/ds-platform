import type { PublicEventFacetOption } from "@ds/schemas";

/** One facet of a read: what a row carries for it and what the URL selected. */
export interface FacetDimension<Row> {
  selected: readonly string[];
  valuesOf(row: Row): readonly { slug: string; title: string }[];
}

/**
 * The facet-option rule of 014-design §9 over rows already in memory — the
 * doctor read's counterpart of {@link academyFacetOptions} (wave-2 gate §4.3
 * D9): every value a base row carries is an option; its `count` is the rows
 * carrying it under the OTHER facets' selections (OR within a facet, AND
 * across); a zero-yield option stays at `0`; ordered by title, then slug.
 * `emit` names the facets whose options are returned — the rest only narrow.
 */
export function facetOptionsOver<Row, K extends string, E extends K>(
  rows: readonly Row[],
  dimensions: Record<K, FacetDimension<Row>>,
  emit: readonly E[],
): Record<E, PublicEventFacetOption[]> {
  const keys = Object.keys(dimensions) as K[];
  const matches = (row: Row, key: K): boolean => {
    const dimension = dimensions[key];
    if (dimension.selected.length === 0) return true;
    return dimension
      .valuesOf(row)
      .some((value) => dimension.selected.includes(value.slug));
  };
  const result = {} as Record<E, PublicEventFacetOption[]>;
  for (const key of emit) {
    const options = new Map<string, PublicEventFacetOption>();
    for (const row of rows) {
      const counted = keys.every(
        (other) => other === key || matches(row, other),
      );
      for (const value of dimensions[key].valuesOf(row)) {
        const option = options.get(value.slug) ?? {
          slug: value.slug,
          title: value.title,
          count: 0,
        };
        if (counted) option.count += 1;
        options.set(value.slug, option);
      }
    }
    result[key] = [...options.values()].sort((a, b) =>
      a.title === b.title
        ? a.slug < b.slug
          ? -1
          : 1
        : a.title < b.title
          ? -1
          : 1,
    );
  }
  return result;
}
