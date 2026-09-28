"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Label, NativeSelect } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { CongressRosterList, CongressRosterRow } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { AttendanceCell } from "@/components/attendance-cell";
import { BackToList } from "@/components/back-to-list";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import {
  ATTENDANCE_FILTER_INITIAL,
  attendanceFilterQuery,
  congressDayShortLabel,
  congressRosterCells,
  congressRosterRowNumber,
  type AttendanceFilter,
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
 *
 * EARS-34 — the one write on this screen: the «Присутствие» column carries a
 * box per congress day (`AttendanceCell`), and the server-side presence filter
 * (day + «Присутствовал» / «Не отмечен») sits in the same filter bar, composing
 * with search and paging. The per-day attendance sort → #2316 (EARS-22/EARS-37
 * server sort; tracked in its AC since 2026-09-28).
 */
export default function CongressRosterPage() {
  const t = useTranslations();
  const params = useParams();
  const eventId = String(params.id);
  const access = useAdminAccess();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter>(
    ATTENDANCE_FILTER_INITIAL,
  );
  const changeAttendanceFilter = (next: AttendanceFilter) => {
    setAttendanceFilter(next);
    setQuery({ ...query, page: 1 });
  };

  const { query: request } = useCustom<CongressRosterList>({
    url: congressRosterUrl.list(eventId, {
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
      ...attendanceFilterQuery(attendanceFilter),
    }),
    method: "get",
  });
  // The query's own response, not Refine's `result` (an empty object until the
  // first answer): undefined while loading or failed.
  const roster = request.isError ? undefined : request.data?.data;
  const items = roster?.items ?? [];
  const congressDays = roster?.congressDays ?? [];

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
    column("fullName", "14%"),
    column("specialtyName", "10%"),
    column("workplace", "10%"),
    column("city", "7%"),
    column("region", "8%"),
    column("phone", "9%"),
    column("email", "10%"),
    column("registeredAt", "9%"),
    column("confirmationMailStatus", "8%"),
    {
      key: "attendance",
      header: t("congressRoster.columns.attendance"),
      width: "10%",
      render: (row) => (
        <AttendanceCell
          eventId={eventId}
          registrationId={row.registrationId}
          days={congressDays}
          attendance={row.attendance}
          // Every mark re-reads the list: the table and the phone-card render
          // of the row share the server truth, and a filtered list loses or
          // gains the row.
          onMarked={() => void request.refetch()}
          // The grant is gone: re-read the list, whose own refusal replaces
          // the roster — the mark itself is never retried.
          onForbidden={() => void request.refetch()}
        />
      ),
    },
  ];

  const presenceLabel = (presence: "marked" | "unmarked") =>
    t(`congressRoster.filters.presence.${presence}`);
  const attendanceFilters =
    congressDays.length > 0 ? (
      <>
        <div className="flex flex-col gap-1.5 sm:w-48">
          <Label htmlFor="roster-attendance-day">
            {t("congressRoster.filters.attendanceDay")}
          </Label>
          <NativeSelect
            id="roster-attendance-day"
            value={attendanceFilter.day}
            data-testid="roster-attendance-day"
            onChange={(event) =>
              changeAttendanceFilter({
                day: event.target.value,
                presence: event.target.value ? attendanceFilter.presence : "",
              })
            }
          >
            <option value="">{t("congressRoster.filters.attendanceDayAny")}</option>
            {congressDays.map((day) => (
              <option key={day} value={day}>
                {congressDayShortLabel(day)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5 sm:w-48">
          <Label htmlFor="roster-attendance-presence">
            {t("congressRoster.filters.presence.label")}
          </Label>
          <NativeSelect
            id="roster-attendance-presence"
            value={attendanceFilter.presence}
            disabled={!attendanceFilter.day}
            data-testid="roster-attendance-presence"
            onChange={(event) =>
              changeAttendanceFilter({
                ...attendanceFilter,
                presence: event.target.value as AttendanceFilter["presence"],
              })
            }
          >
            <option value="">{t("congressRoster.filters.presence.any")}</option>
            <option value="marked">{presenceLabel("marked")}</option>
            <option value="unmarked">{presenceLabel("unmarked")}</option>
          </NativeSelect>
        </div>
      </>
    ) : null;
  const attendanceApplied = attendanceFilter.day
    ? [
        {
          id: "attendance",
          label: attendanceFilter.presence
            ? `${congressDayShortLabel(attendanceFilter.day)} · ${presenceLabel(attendanceFilter.presence)}`
            : congressDayShortLabel(attendanceFilter.day),
          onRemove: () => changeAttendanceFilter(ATTENDANCE_FILTER_INITIAL),
        },
      ]
    : [];

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
            // filters are EARS-23, not this handler. The presence filter
            // (EARS-34) rides `extraFilters`.
            filterable={false}
            extraFilters={attendanceFilters}
            extraApplied={attendanceApplied}
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
