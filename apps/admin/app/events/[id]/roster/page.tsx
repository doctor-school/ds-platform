"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Label, NativeSelect } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { CongressRosterList, CongressRosterRow } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { AttendanceCell } from "@/components/attendance-cell";
import { BackToList } from "@/components/back-to-list";
import { DeskRegistrationForm } from "@/components/desk-registration-form";
import { ParticipantCardPanel } from "@/components/participant-card-panel";
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
import {
  PARTICIPANT_CARD_PARAM,
  participantCardHref,
  participantCardNeighbour,
  pendingCardAnchor,
  queueCardRequest,
  settlePendingCards,
} from "@/lib/participant-card";
import { canAccessResource } from "@/lib/admin-access";
import {
  ADMIN_SESSION_QUERY_KEY,
  adminQueryClient,
} from "@/lib/admin-session-cache";
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
 * No create button, no row link, no row action (EARS-24), and no lifecycle
 * facet — a registration has no «опубликовано / снято» state to filter by. One
 * write on this screen is the registrar's desk entry (EARS-35), a side panel
 * opened from the page's own toolbar row: it is not a resource create (the entry goes
 * through the congress intake, not a CRUD route), so it is not the list's
 * `createHref`. A `?q=` in the address seeds the search. Columns follow EARS-37
 * (№, ФИО, специальность, город, телефон, дата регистрации, присутствие); the
 * table's record column (always first in `DataTable`) is the № counter, so ФИО
 * is the first declared column and the order reads №, ФИО, … exactly. Sort
 * (EARS-22), column filters (EARS-23) and print (EARS-26) are their own handlers.
 *
 * EARS-36 — a row click (or Enter on the row's focused control) opens the
 * participant card in the side panel over the roster; ↑/↓ in the panel walk the
 * rows of the current page, Esc closes it and returns focus to the row. The
 * open card is in the address as `?registration=<id>` (written with
 * `router.replace`, the rest of the query kept), so a record can be linked — the
 * desk's «Открыть запись» for an already-registered participant lands on it.
 *
 * EARS-34 — the other write on this screen: the «Присутствие» column carries a
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
  const searchParams = useSearchParams();
  const addressQ = searchParams.get("q");
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(() => ({
    ...ADMIN_DATA_LIST_INITIAL_QUERY,
    q: addressQ ?? ADMIN_DATA_LIST_INITIAL_QUERY.q,
  }));
  useEffect(() => {
    if (addressQ !== null) {
      setQuery((current) => ({ ...current, q: addressQ, page: 1 }));
    }
  }, [addressQ]);
  // 044 EARS-36 — the open participant card lives in the address.
  const router = useRouter();
  const pathname = usePathname();
  const openRegistration = searchParams.get(PARTICIPANT_CARD_PARAM);
  const lastOpened = useRef<string | null>(openRegistration);
  // Requests sent but not yet answered by the address (`router.replace` is
  // async): a held ↓ walks on from the newest one, not from a stale address.
  const pendingCards = useRef<(string | null)[]>([]);
  useEffect(() => {
    pendingCards.current = settlePendingCards(
      pendingCards.current,
      openRegistration,
    );
    if (openRegistration) lastOpened.current = openRegistration;
  }, [openRegistration]);
  const showCard = (registrationId: string | null) => {
    if (registrationId) lastOpened.current = registrationId;
    pendingCards.current = queueCardRequest(
      pendingCards.current,
      openRegistration,
      registrationId,
    );
    router.replace(
      participantCardHref(pathname, searchParams.toString(), registrationId),
      { scroll: false },
    );
  };
  // The panel takes the focus when it opens; a row picked while the non-modal
  // inspector (≥ lg) is already open would keep it on the row, outside the
  // panel that owns ↑/↓ — so the focus follows the card into the panel.
  const cardContent = useRef<HTMLDivElement>(null);
  const showCardFromRow = (registrationId: string) => {
    showCard(registrationId);
    cardContent.current?.focus({ preventScroll: true });
  };
  const [accepted, setAccepted] = useState<string | null>(null);
  // 044 EARS-35 / ADR-0001 A1: the desk route re-checks the grant live; a 403
  // there means it was withdrawn since this page loaded. The screen then says
  // what the shell says for a roster it may not open, and re-reads the session
  // so the navigation follows.
  const [grantWithdrawn, setGrantWithdrawn] = useState(false);
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

  type Row = CongressRosterRow & { number: number; cells: CongressRosterCells };
  const rows: Row[] = items.map((row, index) => ({
    ...row,
    number: congressRosterRowNumber(query, index),
    cells: congressRosterCells(row),
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
    column("fullName", "24%"),
    column("specialtyName", "16%"),
    column("city", "12%"),
    column("phone", "14%"),
    column("registeredAt", "15%"),
    {
      key: "attendance",
      header: t("congressRoster.columns.attendance"),
      width: "14%",
      render: (row) => (
        // Above the row's stretched activation overlay (`DataTable`), so a
        // box is its own click target and never opens the card.
        <div className="relative z-10">
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
        </div>
      ),
    },
  ];

  const refetchRoster = request.refetch;
  const rosterStale = useCallback(() => void refetchRoster(), [refetchRoster]);
  const rowIds = rows.map((row) => row.registrationId);
  const navigateCard = (direction: "prev" | "next") => {
    const anchor = pendingCardAnchor(pendingCards.current, openRegistration);
    if (!anchor) return;
    const next = participantCardNeighbour(rowIds, anchor, direction);
    if (next) showCard(next);
  };
  // Esc / × return focus to the row whose card was open last — the visible
  // render of it (the table ≥ md, the record card below).
  const returnFocusToRow = (event: Event) => {
    const id = lastOpened.current;
    if (!id) return;
    const control = Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-testid="roster-row-${CSS.escape(id)}"]`,
      ),
    )
      .map((title) => title.closest("button"))
      .find((button) => button !== null && button.offsetParent !== null);
    if (!control) return;
    event.preventDefault();
    control.focus();
  };

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
            <option value="">
              {t("congressRoster.filters.attendanceDayAny")}
            </option>
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
  const mayEnter = access
    ? canAccessResource(access, "congress-roster", { id: eventId })
    : false;

  if (grantWithdrawn) {
    return (
      <Authenticated key="congress-roster" redirectOnFail="/login">
        <AppShell>
          <p
            className="text-sm text-muted-foreground"
            data-testid="access-refused"
          >
            {t("login.errorForbidden")}
          </p>
        </AppShell>
      </Authenticated>
    );
  }

  return (
    <Authenticated key="congress-roster" redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          <div
            className={
              access?.full
                ? "flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
                : "flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-end"
            }
          >
            {/* 044 EARS-20: the way back to the event detail exists only for a
                principal who may open that detail — a congress registrar may
                not, and its admin offers no event link at all. */}
            {access?.full ? (
              <BackToList
                href={`/events/${eventId}`}
                label={t("congressRoster.backToEvent")}
              />
            ) : null}
            {mayEnter ? (
              <DeskRegistrationForm
                eventId={eventId}
                onAccepted={(name) => {
                  setAccepted(name);
                  void request.refetch();
                }}
                onGrantWithdrawn={() => {
                  setGrantWithdrawn(true);
                  void adminQueryClient.invalidateQueries({
                    queryKey: ADMIN_SESSION_QUERY_KEY,
                  });
                }}
              />
            ) : null}
          </div>
          {accepted ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="desk-entry-accepted"
              role="status"
            >
              {t("congressRoster.deskEntry.accepted", { name: accepted })}
            </p>
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
            onRowClick={(row) => showCardFromRow(row.registrationId)}
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
          <ParticipantCardPanel
            eventId={eventId}
            registrationId={openRegistration}
            onClose={() => showCard(null)}
            onNavigate={navigateCard}
            onRosterStale={rosterStale}
            onCloseAutoFocus={returnFocusToRow}
            contentRef={cardContent}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}
