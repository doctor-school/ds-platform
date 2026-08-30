"use client";

import { useCustom } from "@refinedev/core";

interface OccupancyList<T> {
  data: T[];
}

/**
 * Reads one invariant-holder through an already server-scoped relationship URL.
 * The caller must filter to the unique active role/flag and request pageSize=1;
 * this hook never scans a displayed or bounded relationship page.
 */
export function useRelationshipOccupancy<T extends { id: string }>(
  url: string,
  enabled: boolean,
) {
  const { query } = useCustom<OccupancyList<T>>({
    url,
    method: "get",
    queryOptions: { enabled },
  });

  return {
    incumbent: enabled ? (query.data?.data.data[0] ?? null) : null,
    isFetching: enabled && query.isFetching,
    isError: enabled && query.isError,
    refetch: query.refetch,
  };
}
