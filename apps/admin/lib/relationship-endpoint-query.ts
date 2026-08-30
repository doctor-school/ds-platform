const DEFAULT_PAGE_SIZE = 20;

export function relationshipEndpointQuery({
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  search,
}: {
  page: number;
  pageSize?: number;
  search: string;
}): string {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const normalizedSearch = search.trim();
  if (normalizedSearch.length > 0) query.set("q", normalizedSearch);
  return query.toString();
}

export function relationshipEndpointTotalPages(
  total: number,
  pageSize: number,
): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export interface RelationshipEndpointOption {
  id: string;
  label: string;
}

export function mergeRelationshipEndpointPages<
  T extends RelationshipEndpointOption,
>(current: T[], incoming: T[], excludedIds: readonly string[] = []): T[] {
  const excluded = new Set(excludedIds);
  const byId = new Map(
    current
      .filter((option) => !excluded.has(option.id))
      .map((option) => [option.id, option]),
  );
  for (const option of incoming) {
    if (!excluded.has(option.id)) byId.set(option.id, option);
  }
  return [...byId.values()];
}

export function relationshipEndpointLoadState({
  page,
  pageSize,
  total,
  isError,
}: {
  page: number;
  pageSize: number;
  total: number;
  isError: boolean;
}): { hasMore: boolean; action: "next" | "retry" | "none" } {
  if (isError) return { hasMore: true, action: "retry" };
  if (page * pageSize < total) return { hasMore: true, action: "next" };
  return { hasMore: false, action: "none" };
}

export { DEFAULT_PAGE_SIZE as RELATIONSHIP_ENDPOINT_PAGE_SIZE };
