"use client";

import { useCallback, useMemo } from "react";
import { fetchRelationshipEndpointOptions } from "@/providers/data-provider";
import { pruneComboboxOptions } from "@/lib/server-combobox";
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

  const controller = useServerCombobox({
    fetchPage,
    toOption: (item) => ({
      id: item.id,
      label: item.title ?? item.name ?? removedLabel ?? "—",
    }),
    selectedId: value || null,
    pageSize: RELATIONSHIP_ENDPOINT_PAGE_SIZE,
  });

  // The exclusion is applied TWICE on purpose, and the two are not redundant:
  // `fetchPage` keeps a linked endpoint out of pages fetched from now on, this
  // prunes it out of the pages already in hand. A successful link leaves the
  // panel mounted (`LinkForm` only clears its value), so nothing re-queries —
  // and an endpoint that can only ever come back 409 must stop being offered
  // the moment it is linked, not at the next search.
  return useMemo(() => {
    const excluded = excludedKey ? excludedKey.split("|") : [];
    return {
      ...controller,
      options: pruneComboboxOptions(controller.options, excluded),
    };
  }, [controller, excludedKey]);
}
