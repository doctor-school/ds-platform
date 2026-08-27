"use client";

import { useState } from "react";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { DirectionAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";

/**
 * The curated-direction list (012-design §5.1, EARS-3) on the #1578 BLOCK TIER
 * (017-design §9.2, EARS-16): a two-line record row above `md`, record cards
 * below it, instant filters and a semantic status chip.
 *
 * There is no «Адрес страницы» column: the address is derived server-side and
 * rendered nowhere (017-design §9.3). There is no «Действия» column either — a
 * direction has exactly one action, so the whole row opens the record and a
 * column of identical «Редактировать» buttons would restate the row.
 *
 * There is no Delete action here and no delete route behind one — a direction
 * leaves circulation by being retired (EARS-14).
 */
export default function DirectionsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<DirectionAdminListItem>({
    resource: "directions",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("directions.statuses.draft"),
    published: t("directions.statuses.published"),
    retired: t("directions.statuses.retired"),
  };

  const columns: DataTableColumn<DirectionAdminListItem>[] = [
    {
      key: "status",
      header: t("directions.columns.status"),
      width: "22%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
  ];

  return (
    <Authenticated key="directions-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<DirectionAdminListItem>
          title={t("directions.listTitle")}
          description={t("directions.listDescription")}
          createHref="/directions/create"
          createLabel={t("directions.createButton")}
          statusLabels={statusLabels}
          caption={t("directions.tableCaption")}
          record={{
            header: t("directions.columns.title"),
            width: "58%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.title}</span>
            ),
            // The second line is the fact the operator cannot read off the
            // title: when the row last moved. The address is NOT it — it is
            // derived and rendered nowhere (017-design §9.3).
            context: (row) =>
              t("directions.rowContext", {
                date: new Date(row.updatedAt).toLocaleDateString("ru-RU"),
              }),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={(result.data ?? []) as DirectionAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("directions.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/directions/${row.id}`}
          emptyTitle={t("directions.empty")}
          emptyDescription={t("directions.emptyDescription")}
          testId="directions"
        />
      </AppShell>
    </Authenticated>
  );
}
