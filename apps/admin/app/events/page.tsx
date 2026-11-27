"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type {
  AppliedFilter,
  DataTableColumn,
  DataTableSort,
} from "@ds/design-system/blocks";
import {
  ADMIN_LIST_PAGE_SIZE_DEFAULT,
  EVENT_LIFECYCLE_STATES,
  EventAdminListSortDirSchema,
  EventAdminListSortKeySchema,
  type EventAdminListItem,
  type EventLifecycleState,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { AdminDataList } from "@/components/admin-data-list";
import { EventsPeriodFilter } from "@/components/events-period-filter";
import { StateBadge } from "@/components/state-badge";
import {
  EVENTS_LIST_SORT_DEFAULT,
  eventsListHref,
  eventsListPeriod,
  eventsListQueryChange,
  eventsListSortOrderKind,
  eventsListViewFromAddress,
  isEventsListSortDefault,
  type EventsListView,
} from "@/lib/events-list";
import { formatMskDateTime } from "@/lib/msk";

/**
 * `EventAdminList` (007 design §8, EARS-14) — every event regardless of state,
 * on the one admin list composition (`AdminDataList`, 017 EARS-16/17/20): its
 * lifecycle chip, the air date/time in МСК (EARS-10) and the school. The single
 * source of truth (EARS-9): the `state` shown is exactly the
 * `EventLifecycleState` the 007 commands write and 004/005/006 read.
 *
 * EARS-14 — the list opens newest start date first and sorts server-side by one
 * of its four columns in either direction (a third header click returns to the
 * date order); it narrows instantly by a search over the title, the slug and the
 * school, by one lifecycle state and by a period of Moscow calendar days, every
 * applied facet a removable chip beside «Сбросить всё». The whole view — sort,
 * filters and page — lives in the ADDRESS (`lib/events-list.ts`), so a reload
 * or a shared link reopens it, and any change but paging returns to page 1.
 *
 * The address is the ONE source of truth, and a change is applied to it as it
 * stands at that moment (`window.location`, kept current synchronously by
 * `history.replaceState`, which Next.js syncs into `useSearchParams`) — never to
 * this render's copy, which a second change landing before the re-render (two
 * days picked back to back, «Сбросить всё» clearing the period and the search
 * in two writes) would overwrite.
 *
 * The whole ROW opens the event: a row has one action, so there is no
 * «Действия» column. Below `md` the rows are record cards with the same sort as
 * a «Сортировка» select.
 */
export default function EventsListPage() {
  const t = useTranslations();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = eventsListViewFromAddress(searchParams);
  const pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

  const changeView = (
    update: (current: EventsListView) => Partial<EventsListView>,
  ) => {
    const current = eventsListViewFromAddress(
      new URLSearchParams(window.location.search),
    );
    const next = { ...current, ...update(current) };
    window.history.replaceState(null, "", eventsListHref(pathname, next));
  };

  const { result, query: request } = useList<EventAdminListItem>({
    resource: "events",
    pagination: { currentPage: view.page, pageSize },
    filters: [
      { field: "q", operator: "contains", value: view.q },
      { field: "state", operator: "eq", value: view.state },
      { field: "startsFrom", operator: "gte", value: view.startsFrom },
      { field: "startsTo", operator: "lte", value: view.startsTo },
    ],
    sorters: [{ field: view.sort.key, order: view.sort.direction }],
  });

  const statusLabels = Object.fromEntries(
    EVENT_LIFECYCLE_STATES.map((state) => [state, t(`events.state.${state}`)]),
  ) as Record<EventLifecycleState, string>;

  const period = eventsListPeriod(view);
  const periodApplied: AppliedFilter[] = period
    ? [
        {
          id: "period",
          label: t("events.list.periodChip", {
            range:
              period.from && period.to
                ? t("events.list.rangeBoth", period)
                : period.from
                  ? t("events.list.rangeFrom", period)
                  : t("events.list.rangeTo", period),
          }),
          onRemove: () =>
            changeView(() => ({ startsFrom: "", startsTo: "", page: 1 })),
        },
      ]
    : [];

  const columns: DataTableColumn<EventAdminListItem>[] = [
    {
      key: "school",
      header: t("events.columns.school"),
      width: "22%",
      overflow: "wrap",
      sortKey: "school",
      render: (row) => (
        <span className="text-muted-foreground">{row.school}</span>
      ),
    },
    {
      key: "startsAt",
      header: t("events.columns.startsAt"),
      width: "22%",
      // The date-time is the list's own order and is never cut.
      overflow: "wrap",
      sortKey: "startsAt",
      render: (row) => (
        <span data-testid={`event-starts-${row.id}`}>
          {formatMskDateTime(row.startsAt)} {t("events.mskSuffix")}
        </span>
      ),
    },
    {
      key: "state",
      header: t("events.columns.state"),
      width: "16%",
      sortKey: "state",
      render: (row) => <StateBadge state={row.state} />,
    },
  ];

  return (
    <Authenticated key="events-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<EventAdminListItem, EventLifecycleState>
          title={t("events.listTitle")}
          description={t("events.listDescription")}
          createHref="/events/create"
          createLabel={t("events.createButton")}
          statuses={EVENT_LIFECYCLE_STATES}
          statusLabels={statusLabels}
          // An event keeps every state it reaches in the status facet — there
          // is no retained-rows switch to offer.
          retainsRetired={false}
          searchLabel={t("events.list.search")}
          searchPlaceholder={t("events.list.searchPlaceholder")}
          extraFilters={
            <EventsPeriodFilter
              period={view}
              onChange={(update) =>
                changeView((current) => ({ ...update(current), page: 1 }))
              }
            />
          }
          extraApplied={periodApplied}
          onResetExtra={() =>
            changeView(() => ({ startsFrom: "", startsTo: "", page: 1 }))
          }
          caption={t("events.list.tableCaption")}
          record={{
            header: t("events.columns.title"),
            width: "40%",
            sortKey: "title",
            title: (row) => (
              <span data-testid={`event-row-${row.id}`}>{row.title}</span>
            ),
            // The second line is what the search matches beside the title and
            // the school: the event's stable address.
            context: (row) => row.slug,
            label: (row) => row.title,
          }}
          columns={columns}
          rows={(result.data ?? []) as EventAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("events.list.loadFailed") : null}
          query={{
            q: view.q,
            status: view.state,
            includeRetired: false,
            page: view.page,
            pageSize,
            sort: view.sort,
          }}
          // Only what this change changed reaches the address (`view` is the
          // query the list was rendered with), so a header click right after a
          // typed search cannot write the render's older search back.
          onQueryChange={(next) =>
            changeView(() =>
              eventsListQueryChange(view, {
                q: next.q,
                status: next.status,
                sort: toEventsSort(next.sort),
                page: next.page,
              }),
            )
          }
          rowHref={(row) => `/events/${row.id}`}
          sortSelect={{
            label: t("events.list.sort.label"),
            optionLabel: (column, direction) =>
              t(
                isEventsListSortDefault({ key: column.key, direction })
                  ? "events.list.sort.defaultOption"
                  : "events.list.sort.option",
                {
                  column: column.header,
                  order: t(
                    `events.list.sort.order.${eventsListSortOrderKind(column.key)}.${direction}`,
                  ),
                },
              ),
          }}
          defaultSort={EVENTS_LIST_SORT_DEFAULT}
          sortActionLabel={(action) => t(`events.list.sort.action.${action}`)}
          emptyTitle={t("events.list.emptyTitle")}
          emptyDescription={t("events.list.emptyDescription")}
          testId="events"
        />
      </AppShell>
    </Authenticated>
  );
}

/** The table's sort as the route's pair; anything else is the date default. */
function toEventsSort(sort: DataTableSort | undefined) {
  const key = EventAdminListSortKeySchema.safeParse(sort?.key);
  const direction = EventAdminListSortDirSchema.safeParse(sort?.direction);
  return key.success && direction.success
    ? { key: key.data, direction: direction.data }
    : EVENTS_LIST_SORT_DEFAULT;
}
