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

export { DEFAULT_PAGE_SIZE as RELATIONSHIP_ENDPOINT_PAGE_SIZE };
