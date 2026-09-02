"use client";

import * as React from "react";
import { cn } from "../lib/utils";
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
  /** Tense-control copy — required only while `tenseControl` is `"tabs"`. */
  upcoming?: string;
  past?: string;
  emptyTitle: string;
  emptyDescription?: string;
  /** Pagination copy — required only while `paginationMode` is `"pages"` / `"cursor"`. */
  pagination?: string;
  previous?: string;
  next?: string;
  page?: (page: number) => string;
}

export interface EventListBaseProps {
  items: readonly EventListItem[];
  /** The tense the feed is currently reading — declared even when no control renders it. */
  selectedTab: EventListTab;
  onTabChange?: (tab: EventListTab) => void;
  counts?: Readonly<Record<EventListTab, number>>;
  labels: EventListLabels;
  page?: number;
  cursor?: string | null;
  onPageChange?: (page: number, cursor?: string | null) => void;
  /** Host-owned controls that belong between the canvas tabs and the feed. */
  toolbar?: React.ReactNode;
  /**
   * Whether the unit renders the «Будущие / Прошедшие» tense control (#1518).
   * `"none"` keeps the feed body and drops the control: a host whose release
   * reads ONE tense (019 release 1 per LD-10) then reuses THIS unit instead of
   * re-assembling a day-grouped list of its own.
   */
  tenseControl?: "tabs" | "none";
  /** Host-owned control below the feed — e.g. 019's «показать ещё», which is a URL edit, not a page state. */
  footer?: React.ReactNode;
}

/**
 * Paging shape, passed straight through to the shared `<Pagination>` block:
 * an offset host knows its `pageCount`, a cursor host knows only whether a page
 * exists on either side of the current one (#1641).
 */
export type EventListProps = EventListBaseProps &
  (
    | {
        paginationMode?: "pages";
        pageCount: number;
        hasPrevious?: never;
        hasNext?: never;
      }
    | {
        /** No pager at all — the host bounds the feed some other way (019's horizon). */
        paginationMode: "none";
        pageCount?: never;
        hasPrevious?: never;
        hasNext?: never;
      }
    | {
        paginationMode: "cursor";
        hasPrevious: boolean;
        hasNext: boolean;
        pageCount?: never;
      }
  );

/** Shared, controlled and fetch-free event feed for every DS frontend. */
export function EventList({
  items,
  selectedTab,
  onTabChange,
  counts,
  labels,
  page = 1,
  pageCount,
  cursor,
  onPageChange,
  toolbar,
  tenseControl = "tabs",
  footer,
  paginationMode = "pages",
  hasPrevious = false,
  hasNext = false,
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

  const body = (
    <>
      {toolbar}
      {groups.length === 0 ? (
        <EmptyState
          variant="no-records"
          title={labels.emptyTitle}
          description={labels.emptyDescription}
        />
      ) : (
        <div
          className={cn(
            "flex flex-col gap-8 layout:gap-12",
            toolbar && "mt-8 layout:mt-9",
          )}
        >
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
      {paginationMode === "none" ? null : paginationMode === "cursor" ? (
        <Pagination
          className="mt-8"
          mode="cursor"
          page={page}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          onPageChange={(nextPage) => onPageChange?.(nextPage, cursor)}
          navLabel={labels.pagination ?? ""}
          previousLabel={labels.previous ?? ""}
          nextLabel={labels.next ?? ""}
          pageLabel={labels.page ?? ((value) => String(value))}
        />
      ) : (
        <Pagination
          className="mt-8"
          page={page}
          pageCount={pageCount ?? 1}
          onPageChange={(nextPage) => onPageChange?.(nextPage, cursor)}
          navLabel={labels.pagination ?? ""}
          previousLabel={labels.previous ?? ""}
          nextLabel={labels.next ?? ""}
          pageLabel={labels.page ?? ((value) => String(value))}
        />
      )}
      {footer}
    </>
  );

  // A host reading ONE tense (019 release 1, LD-10) reuses the same feed body
  // with no control above it — the control is dropped, never re-implemented.
  if (tenseControl === "none") {
    return (
      <div className="mt-7 layout:mt-8" data-event-list-body="">
        {body}
      </div>
    );
  }

  return (
    <Tabs
      value={selectedTab}
      onValueChange={(value) => onTabChange?.(value as EventListTab)}
    >
      <TabsList
        className="w-full shadow-lg layout:w-auto"
        data-event-list-tabs=""
        data-testid="event-list-tabs"
      >
        <TabsTrigger value="upcoming">
          {labels.upcoming} · {counts?.upcoming ?? 0}
        </TabsTrigger>
        <TabsTrigger value="past">
          {labels.past} · {counts?.past ?? 0}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value={selectedTab}
        className="mt-7 layout:mt-8"
        data-event-list-body=""
      >
        {body}
      </TabsContent>
    </Tabs>
  );
}
