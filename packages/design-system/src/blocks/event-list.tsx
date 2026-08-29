"use client";

import * as React from "react";
import { DayBand } from "../primitives/day-band";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../primitives/tabs";
import { WebinarCard, type WebinarCardProps } from "../primitives/webinar-card";
import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";

export type EventListTab = "upcoming" | "past";

export interface EventListItem extends Omit<
  WebinarCardProps,
  "children" | "key"
> {
  id: string;
  groupKey: string;
  groupLabel: string;
}

export interface EventListLabels {
  upcoming: string;
  past: string;
  emptyTitle: string;
  emptyDescription?: string;
  pagination: string;
  previous: string;
  next: string;
  page: (page: number) => string;
}

export interface EventListProps {
  items: readonly EventListItem[];
  selectedTab: EventListTab;
  onTabChange: (tab: EventListTab) => void;
  counts: Readonly<Record<EventListTab, number>>;
  labels: EventListLabels;
  page: number;
  pageCount: number;
  cursor?: string | null;
  onPageChange: (page: number, cursor?: string | null) => void;
}

/** Shared, controlled and fetch-free event feed for every DS frontend. */
export function EventList({
  items,
  selectedTab,
  onTabChange,
  counts,
  labels,
  page,
  pageCount,
  cursor,
  onPageChange,
}: EventListProps) {
  const groups = React.useMemo(() => {
    const result: Array<{
      key: string;
      label: string;
      items: EventListItem[];
    }> = [];
    for (const item of items) {
      const last = result.at(-1);
      if (last?.key === item.groupKey) last.items.push(item);
      else
        result.push({
          key: item.groupKey,
          label: item.groupLabel,
          items: [item],
        });
    }
    return result;
  }, [items]);

  return (
    <Tabs
      value={selectedTab}
      onValueChange={(value) => onTabChange(value as EventListTab)}
    >
      <TabsList>
        <TabsTrigger value="upcoming">
          {labels.upcoming} · {counts.upcoming}
        </TabsTrigger>
        <TabsTrigger value="past">
          {labels.past} · {counts.past}
        </TabsTrigger>
      </TabsList>
      <TabsContent value={selectedTab}>
        {groups.length === 0 ? (
          <EmptyState
            variant="no-records"
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : (
          <div className="flex flex-col gap-8 layout:gap-12">
            {groups.map((group) => (
              <section key={group.key} id={`day-${group.key}`}>
                <DayBand className="-mx-4 layout:hidden">{group.label}</DayBand>
                <div className="hidden layout:mb-6 layout:flex layout:items-baseline layout:gap-4">
                  <span className="text-caption font-extrabold uppercase tracking-micro whitespace-nowrap">
                    {group.label}
                  </span>
                  <span className="flex-1 border-t-2 border-foreground" />
                </div>
                <div className="-mx-4 flex flex-col layout:mx-0 layout:gap-7">
                  {group.items.map(
                    ({
                      id,
                      groupKey: _groupKey,
                      groupLabel: _groupLabel,
                      ...card
                    }) => (
                      <WebinarCard key={id} {...card} />
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
        <Pagination
          className="mt-8"
          page={page}
          pageCount={pageCount}
          onPageChange={(nextPage) => onPageChange(nextPage, cursor)}
          navLabel={labels.pagination}
          previousLabel={labels.previous}
          nextLabel={labels.next}
          pageLabel={labels.page}
        />
      </TabsContent>
    </Tabs>
  );
}
