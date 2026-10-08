"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  EventList,
  type EventListItem,
  type EventListTab,
} from "@ds/design-system/blocks";

/**
 * The «Мои события» tab router (014 EARS-9, gate rows 25–26): the shared
 * `EventList` block with its tabs bound to the host's `?tab=` URL state. The
 * read returns a whole tab at once, so the block pages nothing
 * (`paginationMode="none"`). The events feed pages by its horizon instead
 * (gate §4.3 D2), so no cursor paging lives in the package any more.
 */
export function EventListRouter({
  items,
  selectedTab,
  counts,
  labels,
  basePath,
  pastTabParam = "past",
}: {
  items: readonly EventListItem[];
  selectedTab: EventListTab;
  counts: Record<EventListTab, number>;
  /**
   * The route this router navigates within — a host projection prop (the
   * «Мои события» page passes `routes.accountEvents` of the host config), never
   * hardcoded here; a per-host copy of this router is forbidden (AGENTS.md
   * cross-front reuse).
   */
  basePath: string;
  /**
   * The `?tab=` VALUE the host uses for the block's `past` tab. The block's own
   * union stays `upcoming | past`; «Мои события» spells its second tab
   * `?tab=recordings` in the URL (matching the api's `tab=recordings`), so the
   * mapping lives in this projection rather than widening the block.
   */
  pastTabParam?: string;
  labels: {
    upcoming: string;
    past: string;
    emptyTitle: string;
    emptyDescription?: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <EventList
      paginationMode="none"
      items={items}
      selectedTab={selectedTab}
      onTabChange={(tab) => {
        const params = new URLSearchParams(searchParams.toString());
        if (tab === "upcoming") params.delete("tab");
        else params.set("tab", pastTabParam);
        const query = params.toString();
        router.push(query ? `${basePath}?${query}` : basePath);
      }}
      counts={counts}
      labels={labels}
    />
  );
}
