"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { CongressRosterList, CongressRosterRow } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import {
  congressRosterCells,
  congressRosterRowNumber,
  type CongressRosterCells,
} from "@/lib/congress-roster";
import { formatMskDateTime } from "@/lib/msk";
import { useAdminAccess } from "@/lib/use-admin-access";
import { congressRosterUrl } from "@/providers/data-provider";

/**
 * 044 EARS-21 — the congress roster: one event's registrations on the
 * `AdminDataList` composition of the owner-approved admin baseline
 * (012-requirements EARS-23), with its instant search and pager unchanged.
 *
 * The roster is SERVER-paged and server-searched (`GET /v1/admin/events/:id/roster`,
 * #2311): `q`, `page` and `pageSize` go to the route and `total` comes back from
 * it, so nothing is sliced here. The query lives in component state exactly as
 * on the baseline lists (specialties, directions) — no address-bar sync.
 *
 * View-only by spec (EARS-24): no create button, no row link, no row action, and
 * no lifecycle facet — a registration has no «опубликовано / снято» state to
 * filter by. Columns follow EARS-25; the table's record column (always first in
 * `DataTable`) is the № counter, so ФИО is the first declared column and the
 * order reads №, ФИО, … exactly. Sort (EARS-22), column filters (EARS-23) and
 * print (EARS-26) are their own handlers.
 */
export default function CongressRosterPage() {
  const t = useTranslations();
  const params = useParams();
  const eventId = String(params.id);
  const access = useAdminAccess();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );

  const { query: request } = useCustom<CongressRosterList>({
    url: congressRosterUrl.list(eventId, {
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    }),
    method: "get",
  });
  // The query's own response, not Refine's `result` (an empty object until the
  // first answer): undefined while loading or failed.
  const roster = request.isError ? undefined : request.data?.data;
  const items = roster?.items ?? [];

  const mailStatusLabel = (status: "sent" | "failed") =>
    t(`congressRoster.mailStatuses.${status}`);

  type Row = CongressRosterRow & { number: number; cells: CongressRosterCells };
  const rows: Row[] = items.map((row, index) => ({
    ...row,
    number: congressRosterRowNumber(query, index),
    cells: congressRosterCells(row, mailStatusLabel),
  }));

  const column = (
    key: keyof CongressRosterCells,
    width: string,
  ): DataTableColumn<Row> => ({
    key,
    header: t(`congressRoster.columns.${key}`),
    width,
    render: (row) => (
      <span data-testid={`roster-cell-${key}`}>{row.cells[key]}</span>
    ),
    fullValue: (row) => row.cells[key],
  });

  const columns: DataTableColumn<Row>[] = [
    column("fullName", "15%"),
    column("specialtyName", "11%"),
    column("workplace", "12%"),
    column("city", "8%"),
    column("region", "9%"),
    column("phone", "10%"),
    column("email", "12%"),
    column("registeredAt", "10%"),
    column("confirmationMailStatus", "8%"),
  ];

  return (
    <Authenticated key="congress-roster" redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          {/* 044 EARS-20: the way back to the event detail exists only for a
              principal who may open that detail — a congress registrar may not,
              and its admin offers no event link at all. */}
          {access?.full ? (
            <BackToList
              href={`/events/${eventId}`}
              label={t("congressRoster.backToEvent")}
            />
          ) : null}
          <AdminDataList<Row, never>
            title={t("congressRoster.listTitle")}
            description={
              roster
                ? t("congressRoster.listDescription", {
                    title: roster.event.title,
                    date: formatMskDateTime(roster.event.startsAt),
                  })
                : t("congressRoster.loadingDescription")
            }
            searchable
            searchLabel={t("congressRoster.filters.search")}
            searchPlaceholder={t("congressRoster.filters.searchPlaceholder")}
            // A registration has no lifecycle to filter by; the per-column
            // filters are EARS-23, not this handler.
            filterable={false}
            caption={t("congressRoster.tableCaption")}
            record={{
              header: t("congressRoster.columns.number"),
              width: "5%",
              title: (row) => (
                <span data-testid={`roster-row-${row.registrationId}`}>
                  {row.number}
                </span>
              ),
              label: (row) => row.cells.fullName,
            }}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.registrationId}
            total={roster?.total ?? 0}
            isLoading={request.isLoading}
            error={
              request.isError ? t("congressRoster.errors.listFailed") : null
            }
            query={query}
            onQueryChange={setQuery}
            emptyTitle={t("congressRoster.empty")}
            emptyDescription={t("congressRoster.emptyDescription")}
            testId="roster"
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}
