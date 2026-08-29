"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  EventList,
  type EventListItem,
  type EventListTab,
} from "@ds/design-system/blocks";

export function EventListRouter({
  items,
  selectedTab,
  counts,
  labels,
  cursor,
  nextCursor,
  hasMore,
  page,
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
      pageCount={Math.max(page, hasMore ? page + 1 : page)}
      cursor={cursor}
      onPageChange={(nextPage) =>
        navigate((params) => {
          const trail = (params.get("cursorTrail") ?? "")
            .split(",")
            .filter(Boolean);
          if (nextPage === 1) {
            params.delete("cursor");
            params.delete("cursorTrail");
            params.delete("page");
            return;
          }
          if (nextPage > page && nextCursor) {
            if (cursor) trail.push(cursor);
            params.set("cursor", nextCursor);
            if (trail.length) params.set("cursorTrail", trail.join(","));
            params.set("page", String(nextPage));
            return;
          }
          if (nextPage === page - 1) {
            const previous = trail.pop();
            if (previous) params.set("cursor", previous);
            else params.delete("cursor");
            if (trail.length) params.set("cursorTrail", trail.join(","));
            else params.delete("cursorTrail");
            if (nextPage === 1) params.delete("page");
            else params.set("page", String(nextPage));
          }
        })
      }
    />
  );
}
