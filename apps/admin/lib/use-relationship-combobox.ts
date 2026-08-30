"use client";

import { useEffect, useMemo, useState } from "react";
import { useCustom } from "@refinedev/core";
import type { ComboboxOption } from "@ds/design-system/blocks";
import {
  mergeRelationshipEndpointPages,
  relationshipEndpointLoadState,
  relationshipEndpointQuery,
  RELATIONSHIP_ENDPOINT_PAGE_SIZE,
  type RelationshipEndpointOption,
} from "@/lib/relationship-endpoint-query";

interface EndpointEnvelope<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function useRelationshipCombobox<
  T extends { id: string; title?: string; name?: string | null },
>({
  resource,
  excludedIds,
  value,
  removedLabel,
}: {
  resource: "events" | "projects" | "experts" | "directions" | "partners";
  excludedIds: string[];
  value: string;
  removedLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<RelationshipEndpointOption[]>([]);
  const [selected, setSelected] = useState<RelationshipEndpointOption | null>(
    null,
  );
  const [total, setTotal] = useState(0);
  const excludedKey = excludedIds.join("|");
  const queryString = relationshipEndpointQuery({ page, search });
  const { query } = useCustom<EndpointEnvelope<T>>({
    url: `/v1/admin/${resource}?${queryString}`,
    method: "get",
  });

  const envelope = query.data?.data;
  useEffect(() => {
    if (!envelope) return;
    const excluded = new Set(excludedKey ? excludedKey.split("|") : []);
    const incoming = envelope.data
      .filter((item) => !excluded.has(item.id))
      .map((item) => ({
        id: item.id,
        label: item.title ?? item.name ?? removedLabel ?? "—",
      }));
    setItems((current) =>
      page === 1
        ? incoming
        : mergeRelationshipEndpointPages(current, incoming, [...excluded]),
    );
    setTotal(envelope.total);
  }, [envelope, excludedKey, page, removedLabel]);

  const options = useMemo<ComboboxOption[]>(() => {
    const retained =
      selected &&
      selected.id === value &&
      !items.some((item) => item.id === value)
        ? [selected]
        : [];
    return [...retained, ...items].map((item) => ({
      value: item.id,
      label: item.label,
    }));
  }, [items, selected, value]);
  const loadState = relationshipEndpointLoadState({
    page,
    pageSize: envelope?.pageSize ?? RELATIONSHIP_ENDPOINT_PAGE_SIZE,
    total,
    isError: query.isError,
  });

  return {
    options,
    isLoading: query.isFetching && page === 1 && items.length === 0,
    isError: query.isError,
    hasMore: loadState.hasMore,
    loadingMore: query.isFetching && page > 1,
    loadMoreError: query.isError,
    search(next: string) {
      setSearch(next);
      setPage(1);
      setItems([]);
      setTotal(0);
    },
    select(next: string) {
      const option = items.find((item) => item.id === next) ?? null;
      setSelected(option);
    },
    async loadMore(): Promise<void> {
      if (query.isError) {
        await query.refetch();
        return;
      }
      if (loadState.action === "next") setPage((current) => current + 1);
    },
  };
}
