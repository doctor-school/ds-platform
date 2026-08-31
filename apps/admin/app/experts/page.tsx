"use client";

import { useState } from "react";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { ExpertAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";

/**
 * The expert list (012-design §5.1, EARS-2/EARS-15) on the #1578 BLOCK TIER
 * (017-design §9.1–§9.3, EARS-16/17) — the same composition every other taxonomy
 * list mounts: instant search and facets, removable chips, one «Сбросить всё»,
 * an honest pager, and record cards instead of a sideways scroll below `md`.
 *
 * The record line carries the professional role rather than a separate column:
 * it is the fact that tells two same-named experts apart. A null name means the
 * row was editorially removed (#1306, §2.4) — the id and the slug survive by
 * design, so the row still renders, labelled, never blank.
 */
export default function ExpertsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<ExpertAdminListItem>({
    resource: "experts",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("experts.statuses.draft"),
    published: t("experts.statuses.published"),
    retired: t("experts.statuses.retired"),
  };

  const rowName = (row: ExpertAdminListItem) =>
    row.name ?? t("experts.removedName");

  const columns: DataTableColumn<ExpertAdminListItem>[] = [
    {
      key: "professionalRole",
      header: t("experts.columns.professionalRole"),
      width: "24%",
      overflow: "wrap",
      render: (row) => (
        <span className="text-muted-foreground">
          {row.professionalRole ?? t("experts.notFilled")}
        </span>
      ),
    },
    {
      key: "slug",
      header: t("experts.columns.slug"),
      width: "20%",
      fullValue: (row) => row.slug,
      render: (row) => (
        <span className="text-muted-foreground">{row.slug}</span>
      ),
    },
    {
      key: "status",
      header: t("experts.columns.status"),
      width: "18%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
  ];

  return (
    <Authenticated key="experts-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<ExpertAdminListItem>
          title={t("experts.listTitle")}
          description={t("experts.listDescription")}
          createHref="/experts/create"
          createLabel={t("experts.createButton")}
          statusLabels={statusLabels}
          caption={t("experts.tableCaption")}
          record={{
            header: t("experts.columns.name"),
            width: "38%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{rowName(row)}</span>
            ),
            context: (row) =>
              t("experts.rowContext", {
                date: new Date(row.updatedAt).toLocaleDateString("ru-RU"),
              }),
            label: (row) => rowName(row),
          }}
          columns={columns}
          rows={(result.data ?? []) as ExpertAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("experts.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/experts/${row.id}`}
          emptyTitle={t("experts.empty")}
          emptyDescription={t("experts.emptyDescription")}
          testId="experts"
        />
      </AppShell>
    </Authenticated>
  );
}
