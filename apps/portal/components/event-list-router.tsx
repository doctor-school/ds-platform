"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  EventList,
  type EventListItem,
  type EventListTab,
} from "@ds/design-system/blocks";

/**
 * How many previous cursors the URL carries (#1641). The public listing API is
 * forward-only (`{ nextCursor, hasMore }`), so «Назад» is served from cursors the
 * reader already visited. Keeping every one of them grew `?cursorTrail=` without
 * bound; the trail is now a fixed-size window of the most recent cursors — the ones
 * «Назад» can actually use — and the oldest entry falls off as the reader goes
 * deeper. Once a reader walks back past the window, the previous control is not
 * rendered at all rather than rendered dead (012 EARS-23).
 */
export const MAX_CURSOR_TRAIL = 20;

function readTrail(params: URLSearchParams): string[] {
  return (params.get("cursorTrail") ?? "").split(",").filter(Boolean);
}

export function EventListRouter({
  items,
  selectedTab,
  counts,
  labels,
  cursor,
  nextCursor,
  hasMore,
  page,
  toolbar,
}: {
  items: readonly EventListItem[];
  selectedTab: EventListTab;
  counts: Record<EventListTab, number>;
  labels: {
    upcoming: string;
    past: string;
    emptyTitle: string;
    emptyDescription?: string;
    pagination: string;
    previous: string;
    next: string;
    pagePrefix: string;
  };
  cursor?: string;
  nextCursor: string | null;
  hasMore: boolean;
  page: number;
  toolbar?: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pagePrefix, ...eventLabels } = labels;

  function navigate(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    const query = params.toString();
    router.push(query ? `/webinars?${query}` : "/webinars");
  }

  // «Назад» renders only when this projection can actually serve the previous page:
  // page 2 returns to the un-cursored first page, deeper pages need a remembered
  // cursor in the bounded trail.
  const trail = readTrail(new URLSearchParams(searchParams.toString()));
  const hasPreviousPage = page === 2 || (page > 2 && trail.length > 0);

  return (
    <EventList
      items={items}
      selectedTab={selectedTab}
      onTabChange={(tab) =>
        navigate((params) => {
          if (tab === "upcoming") params.delete("tab");
          else params.set("tab", tab);
          params.delete("cursor");
          params.delete("cursorTrail");
          params.delete("page");
        })
      }
      counts={counts}
      labels={{ ...eventLabels, page: (number) => `${pagePrefix} ${number}` }}
      page={page}
      paginationMode="cursor"
      hasPrevious={hasPreviousPage}
      hasNext={Boolean(hasMore && nextCursor)}
      cursor={cursor}
      onPageChange={(nextPage) =>
        navigate((params) => {
          const trail = readTrail(params);
          if (nextPage <= 1) {
            params.delete("cursor");
            params.delete("cursorTrail");
            params.delete("page");
            return;
          }
          if (nextPage === page + 1 && nextCursor) {
            if (cursor) trail.push(cursor);
            params.set("cursor", nextCursor);
            // Bounded window: the oldest cursors fall off, so the URL cannot grow
            // with the reader's depth.
            const bounded = trail.slice(-MAX_CURSOR_TRAIL);
            if (bounded.length) params.set("cursorTrail", bounded.join(","));
            else params.delete("cursorTrail");
            params.set("page", String(nextPage));
            return;
          }
          if (nextPage === page - 1) {
            const previous = trail.pop();
            if (previous) params.set("cursor", previous);
            else params.delete("cursor");
            if (trail.length) params.set("cursorTrail", trail.join(","));
            else params.delete("cursorTrail");
            params.set("page", String(nextPage));
          }
        })
      }
      toolbar={toolbar}
    />
  );
}
