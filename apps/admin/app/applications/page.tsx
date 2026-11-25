"use client";

import { useEffect, useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Label, NativeSelect } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type {
  AdminApplicationListItem,
  AdminApplicationListPage,
  ApplicationKind,
  ApplicationStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";
import {
  APPLICATION_KIND_FILTERS,
  APPLICATION_STATUS_FILTERS,
  APPLICATIONS_ROUTE,
  applicationStatusLabelKey,
  applicationsPageCount,
  applicationsUrl,
  rememberNextCursor,
} from "@/lib/applications";
import { formatMskDateTime } from "@/lib/msk";

interface ApplicationsFilter {
  kind: ApplicationKind | "";
  status: ApplicationStatus | "";
}

const FILTER_INITIAL: ApplicationsFilter = { kind: "", status: "" };

/**
 * «Заявки» (033 EARS-13; approved-non-canvas state `applications-list` of
 * 033-design «UI composition → Admin») — the application queue on the
 * `AdminDataList` composition, newest first: «Вид», «Получена», «Заявитель»,
 * «Тема / компания», «Статус», with the «Команда не уведомлена» (EARS-11) and
 * «Персональные данные стёрты» (EARS-20) marks; the «Вид» and «Статус» facets
 * apply instantly as removable chips; the row opens the application.
 *
 * The API pages by cursor and counts nothing, so the pager offers the pages the
 * operator reached plus the next one while the current page names a next
 * cursor, and the count readout is omitted rather than guessed. A filter change
 * starts again from the first page.
 */
export default function ApplicationsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const [filter, setFilter] = useState<ApplicationsFilter>(FILTER_INITIAL);
  /** `cursors[p - 1]` reads page `p`; page 1 has none. */
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  const { result, query: request } = useCustom<AdminApplicationListPage>({
    url: applicationsUrl.list({
      kind: filter.kind,
      status: filter.status,
      cursor: cursors[query.page - 1],
      limit: query.pageSize,
    }),
    method: "get",
  });
  const page = request.isError ? undefined : result.data;
  const nextCursor = page?.nextCursor ?? null;
  useEffect(() => {
    setCursors((known) => rememberNextCursor(known, query.page, nextCursor));
  }, [nextCursor, query.page]);

  const changeFilter = (next: Partial<ApplicationsFilter>) => {
    setFilter((current) => ({ ...current, ...next }));
    setCursors([undefined]);
    setQuery((current) => ({ ...current, page: 1 }));
  };

  const changeQuery = (next: AdminDataListQueryState<never>) => {
    if (next.pageSize !== query.pageSize) {
      setCursors([undefined]);
      setQuery({ ...next, page: 1 });
      return;
    }
    // Only a page whose cursor is known can be read.
    setQuery({ ...next, page: Math.min(next.page, cursors.length) });
  };

  const kindLabel = (kind: ApplicationKind) =>
    t(`applications.kindFilter.${kind}`);
  const statusFilterLabel = (status: ApplicationStatus) =>
    t(`applications.statusFilter.${status}`);

  const facet = "flex flex-col gap-1.5 sm:w-56";
  const extraFilters = (
    <>
      <div className={facet}>
        <Label htmlFor="applications-kind">
          {t("applications.filters.kind")}
        </Label>
        <NativeSelect
          id="applications-kind"
          value={filter.kind}
          data-testid="applications-kind"
          onChange={(event) =>
            changeFilter({ kind: event.target.value as ApplicationKind | "" })
          }
        >
          <option value="">{t("applications.filters.kindAny")}</option>
          {APPLICATION_KIND_FILTERS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(kind)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className={facet}>
        <Label htmlFor="applications-status">
          {t("applications.filters.status")}
        </Label>
        <NativeSelect
          id="applications-status"
          value={filter.status}
          data-testid="applications-status"
          onChange={(event) =>
            changeFilter({
              status: event.target.value as ApplicationStatus | "",
            })
          }
        >
          <option value="">{t("applications.filters.statusAny")}</option>
          {APPLICATION_STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {statusFilterLabel(status)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </>
  );

  const extraApplied = [
    ...(filter.kind
      ? [
          {
            id: "kind",
            label: `${t("applications.filters.kind")}: ${kindLabel(filter.kind)}`,
            onRemove: () => changeFilter({ kind: "" }),
          },
        ]
      : []),
    ...(filter.status
      ? [
          {
            id: "status",
            label: `${t("applications.filters.status")}: ${statusFilterLabel(filter.status)}`,
            onRemove: () => changeFilter({ status: "" }),
          },
        ]
      : []),
  ];

  const statusText = (row: AdminApplicationListItem) =>
    t(applicationStatusLabelKey(row.status, row.outcome));

  const columns: DataTableColumn<AdminApplicationListItem>[] = [
    {
      key: "submittedAt",
      header: t("applications.columns.submittedAt"),
      width: "16%",
      fullValue: (row) => formatMskDateTime(row.submittedAt),
      render: (row) => (
        <span className="text-muted-foreground">
          {formatMskDateTime(row.submittedAt)}
        </span>
      ),
    },
    {
      key: "applicant",
      header: t("applications.columns.applicant"),
      width: "20%",
      overflow: "wrap",
      fullValue: (row) => row.applicant ?? t("applications.noApplicant"),
      render: (row) =>
        row.erased ? (
          <Badge variant="label" data-testid={`application-erased-${row.id}`}>
            {t("applications.marks.erased")}
          </Badge>
        ) : (
          <span>{row.applicant ?? t("applications.noApplicant")}</span>
        ),
    },
    {
      key: "subject",
      header: t("applications.columns.subject"),
      width: "26%",
      overflow: "wrap",
      fullValue: (row) => row.subjectLine ?? t("applications.noSubject"),
      render: (row) => (
        <span className="text-muted-foreground">
          {row.subjectLine ?? t("applications.noSubject")}
        </span>
      ),
    },
    {
      key: "status",
      header: t("applications.columns.status"),
      width: "22%",
      overflow: "wrap",
      fullValue: statusText,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip
            status={
              row.status === "closed" && row.outcome ? row.outcome : row.status
            }
            label={statusText(row)}
            testId={`application-status-${row.id}`}
          />
          {row.teamNotified ? null : (
            <StatusChip
              status="not_notified"
              label={t("applications.marks.teamNotNotified")}
              testId={`application-not-notified-${row.id}`}
            />
          )}
        </span>
      ),
    },
  ];

  const rows = page?.items ?? [];

  return (
    <Authenticated key="applications-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<AdminApplicationListItem, never>
          title={t("applications.listTitle")}
          description={t("applications.listDescription")}
          caption={t("applications.tableCaption")}
          filterable={false}
          extraFilters={extraFilters}
          extraApplied={extraApplied}
          onResetExtra={() => changeFilter(FILTER_INITIAL)}
          record={{
            header: t("applications.columns.kind"),
            width: "16%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.kindLabel}</span>
            ),
            label: (row) =>
              `${row.kindLabel} · ${formatMskDateTime(row.submittedAt)}`,
          }}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          total={null}
          pageCount={applicationsPageCount(cursors, query.page, nextCursor)}
          isLoading={request.isLoading}
          error={request.isError ? t("applications.errors.loadFailed") : null}
          query={query}
          onQueryChange={changeQuery}
          rowHref={(row) => `${APPLICATIONS_ROUTE}/${row.id}`}
          emptyTitle={t("applications.empty")}
          emptyDescription={t("applications.emptyDescription")}
          testId="applications"
        />
      </AppShell>
    </Authenticated>
  );
}
