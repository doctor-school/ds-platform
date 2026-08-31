"use client";

import { useCallback } from "react";
import { fetchRelationshipEndpointOptions } from "@/providers/data-provider";
import {
  useServerCombobox,
  type ServerComboboxController,
} from "@/lib/use-server-combobox";

/** One bounded endpoint page; the list routes cap `pageSize` well above it. */
const RELATIONSHIP_ENDPOINT_PAGE_SIZE = 20;

/**
 * The relationship-endpoint projection of the shared selector: it contributes
 * only what is specific to a relationship — which resource to list, which already
 * linked endpoints to exclude, and how an endpoint row reads as a label. Every
 * behaviour EARS-23 names (debounced immediate search, bounded pages, load-more,
 * loading/error states) belongs to `useServerCombobox` and is therefore identical
 * here and in the Expert User selector.
 */
export function useRelationshipCombobox({
  resource,
  excludedIds,
  value,
  removedLabel,
}: {
  resource: "events" | "projects" | "experts" | "directions" | "partners";
  excludedIds: string[];
  value: string;
  removedLabel?: string;
}): ServerComboboxController {
  const excludedKey = excludedIds.join("|");

  const fetchPage = useCallback(
    async ({
      q,
      page,
      pageSize,
    }: {
      q: string;
      page: number;
      pageSize: number;
    }) => {
      const result = await fetchRelationshipEndpointOptions({
        resource,
        q,
        page,
        pageSize,
      });
      // An already linked endpoint is filtered out of the OPTIONS, never out of
      // the total: the total is the server's answer about the page set, and
      // subtracting from it would stop load-more one page early.
      const excluded = new Set(excludedKey ? excludedKey.split("|") : []);
      return {
        ...result,
        data: result.data.filter((item) => !excluded.has(item.id)),
      };
    },
    [excludedKey, resource],
  );

  return useServerCombobox({
    fetchPage,
    toOption: (item) => ({
      id: item.id,
      label: item.title ?? item.name ?? removedLabel ?? "—",
    }),
    selectedId: value || null,
    pageSize: RELATIONSHIP_ENDPOINT_PAGE_SIZE,
  });
}
